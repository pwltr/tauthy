//! Filesystem coordinator for vault lifecycle transactions. Not connected to app commands.
//! Each side effect follows durable intent; no automatic stale-vault fallback.
//! Caller must serialize transactions for a directory (the app vault mutex).
//! Credential-stage deferral leaves legacy authoritative until activation;
//! metadata must report that state, and the legacy backend must not consult this
//! journal. This is distinct from fallback after an active file has been installed.
use std::{
  fs::{self, File},
  io::{Read, Write},
  path::Path,
};

use ring::{
  digest,
  rand::{SecureRandom, SystemRandom},
};
use zeroize::Zeroizing;

use crate::{
  vault_file::{self, Envelope, Protection, Records, Vault},
  vault_journal::{self, Identity, Journal, Operation, Phase},
};

const ACTIVE: &str = "vault.tauthy";
const STAGED: &str = "vault.pending.tauthy";
const LEGACY: &str = "vault.stronghold";
const RETIRED: &str = "vault.stronghold.retired";
const MAX_SOURCE: u64 = 256 * 1024 * 1024;

#[path = "vault_change.rs"]
mod changes;
#[cfg(all(test, unix))]
#[path = "vault_transaction_tests.rs"]
mod tests;

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Error {
  Envelope(vault_file::Error),
  Journal(vault_journal::Error),
  Io,
  Conflict,
  IdentityMismatch,
  ReconciliationFailed,
  MissingVault,
  PendingUnlock,
  NeedsPreparation,
  CredentialMissing,
  CredentialUnavailable,
  SourceChanged,
  RecordsChanged,
  /// Cleanup/reconciliation of vault.pending.tauthy failed after the active
  /// vault authenticated. Never present the cause as active-vault corruption.
  StagedCleanupFailed(Box<Error>),
  Interrupted,
  ConfirmationRequired,
}

impl From<vault_file::Error> for Error {
  fn from(error: vault_file::Error) -> Self {
    Self::Envelope(error)
  }
}
impl From<vault_journal::Error> for Error {
  fn from(error: vault_journal::Error) -> Self {
    Self::Journal(error)
  }
}

/// Injectable platform adapter. Missing/denied keys must remain distinguishable.
/// stage verifies existing entries rather than overwriting unrelated keys.
pub(crate) trait Credentials {
  fn get(&mut self, identity: &Identity) -> Result<Option<Zeroizing<[u8; 32]>>, Error>;
  fn set(&mut self, identity: &Identity, key: &[u8; 32]) -> Result<(), Error>;
  /// Idempotent: missing is success, denied/unavailable is not.
  fn remove(&mut self, identity: &Identity) -> Result<(), Error>;
}

pub(crate) struct Coordinator<'a> {
  directory: &'a Path,
  credentials: &'a mut dyn Credentials,
  // Production supplies a no-op; tests fail before/after individual effects.
  checkpoint: &'a mut dyn FnMut(&'static str) -> Result<(), Error>,
  password_open: fn(Envelope, &str) -> Result<Vault, vault_file::Error>,
  candidate_create:
    fn(Records, Option<&str>, [u8; 16], [u8; 16]) -> Result<Vault, vault_file::Error>,
}

fn identity(vault: &Vault) -> Identity {
  let (vault_id, key_generation) = vault.identity();
  Identity {
    vault_id,
    key_generation,
    credential: vault.protection() == Protection::Credential,
  }
}

fn require_supported_durability() -> Result<(), Error> {
  if cfg!(unix) {
    Ok(())
  } else {
    Err(Error::Journal(vault_journal::Error::Unsupported))
  }
}

fn regular_file(path: &Path) -> Result<bool, Error> {
  match fs::symlink_metadata(path) {
    Ok(metadata) if metadata.is_file() => Ok(true),
    Ok(_) => Err(Error::Conflict),
    Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
    Err(_) => Err(Error::Io),
  }
}

fn fingerprint(path: &Path) -> Result<[u8; 32], Error> {
  if !regular_file(path)? {
    return Err(Error::SourceChanged);
  }
  let mut file = File::open(path)
    .map_err(|_| Error::Io)?
    .take(MAX_SOURCE + 1);
  let mut context = digest::Context::new(&digest::SHA256);
  let mut buffer = [0; 8192];
  let mut length = 0u64;
  loop {
    let count = file.read(&mut buffer).map_err(|_| Error::Io)?;
    if count == 0 {
      break;
    }
    length += count as u64;
    if length > MAX_SOURCE {
      return Err(Error::SourceChanged);
    }
    context.update(&buffer[..count]);
  }
  Ok(context.finish().as_ref().try_into().unwrap())
}

impl<'a> Coordinator<'a> {
  pub(crate) fn new(
    directory: &'a Path,
    credentials: &'a mut dyn Credentials,
    checkpoint: &'a mut dyn FnMut(&'static str) -> Result<(), Error>,
  ) -> Self {
    Self {
      directory,
      credentials,
      checkpoint,
      password_open: Envelope::unlock_password,
      candidate_create: Vault::create_for_identity,
    }
  }

  // Only compiled into tests; production KDF parameters are not selectable.
  #[cfg(test)]
  fn with_test_kdf(mut self) -> Self {
    self.password_open = Envelope::unlock_password_for_tests;
    self.candidate_create = Vault::create_identity_for_tests;
    self
  }

  fn point(&mut self, name: &'static str) -> Result<(), Error> {
    (self.checkpoint)(name)
  }

  fn persist(&mut self, journal: &Journal) -> Result<(), Error> {
    self.point("beforeJournal")?;
    vault_journal::persist(self.directory, journal)?;
    self.point("afterJournal")
  }

  fn advance(&mut self, journal: &mut Journal, phase: Phase) -> Result<(), Error> {
    let mut candidate = journal.clone();
    candidate.advance(phase)?;
    self.persist(&candidate)?;
    *journal = candidate;
    Ok(())
  }

  /// Starts explicitly; never replaces a prior journal, active or retired vault.
  pub(crate) fn begin_create(&mut self, vault: &Vault) -> Result<(), Error> {
    require_supported_durability()?;
    self.require_empty_transaction(false)?;
    let journal = self.new_journal(identity(vault), None)?;
    self.persist(&journal)?;
    self.prepare(vault)
  }

  /// Durable identity/intent precedes even the legacy reader's working-copy
  /// writes. Reader must never run v2 conversion on the canonical source.
  pub(crate) fn begin_migration(
    &mut self,
    password: &str,
    source_reader: &mut dyn FnMut(&Path, &str) -> Result<Records, Error>,
  ) -> Result<Vault, Error> {
    require_supported_durability()?;
    self.require_empty_transaction(true)?;
    let source = self.directory.join(LEGACY);
    let digest = fingerprint(&source)?;
    let mut bytes = [0; 32];
    SystemRandom::new()
      .fill(&mut bytes)
      .map_err(|_| Error::Io)?;
    let target = Identity {
      vault_id: bytes[..16].try_into().unwrap(),
      key_generation: bytes[16..].try_into().unwrap(),
      credential: password.is_empty(),
    };
    let journal = self.new_journal(target.clone(), Some(digest))?;
    self.persist(&journal)?;
    self.point("beforeSourceExtract")?;
    let records = source_reader(&source, password)?;
    self.point("afterSourceExtract")?;
    self.check_source(&journal)?;
    let vault = Vault::create_for_identity(
      records,
      if password.is_empty() {
        None
      } else {
        Some(password)
      },
      target.vault_id,
      target.key_generation,
    )?;
    self.prepare(&vault)?;
    Ok(vault)
  }

  fn require_empty_transaction(&mut self, migrate: bool) -> Result<(), Error> {
    if let Some(previous) = vault_journal::read(self.directory)? {
      // Explicit creation may supersede completed deletion, but not unfinished
      // deletion or another transaction. Verify credential cleanup too.
      if migrate || previous.operation != Operation::Delete || previous.phase != Phase::Deleted {
        return Err(Error::Conflict);
      }
      for source in previous
        .source_identity
        .iter()
        .chain(previous.cleanup_identities.iter())
        .filter(|source| source.credential)
      {
        self.point("beforeDeletedCredentialCheck")?;
        if self.credentials.get(source)?.is_some() {
          return Err(Error::Conflict);
        }
        self.point("afterDeletedCredentialCheck")?;
      }
    }
    for name in changes::LOCAL_ARTIFACTS
      .iter()
      .filter(|name| **name != LEGACY)
    {
      if regular_file(&self.directory.join(name))? {
        return Err(Error::Conflict);
      }
    }
    let source_exists = regular_file(&self.directory.join(LEGACY))?;
    if source_exists != migrate {
      return Err(Error::Conflict);
    }
    Ok(())
  }

  fn new_journal(
    &self,
    target: Identity,
    source_fingerprint: Option<[u8; 32]>,
  ) -> Result<Journal, Error> {
    let mut transaction_id = [0; 16];
    SystemRandom::new()
      .fill(&mut transaction_id)
      .map_err(|_| Error::Io)?;
    Ok(Journal {
      version: 1,
      transaction_id,
      operation: if source_fingerprint.is_some() {
        Operation::Migrate
      } else {
        Operation::Create
      },
      phase: Phase::Prepared,
      source_fingerprint,
      source_identity: None,
      target: Some(target),
      target_fingerprint: None,
      cleanup_identities: Vec::new(),
    })
  }

  /// Explicitly continues pre-install preparation with the same candidate.
  /// If its key was lost before staging, the future UI/factory must supply a
  /// verified reconstruction; resume never invents one from a stale snapshot.
  pub(crate) fn prepare(&mut self, vault: &Vault) -> Result<(), Error> {
    require_supported_durability()?;
    let mut journal = self.load()?;
    if !matches!(journal.operation, Operation::Create | Operation::Migrate) {
      return Err(Error::ReconciliationFailed);
    }
    if journal.target.as_ref() != Some(&identity(vault)) {
      return Err(Error::IdentityMismatch);
    }
    if regular_file(&self.directory.join(ACTIVE))? {
      return Err(Error::Conflict);
    }
    self.check_source(&journal)?;
    self.stage_credentials(&mut journal, vault)?;
    self.write_stage(vault)?;
    self.advance(&mut journal, Phase::InstallIntent)
  }

  fn stage_credentials(&mut self, journal: &mut Journal, vault: &Vault) -> Result<(), Error> {
    if journal.phase == Phase::Prepared {
      self.advance(
        journal,
        if identity(vault).credential {
          Phase::CredentialStageIntent
        } else {
          Phase::FilePrepareIntent
        },
      )?;
    }
    if journal.phase == Phase::CredentialStageIntent {
      let target = journal.target.as_ref().unwrap();
      self.point("beforeCredentialGet")?;
      let stored = self.credentials.get(target)?;
      self.point("afterCredentialGet")?;
      match stored {
        Some(key) if key.as_ref() != vault.credential_key() => return Err(Error::Conflict),
        Some(_) => {}
        None => {
          self.point("beforeCredentialSet")?;
          self.credentials.set(target, vault.credential_key())?;
          self.point("afterCredentialSet")?;
        }
      }
      self.point("beforeCredentialVerify")?;
      let verified = self
        .credentials
        .get(target)?
        .ok_or(Error::CredentialMissing)?;
      if verified.as_ref() != vault.credential_key() {
        return Err(Error::Conflict);
      }
      self.point("afterCredentialVerify")?;
      self.advance(journal, Phase::CredentialVerified)?;
    }
    if journal.phase == Phase::CredentialVerified {
      self.advance(journal, Phase::FilePrepareIntent)?;
    }
    if journal.phase != Phase::FilePrepareIntent {
      return Err(Error::ReconciliationFailed);
    }
    Ok(())
  }

  fn write_stage(&mut self, vault: &Vault) -> Result<(), Error> {
    let staged = self.directory.join(STAGED);
    if !regular_file(&staged)? {
      let bytes = vault.seal()?;
      self.point("beforeStageWrite")?;
      let mut temporary = tempfile::NamedTempFile::new_in(self.directory).map_err(|_| Error::Io)?;
      temporary.write_all(&bytes).map_err(|_| Error::Io)?;
      self.point("afterStageWrite")?;
      self.point("beforeStageSync")?;
      temporary.as_file().sync_all().map_err(|_| Error::Io)?;
      self.point("afterStageSync")?;
      self.point("beforeStagePersist")?;
      temporary
        .persist_noclobber(&staged)
        .map_err(|_| Error::Conflict)?;
      self.point("afterStagePersist")?;
      self.sync()?;
    }
    // Verify against the actual candidate before authorizing installation.
    self.point("beforeStageVerify")?;
    let opened = self.open_using_key(&staged, vault)?;
    if !opened.records.same_as(&vault.records) {
      return Err(Error::RecordsChanged);
    }
    self.point("afterStageVerify")?;
    Ok(())
  }

  fn load(&self) -> Result<Journal, Error> {
    vault_journal::read(self.directory)?.ok_or(Error::ReconciliationFailed)
  }

  fn check_source(&self, journal: &Journal) -> Result<(), Error> {
    if journal.operation != Operation::Migrate {
      return Ok(());
    }
    let legacy = self.directory.join(LEGACY);
    let retired = self.directory.join(RETIRED);
    let path = if regular_file(&legacy)? {
      legacy
    } else {
      if !matches!(
        journal.phase,
        Phase::RetireIntent | Phase::Retired | Phase::Completed
      ) {
        return Err(Error::SourceChanged);
      }
      retired
    };
    if Some(fingerprint(&path)?) != journal.source_fingerprint {
      return Err(Error::SourceChanged);
    }
    Ok(())
  }

  fn sync(&mut self) -> Result<(), Error> {
    self.point("beforeDirectorySync")?;
    vault_journal::sync_directory(self.directory)?;
    self.point("afterDirectorySync")
  }

  fn envelope(&self, path: &Path) -> Result<Envelope, Error> {
    if !regular_file(path)? {
      return Err(Error::MissingVault);
    }
    Ok(Envelope::read(File::open(path).map_err(|_| Error::Io)?)?)
  }

  fn open_using_key(&self, path: &Path, vault: &Vault) -> Result<Vault, Error> {
    // Candidate already owns an authenticated key. Password wrapping is
    // verified by future password resume; internal key opening authenticates
    // the complete payload including header/wrapping metadata.
    Ok(
      self
        .envelope(path)?
        .unlock_data_key(*vault.credential_key())?,
    )
  }

  fn unlock(
    &mut self,
    path: &Path,
    expected: &Identity,
    password: Option<&str>,
  ) -> Result<Vault, Error> {
    let envelope = self.envelope(path)?;
    let (vault_id, key_generation) = envelope.identity();
    let selector = Identity {
      vault_id,
      key_generation,
      credential: envelope.protection() == Protection::Credential,
    };
    if &selector != expected {
      return Err(Error::IdentityMismatch);
    }
    Ok(if expected.credential {
      self.point("beforeUnlockCredentialGet")?;
      let key = self
        .credentials
        .get(expected)?
        .ok_or(Error::CredentialMissing)?;
      self.point("afterUnlockCredentialGet")?;
      envelope.unlock_credential(Some(*key))?
    } else {
      (self.password_open)(envelope, password.ok_or(Error::PendingUnlock)?)?
    })
  }

  /// Authentication-dependent recovery. Source reader must preserve the source;
  /// legacy v2 conversion uses a working copy only after a durable journal exists.
  pub(crate) fn resume(
    &mut self,
    password: Option<&str>,
    source_reader: &mut dyn FnMut(&Path, &str) -> Result<Records, Error>,
  ) -> Result<Vault, Error> {
    require_supported_durability()?;
    let mut journal = self.load()?;
    if !matches!(journal.operation, Operation::Create | Operation::Migrate) {
      return Err(Error::ReconciliationFailed);
    }
    let expected = journal.target.as_ref().unwrap().clone();
    let active = self.directory.join(ACTIVE);
    let staged = self.directory.join(STAGED);
    let active_exists = regular_file(&active)?;
    let staged_exists = regular_file(&staged)?;
    if !active_exists
      && !staged_exists
      && journal.operation == Operation::Migrate
      && matches!(
        journal.phase,
        Phase::Prepared
          | Phase::CredentialStageIntent
          | Phase::CredentialVerified
          | Phase::FilePrepareIntent
      )
    {
      self.reconstruct_pre_install(&journal, password, source_reader)?;
      return self.resume(password, source_reader);
    }
    let path = if active_exists {
      &active
    } else if staged_exists {
      &staged
    } else {
      return Err(match journal.phase {
        Phase::Prepared
        | Phase::CredentialStageIntent
        | Phase::CredentialVerified
        | Phase::FilePrepareIntent => Error::NeedsPreparation,
        _ => Error::MissingVault,
      });
    };
    // All authentication happens before the first persistence/cleanup.
    let vault = self.unlock(path, &expected, password)?;
    if journal.phase == Phase::Completed {
      if !active_exists {
        return Err(Error::MissingVault);
      }
      self.cleanup_stage(&vault)?;
      return Ok(vault);
    }
    self.check_source(&journal)?;
    if journal.operation == Operation::Migrate {
      let source = if regular_file(&self.directory.join(LEGACY))? {
        self.directory.join(LEGACY)
      } else {
        self.directory.join(RETIRED)
      };
      self.point("beforeSourceExtract")?;
      let records = source_reader(&source, password.unwrap_or(""))?;
      self.point("afterSourceExtract")?;
      self.check_source(&journal)?;
      if !records.same_as(&vault.records) {
        return Err(Error::RecordsChanged);
      }
    }
    if active_exists
      && !matches!(
        journal.phase,
        Phase::InstallIntent | Phase::InstalledVerified | Phase::RetireIntent | Phase::Retired
      )
    {
      return Err(Error::ReconciliationFailed);
    }
    if !active_exists
      && !matches!(
        journal.phase,
        Phase::FilePrepareIntent | Phase::InstallIntent
      )
    {
      return Err(if staged_exists {
        Error::ReconciliationFailed
      } else {
        Error::MissingVault
      });
    }
    if journal.phase == Phase::FilePrepareIntent {
      self.advance(&mut journal, Phase::InstallIntent)?;
    }
    if journal.phase == Phase::InstallIntent {
      if !active_exists {
        self.point("beforeInstall")?;
        // Hard-link installation never clobbers an unrelated active file.
        // Staged and active reside on the same filesystem.
        fs::hard_link(&staged, &active).map_err(|_| Error::Conflict)?;
        self.point("afterInstall")?;
      }
      self.sync()?;
      self.point("beforeActiveVerify")?;
      let installed = self.unlock(&active, &expected, password)?;
      if !installed.records.same_as(&vault.records) {
        return Err(Error::RecordsChanged);
      }
      self.point("afterActiveVerify")?;
      self.advance(&mut journal, Phase::InstalledVerified)?;
    }
    if journal.phase == Phase::InstalledVerified {
      let next = if journal.operation == Operation::Migrate {
        Phase::RetireIntent
      } else {
        Phase::Completed
      };
      self.advance(&mut journal, next)?;
    }
    if journal.phase == Phase::RetireIntent {
      let legacy = self.directory.join(LEGACY);
      let retired = self.directory.join(RETIRED);
      self.check_source(&journal)?;
      if regular_file(&legacy)? {
        self.point("beforeRetireLink")?;
        if !regular_file(&retired)? {
          fs::hard_link(&legacy, &retired).map_err(|_| Error::Conflict)?;
        } else if Some(fingerprint(&retired)?) != journal.source_fingerprint {
          return Err(Error::Conflict);
        }
        self.point("afterRetireLink")?;
        self.point("beforeRetireSync")?;
        let retired_file = File::open(&retired).map_err(|_| Error::Io)?;
        #[cfg(unix)]
        {
          use std::os::unix::fs::PermissionsExt;
          retired_file
            .set_permissions(fs::Permissions::from_mode(0o600))
            .map_err(|_| Error::Io)?;
        }
        retired_file.sync_all().map_err(|_| Error::Io)?;
        self.point("afterRetireSync")?;
        self.sync()?;
        self.point("beforeRetireRemove")?;
        fs::remove_file(&legacy).map_err(|_| Error::Io)?;
        self.point("afterRetireRemove")?;
        self.sync()?;
      }
      self.advance(&mut journal, Phase::Retired)?;
    }
    if journal.phase == Phase::Retired {
      self.advance(&mut journal, Phase::Completed)?;
    }
    if journal.phase != Phase::Completed {
      return Err(Error::ReconciliationFailed);
    }
    self.cleanup_stage(&vault)?;
    Ok(vault)
  }

  fn cleanup_stage(&mut self, vault: &Vault) -> Result<(), Error> {
    self
      .cleanup_stage_inner(vault)
      .map_err(|error| match error {
        Error::Interrupted => Error::Interrupted,
        other => Error::StagedCleanupFailed(Box::new(other)),
      })
  }

  fn cleanup_stage_inner(&mut self, vault: &Vault) -> Result<(), Error> {
    let staged = self.directory.join(STAGED);
    if regular_file(&staged)? {
      let envelope = self.envelope(&staged)?;
      if envelope.identity() != vault.identity() {
        return Err(Error::IdentityMismatch);
      }
      envelope.unlock_data_key(*vault.credential_key())?;
      self.point("beforeStageCleanup")?;
      fs::remove_file(staged).map_err(|_| Error::Io)?;
      self.point("afterStageCleanup")?;
    }
    // Also flush after a restart that interrupted cleanup after unlink but
    // before its directory flush; absence alone does not prove durability.
    self.sync()
  }

  fn reconstruct_pre_install(
    &mut self,
    journal: &Journal,
    password: Option<&str>,
    source_reader: &mut dyn FnMut(&Path, &str) -> Result<Records, Error>,
  ) -> Result<(), Error> {
    let expected = journal.target.as_ref().unwrap();
    let source_password = if expected.credential {
      ""
    } else {
      password.ok_or(Error::PendingUnlock)?
    };
    self.check_source(journal)?;
    self.point("beforeSourceExtract")?;
    let records = source_reader(&self.directory.join(LEGACY), source_password)?;
    self.point("afterSourceExtract")?;
    self.check_source(journal)?;
    let vault = if expected.credential {
      self.point("beforeReconstructCredentialGet")?;
      let key = self.credentials.get(expected)?;
      self.point("afterReconstructCredentialGet")?;
      match key {
        Some(key) => Vault::restore_credential_candidate(
          records,
          expected.vault_id,
          expected.key_generation,
          key,
        )?,
        None
          if matches!(
            journal.phase,
            Phase::Prepared | Phase::CredentialStageIntent
          ) =>
        {
          Vault::create_for_identity(records, None, expected.vault_id, expected.key_generation)?
        }
        None => return Err(Error::CredentialMissing),
      }
    } else {
      Vault::create_for_identity(
        records,
        Some(source_password),
        expected.vault_id,
        expected.key_generation,
      )?
    };
    self.prepare(&vault)
  }
}
