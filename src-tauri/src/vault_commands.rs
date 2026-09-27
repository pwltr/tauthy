//! Opt-in file-vault IPC. No automatic creation, migration, fallback or native
//! key lookup at startup. Never expose raw records, selectors, passwords or DEKs.
//! The frontend dispatcher calls `vault_initialize` once at startup, before
//! issuing any other file-vault command.
use serde::Serialize;
use std::{fs::File, path::PathBuf, sync::Arc};
use tauri::{AppHandle, State};
use zeroize::Zeroizing;

use crate::{
  vault_access::{RecordAccess, VaultAccess},
  vault_credentials::PlatformCredentials,
  vault_file::{self, Envelope},
  vault_journal, vault_metadata,
  vault_runtime::{self, Runtime, Update},
  vault_transaction::{self, Credentials},
};

/// Capability negotiation only: no filesystem or credential side effects.
#[tauri::command]
pub(crate) fn vault_backend() -> &'static str {
  if cfg!(feature = "file-vault") {
    "fileV1"
  } else {
    "stronghold"
  }
}

#[derive(Clone)]
pub(crate) struct FileVaultState(Arc<Runtime>);
impl FileVaultState {
  pub(crate) fn new(directory: PathBuf) -> Self {
    Self(Arc::new(Runtime::new(directory)))
  }
}
impl VaultAccess for FileVaultState {
  fn with_records<T>(
    &self,
    operation: impl FnOnce(&dyn RecordAccess) -> Result<T, String>,
  ) -> Result<T, String> {
    self.0.with_records(operation)
  }
}

#[derive(Debug, PartialEq, Eq, Serialize)]
pub(crate) struct CommandError {
  code: &'static str,
}
impl From<vault_runtime::Error> for CommandError {
  fn from(error: vault_runtime::Error) -> Self {
    Self {
      code: error_code(&error),
    }
  }
}
fn task_failed(_: impl std::fmt::Debug) -> CommandError {
  CommandError {
    code: "vaultTaskFailed",
  }
}

async fn mutate(
  app: &AppHandle,
  operation: impl FnOnce() -> Result<(), CommandError> + Send + 'static,
) -> Result<(), CommandError> {
  let result = tauri::async_runtime::spawn_blocking(operation)
    .await
    .map_err(task_failed)
    .and_then(|result| result);
  // Failed authentication/save may have revoked the session. Clear stale tray
  // codes on failure too, not just after a successful mutation.
  let _ = crate::tray::refresh_menu(app);
  result
}

fn envelope_error(error: &vault_file::Error) -> &'static str {
  match error {
    vault_file::Error::Authentication => "vaultAuthenticationFailed",
    vault_file::Error::Corrupt => "vaultCorrupt",
    vault_file::Error::Unsupported => "vaultUnsupportedEnvelope",
    vault_file::Error::TooLarge => "vaultTooLarge",
    vault_file::Error::EmptyPassword => "vaultEmptyPassword",
    vault_file::Error::CredentialMissing => "vaultCredentialMissing",
    vault_file::Error::WrongProtection => "vaultReconciliationFailed",
    vault_file::Error::Random | vault_file::Error::Io => "vaultIo",
  }
}
fn journal_error(error: &vault_journal::Error) -> &'static str {
  match error {
    vault_journal::Error::Unsupported => "vaultUnsupportedDurability",
    vault_journal::Error::Io => "vaultIo",
    vault_journal::Error::IdentityMismatch => "vaultIdentityMismatch",
    vault_journal::Error::MissingVault => "vaultMissing",
    vault_journal::Error::Corrupt | vault_journal::Error::ReconciliationFailed => {
      "vaultReconciliationFailed"
    }
  }
}
fn transaction_error(error: &vault_transaction::Error) -> &'static str {
  use vault_transaction::Error as E;
  match error {
    E::Envelope(error) => envelope_error(error),
    E::Journal(error) => journal_error(error),
    E::Io => "vaultIo",
    E::IdentityMismatch => "vaultIdentityMismatch",
    E::MissingVault => "vaultMissing",
    E::PendingUnlock => "vaultPendingUnlock",
    E::NeedsPreparation => "vaultNeedsPreparation",
    E::CredentialMissing => "vaultCredentialMissing",
    E::CredentialUnavailable => "vaultCredentialUnavailable",
    E::CredentialAccessDenied => "vaultCredentialAccessDenied",
    E::CredentialMalformed => "vaultCredentialMalformed",
    E::SourceChanged | E::RecordsChanged => "vaultSourceChanged",
    E::StagedCleanupFailed(_) => "vaultStagedCleanupFailed",
    E::LegacyCopyCleanupFailed => "vaultLegacyCopyCleanupFailed",
    E::ConfirmationRequired => "vaultConfirmationRequired",
    E::Conflict | E::ReconciliationFailed => "vaultReconciliationFailed",
    E::Interrupted => "vaultTaskFailed",
  }
}
pub(crate) fn error_code(error: &vault_runtime::Error) -> &'static str {
  use vault_runtime::Error as E;
  match error {
    E::Locked => "vaultLocked",
    E::StateUnavailable => "vaultStateUnavailable",
    E::CreationRequired => "vaultCreationRequired",
    E::MigrationRequired => "vaultMigrationRequired",
    E::Transaction(error) => transaction_error(error),
    E::Metadata(error) => match error {
      vault_metadata::Error::Envelope(error) => envelope_error(error),
      vault_metadata::Error::Journal(error) => journal_error(error),
      vault_metadata::Error::Io => "vaultIo",
      vault_metadata::Error::IdentityMismatch => "vaultIdentityMismatch",
      vault_metadata::Error::MissingVault => "vaultMissing",
      vault_metadata::Error::SourceChanged => "vaultSourceChanged",
      vault_metadata::Error::CorruptLegacy => "vaultLegacyCorrupt",
      vault_metadata::Error::UnsupportedLegacy => "vaultLegacyUnsupported",
      vault_metadata::Error::ReconciliationFailed => "vaultReconciliationFailed",
    },
  }
}

// Construct native credentials only when a coordinator actually needs them.
// Password-mode unlock must not depend on an available credential-store daemon.
#[derive(Default)]
struct LazyCredentials(Option<PlatformCredentials>);
impl LazyCredentials {
  fn adapter(&mut self) -> Result<&mut PlatformCredentials, vault_transaction::Error> {
    if self.0.is_none() {
      self.0 = Some(PlatformCredentials::new()?);
    }
    Ok(self.0.as_mut().unwrap())
  }
}
impl Credentials for LazyCredentials {
  fn get(
    &mut self,
    id: &vault_journal::Identity,
  ) -> Result<Option<Zeroizing<[u8; 32]>>, vault_transaction::Error> {
    self.adapter()?.get(id)
  }
  fn set(
    &mut self,
    id: &vault_journal::Identity,
    key: &[u8; 32],
  ) -> Result<(), vault_transaction::Error> {
    self.adapter()?.set(id, key)
  }
  fn remove(&mut self, id: &vault_journal::Identity) -> Result<(), vault_transaction::Error> {
    self.adapter()?.remove(id)
  }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VaultStatus {
  status: &'static str,
  lifecycle: vault_metadata::Lifecycle,
  backend: Option<vault_metadata::Backend>,
  /// Unauthenticated prompt hint only. Locked is an authenticated runtime fact.
  protection_hint: Option<&'static str>,
  operation: Option<vault_journal::Operation>,
  phase: Option<vault_journal::Phase>,
  migration_deferred: Option<vault_runtime::Deferred>,
}
fn status_at(runtime: &Runtime) -> Result<VaultStatus, CommandError> {
  let status = runtime.status()?;
  Ok(VaultStatus {
    status: if status.locked { "locked" } else { "unlocked" },
    lifecycle: status.metadata.lifecycle,
    backend: status.metadata.backend,
    protection_hint: status.metadata.identity_hint.map(|id| {
      if id.credential {
        "deviceCredential"
      } else {
        "password"
      }
    }),
    operation: status.metadata.operation,
    phase: status.metadata.phase,
    migration_deferred: status.migration_deferred,
  })
}

#[cfg_attr(feature = "file-vault", tauri::command)]
pub(crate) async fn vault_status(
  state: State<'_, FileVaultState>,
) -> Result<VaultStatus, CommandError> {
  let runtime = state.0.clone();
  tauri::async_runtime::spawn_blocking(move || status_at(&runtime))
    .await
    .map_err(task_failed)?
}
#[cfg_attr(feature = "file-vault", tauri::command)]
pub(crate) async fn vault_initialize(state: State<'_, FileVaultState>) -> Result<(), CommandError> {
  let runtime = state.0.clone();
  tauri::async_runtime::spawn_blocking(move || {
    runtime
      .cleanup_temporary_files()
      .map_err(CommandError::from)
  })
  .await
  .map_err(task_failed)?
}
#[cfg_attr(feature = "file-vault", tauri::command)]
pub(crate) async fn vault_load(
  app: AppHandle,
  state: State<'_, FileVaultState>,
  password: String,
  target_password: Option<String>,
) -> Result<(), CommandError> {
  let runtime = state.0.clone();
  let password = Zeroizing::new(password);
  let target = target_password.map(Zeroizing::new);
  mutate(&app, move || {
    runtime
      .unlock_current(
        Some(&password),
        target.as_deref().map(String::as_str),
        &mut LazyCredentials::default(),
      )
      .map_err(CommandError::from)
  })
  .await
}
#[cfg_attr(feature = "file-vault", tauri::command)]
pub(crate) async fn vault_create(
  app: AppHandle,
  state: State<'_, FileVaultState>,
  password: Option<String>,
  confirmed: bool,
) -> Result<(), CommandError> {
  let password = password.map(Zeroizing::new);
  if !confirmed {
    return Err(CommandError {
      code: "vaultConfirmationRequired",
    });
  }
  let runtime = state.0.clone();
  mutate(&app, move || {
    runtime
      .create(
        password.as_deref().map(String::as_str),
        &mut LazyCredentials::default(),
      )
      .map_err(CommandError::from)
  })
  .await
}
#[cfg_attr(feature = "file-vault", tauri::command)]
pub(crate) async fn vault_migrate(
  app: AppHandle,
  state: State<'_, FileVaultState>,
  password: String,
) -> Result<(), CommandError> {
  let runtime = state.0.clone();
  let password = Zeroizing::new(password);
  mutate(&app, move || {
    runtime
      .migrate_legacy(&password, &mut LazyCredentials::default())
      .map_err(CommandError::from)
  })
  .await
}
#[cfg_attr(feature = "file-vault", tauri::command)]
pub(crate) async fn vault_get(state: State<'_, FileVaultState>) -> Result<String, CommandError> {
  let runtime = state.0.clone();
  tauri::async_runtime::spawn_blocking(move || {
    let record = runtime.get(b"vault")?.ok_or(CommandError {
      code: "vaultRecordMissing",
    })?;
    String::from_utf8(record).map_err(|_| CommandError {
      code: "vaultCorrupt",
    })
  })
  .await
  .map_err(task_failed)?
}
#[cfg_attr(feature = "file-vault", tauri::command)]
pub(crate) async fn vault_save(
  app: AppHandle,
  state: State<'_, FileVaultState>,
  record: String,
) -> Result<(), CommandError> {
  let runtime = state.0.clone();
  let record = Zeroizing::new(record.into_bytes());
  mutate(&app, move || {
    runtime
      .save(vec![Update {
        name: b"vault".to_vec(),
        value: Some(record),
      }])
      .map_err(CommandError::from)
  })
  .await
}
#[cfg_attr(feature = "file-vault", tauri::command)]
pub(crate) async fn vault_unload(
  app: AppHandle,
  state: State<'_, FileVaultState>,
) -> Result<(), CommandError> {
  let runtime = state.0.clone();
  mutate(&app, move || runtime.lock().map_err(CommandError::from)).await
}
#[cfg_attr(feature = "file-vault", tauri::command)]
pub(crate) async fn vault_delete(
  app: AppHandle,
  state: State<'_, FileVaultState>,
  confirmed: bool,
) -> Result<(), CommandError> {
  let runtime = state.0.clone();
  mutate(&app, move || {
    runtime
      .delete(confirmed, &mut LazyCredentials::default())
      .map_err(CommandError::from)
  })
  .await
}
#[cfg_attr(feature = "file-vault", tauri::command)]
pub(crate) async fn vault_change_password(
  app: AppHandle,
  state: State<'_, FileVaultState>,
  password: Option<String>,
  current_password: Option<String>,
  confirmed: bool,
) -> Result<(), CommandError> {
  let runtime = state.0.clone();
  let password = password.map(Zeroizing::new);
  let current = current_password.map(Zeroizing::new);
  mutate(&app, move || {
    runtime
      .change_password(
        current.as_deref().map(String::as_str),
        password.as_deref().map(String::as_str),
        confirmed,
        &mut LazyCredentials::default(),
      )
      .map_err(CommandError::from)
  })
  .await
}

#[cfg_attr(feature = "file-vault", tauri::command)]
pub(crate) async fn vault_import_foreign(
  app: AppHandle,
  state: State<'_, FileVaultState>,
  path: String,
  foreign_password: String,
  current_password: Option<String>,
  password: Option<String>,
  confirmed: bool,
  recovery: bool,
) -> Result<(), CommandError> {
  let foreign_password = Zeroizing::new(foreign_password);
  let current = current_password.map(Zeroizing::new);
  let password = password.map(Zeroizing::new);
  if !confirmed {
    return Err(CommandError {
      code: "vaultConfirmationRequired",
    });
  }
  let runtime = state.0.clone();
  mutate(&app, move || {
    // A raw keychain-bound file is not a portable backup. Do not request a
    // guessed credential based on a foreign, unauthenticated header.
    let foreign = read_foreign(std::path::Path::new(&path), &foreign_password)?;
    let mut credentials = LazyCredentials::default();
    let current = current.as_deref().map(String::as_str);
    let password = password.as_deref().map(String::as_str);
    if recovery {
      runtime.resume_foreign_import(&foreign, current, password, true, &mut credentials)
    } else {
      runtime.import_foreign(&foreign, current, password, true, &mut credentials)
    }
    .map_err(CommandError::from)
  })
  .await
}

fn read_foreign(path: &std::path::Path, password: &str) -> Result<vault_file::Vault, CommandError> {
  let metadata = std::fs::symlink_metadata(path).map_err(|_| CommandError { code: "vaultIo" })?;
  if !metadata.file_type().is_file() {
    return Err(CommandError {
      code: "vaultReconciliationFailed",
    });
  }
  let envelope = Envelope::read(File::open(path).map_err(|_| CommandError { code: "vaultIo" })?)
    .map_err(|error| CommandError {
      code: envelope_error(&error),
    })?;
  if envelope.protection() != vault_file::Protection::Password {
    return Err(CommandError {
      code: "vaultForeignCredentialRequired",
    });
  }
  envelope
    .unlock_password(password)
    .map_err(|error| CommandError {
      code: envelope_error(&error),
    })
}

#[cfg(test)]
#[path = "vault_command_tests.rs"]
mod tests;
