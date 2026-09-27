//! Authenticated file-vault session and atomic ordinary saves. A single managed
//! instance must own a directory (plus app single-instance protection).
//! The mutex spans inspection, authentication, coordinator effects and saves.
use std::{
  fs::File,
  io::Write,
  path::{Path, PathBuf},
  sync::Mutex,
};

use crate::{
  legacy_vault::store_key_for,
  vault_file::{Envelope, Records, Vault},
  vault_fs,
  vault_journal::{self, Identity, Operation, Phase},
  vault_metadata::{self, Lifecycle, Metadata},
  vault_transaction::{self, Coordinator, Credentials},
};
use zeroize::Zeroizing;

type TxError = vault_transaction::Error;
type SourceReader<'a> = dyn FnMut(&Path, &str) -> Result<Records, TxError> + 'a;

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Error {
  Locked,
  StateUnavailable,
  CreationRequired,
  MigrationRequired,
  Metadata(vault_metadata::Error),
  Transaction(TxError),
}

pub(crate) enum BatchError {
  Vault(Error),
  Operation(String),
}
impl From<Error> for BatchError {
  fn from(error: Error) -> Self {
    Self::Vault(error)
  }
}
impl From<TxError> for Error {
  fn from(value: TxError) -> Self {
    Self::Transaction(value)
  }
}
impl From<crate::vault_file::Error> for Error {
  fn from(value: crate::vault_file::Error) -> Self {
    TxError::Envelope(value).into()
  }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum Deferred {
  CredentialUnavailable,
  CredentialAccessDenied,
  UnsupportedDurability,
  TooLarge,
}

pub(crate) struct Status {
  pub(crate) metadata: Metadata,
  pub(crate) locked: bool,
  pub(crate) migration_deferred: Option<Deferred>,
  pub(crate) legacy_password: Option<bool>,
}

// No Debug/Clone: session owns a zeroizing DEK and plaintext record map.
struct Session {
  vault: Vault,
  fingerprint: [u8; 32],
}
#[derive(Default)]
struct State {
  session: Option<Session>,
  deferred: Option<Deferred>,
  legacy: Option<LegacySession>,
}

struct LegacySession {
  vault: crate::legacy_vault::VaultState,
  fingerprint: [u8; 32],
  password: bool,
}

pub(crate) struct Runtime {
  directory: PathBuf,
  state: Mutex<State>,
}

/// A batch is committed as one encrypted payload, so accounts and sync config
/// cannot become a partly committed in-memory update. Unknown raw keys survive.
pub(crate) struct Update {
  pub(crate) name: Vec<u8>,
  pub(crate) value: Option<Zeroizing<Vec<u8>>>,
}

fn no_failure(_: &'static str) -> Result<(), TxError> {
  Ok(())
}
fn no_source(_: &Path, _: &str) -> Result<Records, TxError> {
  Err(TxError::NeedsPreparation)
}

fn cleanup_error(error: std::io::Error) -> TxError {
  if error.kind() == std::io::ErrorKind::Unsupported {
    TxError::Journal(vault_journal::Error::Unsupported)
  } else {
    TxError::ReconciliationFailed
  }
}

fn identity(vault: &Vault) -> Identity {
  let (vault_id, key_generation) = vault.identity();
  Identity {
    vault_id,
    key_generation,
    credential: vault.protection() == crate::vault_file::Protection::Credential,
  }
}

fn metadata(directory: &Path) -> Result<Metadata, Error> {
  vault_metadata::inspect(directory).map_err(Error::Metadata)
}

fn require_completed(directory: &Path, vault: &Vault) -> Result<(), Error> {
  let metadata = metadata(directory)?;
  if metadata.lifecycle != Lifecycle::Active || metadata.phase != Some(Phase::Completed) {
    return Err(TxError::ReconciliationFailed.into());
  }
  if metadata.identity_hint.as_ref() != Some(&identity(vault)) {
    return Err(TxError::IdentityMismatch.into());
  }
  Ok(())
}

fn open_with_key(path: &Path, expected: &Vault) -> Result<Session, Error> {
  let before = vault_transaction::fingerprint(path)?;
  let envelope = Envelope::read(File::open(path).map_err(|_| TxError::Io)?)?;
  if envelope.identity() != expected.identity() {
    return Err(TxError::IdentityMismatch.into());
  }
  let vault = envelope.unlock_data_key(*expected.credential_key())?;
  if vault_transaction::fingerprint(path)? != before {
    return Err(TxError::SourceChanged.into());
  }
  Ok(Session {
    vault,
    fingerprint: before,
  })
}

impl Runtime {
  fn legacy_allowed(&self) -> Result<(), Error> {
    let m = metadata(&self.directory)?;
    if m.lifecycle == Lifecycle::Legacy
      || (m.lifecycle == Lifecycle::LegacyMigrationPending
        && m.phase == Some(Phase::MigrationDeferred))
    {
      Ok(())
    } else {
      Err(TxError::ReconciliationFailed.into())
    }
  }

  fn check_legacy(&self, session: &LegacySession) -> Result<(), Error> {
    self.legacy_allowed()?;
    if vault_transaction::fingerprint(&self.directory.join("vault.stronghold"))?
      != session.fingerprint
    {
      return Err(TxError::SourceChanged.into());
    }
    Ok(())
  }

  fn open_legacy(&self, state: &mut State, password: &str) -> Result<(), Error> {
    self.legacy_allowed()?;
    let source = self.directory.join("vault.stronghold");
    let before = vault_transaction::fingerprint(&source)?;
    let use_copy = metadata(&self.directory)?.phase == Some(Phase::MigrationDeferred)
      && match vault_fs::require_supported(&self.directory) {
        Ok(()) => true,
        Err(error) if error.kind() == std::io::ErrorKind::Unsupported => false,
        Err(_) => return Err(TxError::Io.into()),
      };
    let vault = if use_copy {
      crate::legacy_vault::migration_session(&source, password)?
    } else {
      // No new-storage journal exists when the filesystem is unsupported. Use
      // the released legacy backend, including its own verified v2 upgrade.
      let vault = crate::legacy_vault::VaultState::default();
      crate::legacy_vault::vault_load_at(&vault, source.clone(), password.to_string()).map_err(
        |error| {
          if error.contains("Please try another password.") {
            TxError::Envelope(crate::vault_file::Error::Authentication)
          } else {
            TxError::ReconciliationFailed
          }
        },
      )?;
      vault
    };
    let after = vault_transaction::fingerprint(&source)?;
    if use_copy && before != after {
      return Err(TxError::SourceChanged.into());
    }
    state.legacy = Some(LegacySession {
      vault,
      fingerprint: after,
      password: !password.is_empty(),
    });
    Ok(())
  }

  fn recover_deferred(
    &self,
    state: &mut State,
    password: &str,
    error: TxError,
    credentials: &mut dyn Credentials,
  ) -> Result<(), Error> {
    self.note_deferral(state, &error);
    if state.deferred.is_none() {
      return Err(error.into());
    }
    let m = metadata(&self.directory)?;
    if m.lifecycle == Lifecycle::LegacyMigrationPending {
      if m.phase != Some(Phase::MigrationDeferred) {
        if !matches!(
          m.phase,
          Some(Phase::Prepared | Phase::CredentialStageIntent)
        ) || !password.is_empty()
        {
          return Err(error.into());
        }
        let mut hook = no_failure;
        Coordinator::new(&self.directory, credentials, &mut hook).defer_migration()?;
      }
    } else if m.lifecycle != Lifecycle::Legacy {
      return Err(error.into());
    }
    self.open_legacy(state, password)
  }
  /// Production entry points keep the legacy reader selected by Rust, not IPC.
  pub(crate) fn migrate_legacy(
    &self,
    password: &str,
    credentials: &mut dyn Credentials,
  ) -> Result<(), Error> {
    self.migrate(
      password,
      credentials,
      &mut crate::legacy_vault::migration_records,
    )
  }

  pub(crate) fn unlock_current(
    &self,
    password: Option<&str>,
    target_password: Option<&str>,
    credentials: &mut dyn Credentials,
  ) -> Result<(), Error> {
    self.unlock(
      password,
      target_password,
      credentials,
      &mut crate::legacy_vault::migration_records,
    )
  }

  /// Called by the dispatcher at startup under the same directory ownership as
  /// every other operation. Never adopts temporary bytes or changes a journal.
  pub(crate) fn cleanup_temporary_files(&self) -> Result<(), Error> {
    let _state = self.state.lock().map_err(|_| Error::StateUnavailable)?;
    vault_fs::cleanup_temporary_files(&self.directory).map_err(cleanup_error)?;
    crate::legacy_vault::cleanup_migration_copy(&self.directory)?;
    Ok(())
  }

  /// Directory creation/path selection remains the app's responsibility. No
  /// implicit vault creation, deletion, key lookup or directory sweep here.
  pub(crate) fn new(directory: PathBuf) -> Self {
    Self {
      directory,
      state: Mutex::new(State::default()),
    }
  }

  pub(crate) fn status(&self) -> Result<Status, Error> {
    let state = self.state.lock().map_err(|_| Error::StateUnavailable)?;
    let metadata = metadata(&self.directory)?;
    let active_session = state.session.as_ref().is_some_and(|session| {
      metadata.lifecycle == Lifecycle::Active
        && metadata.phase == Some(Phase::Completed)
        && metadata.identity_hint.as_ref() == Some(&identity(&session.vault))
    });
    let legacy_session = state
      .legacy
      .as_ref()
      .is_some_and(|session| self.check_legacy(session).is_ok());
    Ok(Status {
      legacy_password: state.legacy.as_ref().map(|session| session.password),
      migration_deferred: if matches!(
        metadata.lifecycle,
        Lifecycle::Legacy | Lifecycle::LegacyMigrationPending
      ) {
        state.deferred
      } else {
        None
      },
      locked: !active_session && !legacy_session,
      metadata,
    })
  }

  pub(crate) fn lock(&self) -> Result<(), Error> {
    // Dropping the session clears the DEK and all raw values. Nothing persisted.
    let mut state = self.state.lock().map_err(|_| Error::StateUnavailable)?;
    state.session.take();
    state.legacy.take();
    Ok(())
  }

  pub(crate) fn create(
    &self,
    password: Option<&str>,
    credentials: &mut dyn Credentials,
  ) -> Result<(), Error> {
    let mut state = self.state.lock().map_err(|_| Error::StateUnavailable)?;
    state.session.take();
    if !matches!(
      metadata(&self.directory)?.lifecycle,
      Lifecycle::New | Lifecycle::Deleted
    ) {
      return Err(TxError::Conflict.into());
    }
    vault_fs::require_supported(&self.directory).map_err(|error| {
      if error.kind() == std::io::ErrorKind::Unsupported {
        TxError::Journal(vault_journal::Error::Unsupported)
      } else {
        TxError::Io
      }
    })?;
    let candidate = Vault::create(Records::default(), password)?;
    let mut hook = no_failure;
    let mut coordinator = Coordinator::new(&self.directory, credentials, &mut hook);
    coordinator.begin_create(&candidate)?;
    let vault = coordinator.resume(password, &mut no_source)?;
    self.install_session(&mut state, vault)
  }

  pub(crate) fn unlock(
    &self,
    password: Option<&str>,
    target_password: Option<&str>,
    credentials: &mut dyn Credentials,
    reader: &mut SourceReader<'_>,
  ) -> Result<(), Error> {
    let mut state = self.state.lock().map_err(|_| Error::StateUnavailable)?;
    state.session.take();
    state.legacy.take();
    let metadata = metadata(&self.directory)?;
    if metadata.phase == Some(Phase::MigrationDeferred) {
      return self.open_legacy(&mut state, password.unwrap_or(""));
    }
    match metadata.lifecycle {
      Lifecycle::New => return Err(Error::CreationRequired),
      Lifecycle::Legacy => return Err(Error::MigrationRequired),
      Lifecycle::Deleting | Lifecycle::Deleted => return Err(TxError::ReconciliationFailed.into()),
      _ => {}
    }
    let mut hook = no_failure;
    let mut coordinator = Coordinator::new(&self.directory, credentials, &mut hook);
    let result = match metadata.operation {
      Some(Operation::Rotate | Operation::Replace) => {
        let target_password = if matches!(
          metadata.phase,
          Some(Phase::Completed | Phase::Activated | Phase::CleanupIntent)
        ) {
          target_password.or(password)
        } else {
          target_password
        };
        coordinator.resume_change(password, target_password)
      }
      Some(Operation::Create | Operation::Migrate) => coordinator.resume(password, reader),
      _ => return Err(TxError::ReconciliationFailed.into()),
    };
    match result {
      Ok(vault) => self.install_session(&mut state, vault),
      Err(error) => self.recover_deferred(&mut state, password.unwrap_or(""), error, credentials),
    }
  }

  /// Explicit migration request. Credential failure is a recorded runtime fact,
  /// not inferred from a phase and not permission to fallback after activation.
  /// Native failure before file preparation keeps legacy authoritative through
  /// a durable deferred marker. Explicit retry re-authenticates current records.
  pub(crate) fn migrate(
    &self,
    password: &str,
    credentials: &mut dyn Credentials,
    reader: &mut SourceReader<'_>,
  ) -> Result<(), Error> {
    let mut state = self.state.lock().map_err(|_| Error::StateUnavailable)?;
    state.session.take();
    state.legacy.take();
    let m = metadata(&self.directory)?;
    if m.lifecycle != Lifecycle::Legacy && m.phase != Some(Phase::MigrationDeferred) {
      return Err(TxError::Conflict.into());
    }
    let mut hook = no_failure;
    let mut coordinator = Coordinator::new(&self.directory, credentials, &mut hook);
    let result = if m.phase == Some(Phase::MigrationDeferred) {
      coordinator
        .retry_deferred_migration(password, reader)
        .and_then(|_| coordinator.resume(Some(password), reader))
    } else {
      coordinator
        .begin_migration(password, reader)
        .and_then(|_| coordinator.resume(Some(password), reader))
    };
    match result {
      Ok(vault) => self.install_session(&mut state, vault),
      Err(error) => self.recover_deferred(&mut state, password, error, credentials),
    }
  }

  fn note_deferral(&self, state: &mut State, error: &TxError) {
    state.deferred = if metadata(&self.directory).is_ok_and(|m| {
      matches!(
        m.lifecycle,
        Lifecycle::Legacy | Lifecycle::LegacyMigrationPending
      )
    }) {
      match error {
        TxError::CredentialUnavailable => Some(Deferred::CredentialUnavailable),
        TxError::CredentialAccessDenied => Some(Deferred::CredentialAccessDenied),
        TxError::Journal(vault_journal::Error::Unsupported) => {
          Some(Deferred::UnsupportedDurability)
        }
        TxError::Envelope(crate::vault_file::Error::TooLarge) => Some(Deferred::TooLarge),
        _ => None,
      }
    } else {
      None
    };
  }

  fn install_session(&self, state: &mut State, vault: Vault) -> Result<(), Error> {
    require_completed(&self.directory, &vault)?;
    let session = open_with_key(&self.directory.join("vault.tauthy"), &vault)?;
    if !session.vault.records.same_as(&vault.records) {
      return Err(TxError::RecordsChanged.into());
    }
    state.session = Some(session);
    state.legacy.take();
    state.deferred = None;
    Ok(())
  }

  pub(crate) fn get(&self, name: &[u8]) -> Result<Option<Vec<u8>>, Error> {
    let state = self.state.lock().map_err(|_| Error::StateUnavailable)?;
    if let Some(legacy) = state.legacy.as_ref() {
      self.check_legacy(legacy)?;
      return legacy
        .vault
        .with_unlocked(|vault| vault.get_record(name))
        .map_err(|_| TxError::ReconciliationFailed.into());
    }
    let session = state.session.as_ref().ok_or(Error::Locked)?;
    require_completed(&self.directory, &session.vault)?;
    Ok(
      session
        .vault
        .records
        .get(&store_key_for(name))
        .map(|value| value.to_vec()),
    )
  }

  pub(crate) fn save(&self, updates: Vec<Update>) -> Result<(), Error> {
    self.save_with(updates, &mut no_failure)
  }

  fn save_with(
    &self,
    updates: Vec<Update>,
    checkpoint: &mut dyn FnMut(&'static str) -> Result<(), TxError>,
  ) -> Result<(), Error> {
    let mut state = self.state.lock().map_err(|_| Error::StateUnavailable)?;
    self.save_locked(&mut state, updates, checkpoint)
  }

  /// Sync holds this lock across reads, remote merge and its single local batch.
  /// Callback failures discard every queued write; no native credential access.
  pub(crate) fn with_record_batch<T>(
    &self,
    operation: impl FnOnce(&Records, &mut Vec<Update>) -> Result<T, String>,
  ) -> Result<T, BatchError> {
    let mut state = self.state.lock().map_err(|_| Error::StateUnavailable)?;
    if let Some(legacy) = state.legacy.as_ref() {
      self.check_legacy(legacy)?;
      let records = legacy
        .vault
        .with_unlocked(|vault| vault.raw_records())
        .map_err(|_| Error::Transaction(TxError::ReconciliationFailed))?;
      let mut updates = Vec::new();
      let result = operation(&records, &mut updates).map_err(BatchError::Operation)?;
      if !updates.is_empty() {
        self.save_locked(&mut state, updates, &mut no_failure)?;
      }
      return Ok(result);
    }
    let session = state.session.as_ref().ok_or(Error::Locked)?;
    require_completed(&self.directory, &session.vault)?;
    let mut updates = Vec::new();
    let result = operation(&session.vault.records, &mut updates).map_err(BatchError::Operation)?;
    if !updates.is_empty() {
      self.save_locked(&mut state, updates, &mut no_failure)?;
    }
    Ok(result)
  }

  fn save_locked(
    &self,
    state: &mut State,
    updates: Vec<Update>,
    checkpoint: &mut dyn FnMut(&'static str) -> Result<(), TxError>,
  ) -> Result<(), Error> {
    if let Some(mut legacy) = state.legacy.take() {
      self.check_legacy(&legacy)?;
      legacy
        .vault
        .with_unlocked(|vault| {
          for update in updates {
            match update.value {
              Some(value) => vault.put_record(&update.name, value.to_vec())?,
              None => vault.delete_record(&update.name)?,
            }
          }
          vault.commit()
        })
        .map_err(|_| TxError::Io)?;
      legacy.fingerprint =
        vault_transaction::fingerprint(&self.directory.join("vault.stronghold"))?;
      state.legacy = Some(legacy);
      return Ok(());
    }
    // Any failed save locks the session. In particular, a rename may have
    // succeeded before a later flush/verification failure: never retain stale
    // writable memory or claim the old in-memory data is authoritative.
    let session = state.session.take().ok_or(Error::Locked)?;
    require_completed(&self.directory, &session.vault)?;
    let active = self.directory.join("vault.tauthy");
    let before = open_with_key(&active, &session.vault)?;
    if before.fingerprint != session.fingerprint {
      return Err(TxError::SourceChanged.into());
    }
    if !before.vault.records.same_as(&session.vault.records) {
      return Err(TxError::RecordsChanged.into());
    }
    let mut records = session.vault.records.copy()?;
    for update in updates {
      let key = store_key_for(&update.name);
      if let Some(mut value) = update.value {
        records.insert(key, std::mem::take(&mut *value));
      } else {
        records.remove(&key);
      }
    }
    let candidate = session.vault.with_records(records)?;
    let bytes = candidate.seal()?;
    checkpoint("beforeSaveWrite")?;
    let mut temporary = vault_fs::temporary(&self.directory).map_err(|_| TxError::Io)?;
    temporary.write_all(&bytes).map_err(|_| TxError::Io)?;
    checkpoint("afterSaveWrite")?;
    checkpoint("beforeSaveFlush")?;
    temporary.as_file().sync_all().map_err(|_| TxError::Io)?;
    checkpoint("afterSaveFlush")?;
    checkpoint("beforeSaveVerify")?;
    let verified = open_with_key(temporary.path(), &candidate)?;
    if !verified.vault.records.same_as(&candidate.records) {
      return Err(TxError::RecordsChanged.into());
    }
    checkpoint("afterSaveVerify")?;
    checkpoint("beforeSaveReplace")?;
    require_completed(&self.directory, &session.vault)?;
    if vault_transaction::fingerprint(&active)? != session.fingerprint {
      return Err(TxError::SourceChanged.into());
    }
    vault_fs::persist(temporary, &active, true).map_err(|_| TxError::Io)?;
    checkpoint("afterSaveReplace")?;
    checkpoint("beforeSaveActiveVerify")?;
    let installed = open_with_key(&active, &candidate)?;
    if !installed.vault.records.same_as(&candidate.records) {
      return Err(TxError::RecordsChanged.into());
    }
    require_completed(&self.directory, &installed.vault)?;
    checkpoint("afterSaveActiveVerify")?;
    state.session = Some(installed);
    Ok(())
  }

  pub(crate) fn delete(
    &self,
    confirmed: bool,
    credentials: &mut dyn Credentials,
  ) -> Result<(), Error> {
    let mut state = self.state.lock().map_err(|_| Error::StateUnavailable)?;
    if !confirmed {
      return Err(TxError::ConfirmationRequired.into());
    }
    state.session.take();
    state.legacy.take();
    state.deferred = None;
    let mut hook = no_failure;
    let mut coordinator = Coordinator::new(&self.directory, credentials, &mut hook);
    coordinator.begin_delete(true)?;
    coordinator.resume_delete()?;
    Ok(())
  }

  fn authenticate_source(
    &self,
    session: &Session,
    password: Option<&str>,
    credentials: &mut dyn Credentials,
  ) -> Result<Vault, Error> {
    require_completed(&self.directory, &session.vault)?;
    let active = self.directory.join("vault.tauthy");
    if vault_transaction::fingerprint(&active)? != session.fingerprint {
      return Err(TxError::SourceChanged.into());
    }
    let envelope = Envelope::read(File::open(&active).map_err(|_| TxError::Io)?)?;
    if envelope.identity() != session.vault.identity() {
      return Err(TxError::IdentityMismatch.into());
    }
    let source = match envelope.protection() {
      crate::vault_file::Protection::Password => {
        envelope.unlock_password(password.ok_or(TxError::PendingUnlock)?)?
      }
      crate::vault_file::Protection::Credential => {
        let key = credentials
          .get(&identity(&session.vault))?
          .ok_or(TxError::CredentialMissing)?;
        envelope.unlock_credential(Some(*key))?
      }
    };
    if vault_transaction::fingerprint(&active)? != session.fingerprint {
      return Err(TxError::SourceChanged.into());
    }
    if !source.records.same_as(&session.vault.records) {
      return Err(TxError::RecordsChanged.into());
    }
    Ok(source)
  }

  /// Add/change/remove protection. None means a device credential, never an
  /// empty-password wrapper. UI must explain raw-copy invalidation before
  /// supplying confirmation. Re-authenticate before journaling any effects.
  pub(crate) fn change_password(
    &self,
    current_password: Option<&str>,
    new_password: Option<&str>,
    confirmed: bool,
    credentials: &mut dyn Credentials,
  ) -> Result<(), Error> {
    let mut state = self.state.lock().map_err(|_| Error::StateUnavailable)?;
    if state.legacy.is_some() {
      return Err(Error::MigrationRequired);
    }
    if !confirmed {
      return Err(TxError::ConfirmationRequired.into());
    }
    let session = state.session.take().ok_or(Error::Locked)?;
    let source = self.authenticate_source(&session, current_password, credentials)?;
    let target = source.rotate(new_password)?;
    let mut hook = no_failure;
    let mut coordinator = Coordinator::new(&self.directory, credentials, &mut hook);
    coordinator.begin_rotation(&source, &target)?;
    let vault = coordinator.resume_change(current_password, new_password)?;
    self.install_session(&mut state, vault)
  }

  /// Replaces the entire local vault, not an account merge. Foreign bytes must
  /// have been authenticated into a Vault first; unknown records (including sync
  /// configuration) are retained. Sync disposition is an explicit UI decision.
  pub(crate) fn import_foreign(
    &self,
    foreign: &Vault,
    current_password: Option<&str>,
    new_password: Option<&str>,
    confirmed: bool,
    credentials: &mut dyn Credentials,
  ) -> Result<(), Error> {
    let mut state = self.state.lock().map_err(|_| Error::StateUnavailable)?;
    if state.legacy.is_some() {
      return Err(Error::MigrationRequired);
    }
    if !confirmed {
      return Err(TxError::ConfirmationRequired.into());
    }
    let session = state.session.take().ok_or(Error::Locked)?;
    let source = self.authenticate_source(&session, current_password, credentials)?;
    let mut hook = no_failure;
    let mut coordinator = Coordinator::new(&self.directory, credentials, &mut hook);
    coordinator.begin_foreign_replacement(&source, foreign, new_password, true)?;
    let vault = coordinator.resume_change(current_password, new_password)?;
    self.install_session(&mut state, vault)
  }

  /// Explicit re-submission when replacement was interrupted before its target
  /// content became durable. Never rebuild a foreign target from local records.
  pub(crate) fn resume_foreign_import(
    &self,
    foreign: &Vault,
    current_password: Option<&str>,
    new_password: Option<&str>,
    confirmed: bool,
    credentials: &mut dyn Credentials,
  ) -> Result<(), Error> {
    let mut state = self.state.lock().map_err(|_| Error::StateUnavailable)?;
    if !confirmed {
      return Err(TxError::ConfirmationRequired.into());
    }
    state.session.take();
    let journal = vault_journal::read(&self.directory)
      .map_err(TxError::from)?
      .ok_or(TxError::ReconciliationFailed)?;
    if journal.operation != Operation::Replace
      || !matches!(
        journal.phase,
        Phase::Prepared
          | Phase::CredentialStageIntent
          | Phase::CredentialVerified
          | Phase::FilePrepareIntent
      )
    {
      return Err(TxError::ReconciliationFailed.into());
    }
    let source_id = journal
      .source_identity
      .as_ref()
      .ok_or(TxError::ReconciliationFailed)?;
    let path = self.directory.join("vault.tauthy");
    if Some(vault_transaction::fingerprint(&path)?) != journal.source_fingerprint {
      return Err(TxError::SourceChanged.into());
    }
    let envelope = Envelope::read(File::open(path).map_err(|_| TxError::Io)?)?;
    if envelope.identity() != (source_id.vault_id, source_id.key_generation)
      || (envelope.protection() == crate::vault_file::Protection::Credential)
        != source_id.credential
    {
      return Err(TxError::IdentityMismatch.into());
    }
    let source = if source_id.credential {
      let key = credentials
        .get(source_id)?
        .ok_or(TxError::CredentialMissing)?;
      envelope.unlock_credential(Some(*key))?
    } else {
      envelope.unlock_password(current_password.ok_or(TxError::PendingUnlock)?)?
    };
    let mut hook = no_failure;
    let mut coordinator = Coordinator::new(&self.directory, credentials, &mut hook);
    coordinator.prepare_foreign_replacement(&source, foreign, new_password, true)?;
    let vault = coordinator.resume_change(current_password, new_password)?;
    self.install_session(&mut state, vault)
  }
}

#[cfg(test)]
#[path = "vault_runtime_tests.rs"]
mod tests;
