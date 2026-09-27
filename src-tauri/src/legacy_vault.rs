//! Vault commands backed by the current Stronghold snapshot format.
//!
//! Existing Tauthy installations used Stronghold snapshot version 2. The first
//! successful unlock migrates those snapshots to version 3 through a verified,
//! recoverable replacement. The Tauri command API intentionally stays stable.

use std::{
  convert::TryInto,
  fs::File,
  io::Read,
  num::NonZeroU32,
  path::{Path, PathBuf},
  sync::{Arc, Mutex},
};

#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;

use crypto::hashes::blake2b::Blake2b256;
use iota_stronghold::{
  derive_vault_id,
  engine::snapshot::migration::{migrate, Version},
  Client, KeyProvider, SnapshotPath, Stronghold,
};
use tauri::{AppHandle, Manager, State};
use zeroize::Zeroize;

#[cfg(not(debug_assertions))]
const APP_DATA_DIRECTORY: &str = "tauthy";
#[cfg(debug_assertions)]
const APP_DATA_DIRECTORY: &str = "tauthy-dev";
const SNAPSHOT_FILE_NAME: &str = "vault.stronghold";
const CLIENT_NAME: &[u8] = b"vault";
const STORE_NAME: &[u8] = b"vault";
// Known-name regression fixtures only. Migration and password verification use
// the full raw store inventory, including unknown keys.
#[cfg(test)]
const OWNED_RECORD_NAMES: [&[u8]; 2] = [STORE_NAME, crate::sync::SYNC_STORE_NAME];
const SNAPSHOT_MAGIC: &[u8; 5] = b"PARTI";
const SNAPSHOT_V2: [u8; 2] = [2, 0];
const SNAPSHOT_V3: [u8; 2] = [3, 0];
const INVALID_PASSWORD_MESSAGE: &str = "Unable to unlock the vault. Please try another password.";

// Fixed private copies used ONLY by the new journaled migration reader. Never
// feed the canonical Stronghold path to the in-place v2 conversion routine.
use crate::vault_fs::MIGRATION_COPY_FILES;

/// Discard inert working copies, never restore/adopt them. A durable migration
/// or deletion journal must own this namespace. Caller holds the runtime mutex.
pub(crate) fn cleanup_migration_copy(
  directory: &Path,
) -> Result<(), crate::vault_transaction::Error> {
  use crate::{vault_journal, vault_transaction::Error};
  let mut paths = Vec::new();
  for name in MIGRATION_COPY_FILES {
    let path = directory.join(name);
    match std::fs::symlink_metadata(&path) {
      Ok(metadata) if metadata.file_type().is_file() => paths.push(path),
      Ok(_) => return Err(Error::LegacyCopyCleanupFailed),
      Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
      Err(_) => return Err(Error::LegacyCopyCleanupFailed),
    }
  }
  if paths.is_empty() {
    return Ok(());
  }
  let journal = vault_journal::read(directory)?.ok_or(Error::ReconciliationFailed)?;
  if !matches!(
    journal.operation,
    vault_journal::Operation::Migrate | vault_journal::Operation::Delete
  ) {
    return Err(Error::ReconciliationFailed);
  }
  for path in paths {
    crate::vault_fs::remove(&path).map_err(|_| Error::LegacyCopyCleanupFailed)?;
  }
  Ok(())
}

/// Production source reader for the new coordinator. Durable journal and a
/// fingerprint-matching source precede every working-copy effect. Uses a fixed,
/// private, bounded copy; a killed process leaves only recognizable inert files.
pub(crate) fn migration_records(
  source: &Path,
  password: &str,
) -> Result<crate::vault_file::Records, crate::vault_transaction::Error> {
  use crate::{
    vault_journal,
    vault_transaction::{self, Error},
  };
  let directory = source.parent().ok_or(Error::Io)?;
  if !matches!(
    source.file_name().and_then(|name| name.to_str()),
    Some("vault.stronghold" | "vault.stronghold.retired")
  ) {
    return Err(Error::ReconciliationFailed);
  }
  let journal = vault_journal::read(directory)?.ok_or(Error::ReconciliationFailed)?;
  if journal.operation != vault_journal::Operation::Migrate {
    return Err(Error::ReconciliationFailed);
  }
  let expected = journal
    .source_fingerprint
    .ok_or(Error::ReconciliationFailed)?;
  if vault_transaction::fingerprint(source)? != expected {
    return Err(Error::SourceChanged);
  }
  crate::vault_fs::require_supported(directory)
    .map_err(|_| Error::Journal(vault_journal::Error::Unsupported))?;
  cleanup_migration_copy(directory)?;
  let result = (|| {
    let mut temporary = crate::vault_fs::temporary(directory).map_err(|_| Error::Io)?;
    let mut input = File::open(source)
      .map_err(|_| Error::Io)?
      .take(256 * 1024 * 1024 + 1);
    let length = std::io::copy(&mut input, &mut temporary).map_err(|_| Error::Io)?;
    if length > 256 * 1024 * 1024 || vault_transaction::fingerprint(source)? != expected {
      return Err(Error::SourceChanged);
    }
    let copy = directory.join(MIGRATION_COPY_FILES[0]);
    crate::vault_fs::persist(temporary, &copy, false).map_err(|_| Error::Io)?;
    if vault_transaction::fingerprint(&copy)? != expected {
      return Err(Error::SourceChanged);
    }
    let state = VaultState::default();
    vault_load_at(&state, copy, password.to_string()).map_err(|error| {
      if error == INVALID_PASSWORD_MESSAGE {
        Error::Envelope(crate::vault_file::Error::Authentication)
      } else {
        Error::ReconciliationFailed
      }
    })?;
    let records = state
      .with_unlocked(|vault| vault.raw_records())
      .map_err(|_| Error::ReconciliationFailed);
    vault_unload_at(&state).map_err(|_| Error::ReconciliationFailed)?;
    if vault_transaction::fingerprint(source)? != expected {
      return Err(Error::SourceChanged);
    }
    records
  })();
  // Cleanup failures are about the disposable copy, not active-vault corruption.
  cleanup_migration_copy(directory)?;
  result
}

#[derive(Clone)]
pub struct VaultState(Arc<Mutex<Option<UnlockedVault>>>);

impl Default for VaultState {
  fn default() -> Self {
    Self(Arc::new(Mutex::new(None)))
  }
}

pub(crate) struct UnlockedVault {
  stronghold: Stronghold,
  client: Client,
  key_provider: KeyProvider,
  snapshot_path: PathBuf,
}

fn legacy_password_to_key(password: &str) -> [u8; 32] {
  let mut derived_key = [0; 64];
  crypto::keys::pbkdf::PBKDF2_HMAC_SHA512(
    password.as_bytes(),
    b"tauri",
    NonZeroU32::new(100).expect("PBKDF2 rounds are non-zero"),
    &mut derived_key,
  );

  let key = derived_key[0..32]
    .try_into()
    .expect("the derived key has at least 32 bytes");
  derived_key.zeroize();
  key
}

fn current_key_provider(password: &str) -> Result<KeyProvider, String> {
  KeyProvider::with_passphrase_hashed(password.as_bytes().to_vec(), Blake2b256::new())
    .map_err(|error| error.to_string())
}

pub(crate) fn store_key_for(name: &[u8]) -> Vec<u8> {
  // The legacy plugin stored records under the derived vault id, rather than
  // the literal location name. Keeping that key makes migrated data readable.
  derive_vault_id(name).as_ref().to_vec()
}

fn store_key() -> Vec<u8> {
  store_key_for(STORE_NAME)
}

impl VaultState {
  pub(crate) fn with_unlocked<T>(
    &self,
    operation: impl FnOnce(&UnlockedVault) -> Result<T, String>,
  ) -> Result<T, String> {
    let guard = self
      .0
      .lock()
      .map_err(|_| "The vault state lock is unavailable.".to_string())?;
    let vault = guard
      .as_ref()
      .ok_or_else(|| "vault is locked".to_string())?;
    operation(vault)
  }
}

impl UnlockedVault {
  pub(crate) fn raw_records(&self) -> Result<crate::vault_file::Records, String> {
    let store = self.client.store();
    let mut records = crate::vault_file::Records::default();
    for key in store.keys().map_err(|error| error.to_string())? {
      let value = store
        .get(&key)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "The vault record inventory changed during extraction.".to_string())?;
      records.insert(key, value);
    }
    Ok(records)
  }

  #[cfg(test)]
  fn owned_records(&self) -> Result<Vec<zeroize::Zeroizing<Option<Vec<u8>>>>, String> {
    OWNED_RECORD_NAMES
      .iter()
      .map(|name| self.get_record(name).map(zeroize::Zeroizing::new))
      .collect()
  }

  pub(crate) fn get_record(&self, name: &[u8]) -> Result<Option<Vec<u8>>, String> {
    self
      .client
      .store()
      .get(&store_key_for(name))
      .map_err(|error| error.to_string())
  }

  pub(crate) fn put_record(&self, name: &[u8], value: Vec<u8>) -> Result<(), String> {
    self
      .client
      .store()
      .insert(store_key_for(name), value, None)
      .map(|_| ())
      .map_err(|error| error.to_string())
  }

  pub(crate) fn delete_record(&self, name: &[u8]) -> Result<(), String> {
    self
      .client
      .store()
      .delete(&store_key_for(name))
      .map(|_| ())
      .map_err(|error| error.to_string())
  }

  pub(crate) fn commit(&self) -> Result<(), String> {
    self
      .stronghold
      .commit_with_keyprovider(
        &SnapshotPath::from_path(&self.snapshot_path),
        &self.key_provider,
      )
      .map_err(|error| error.to_string())?;
    restrict_snapshot_permissions(&self.snapshot_path)
  }
}

fn snapshot_path(app: &AppHandle) -> Result<PathBuf, String> {
  app
    .path()
    .data_dir()
    .map(|path| path.join(APP_DATA_DIRECTORY).join(SNAPSHOT_FILE_NAME))
    .map_err(|error| error.to_string())
}

fn migration_path(snapshot_path: &Path) -> PathBuf {
  snapshot_path.with_extension("stronghold.migrating")
}

fn migration_backup_path(snapshot_path: &Path) -> PathBuf {
  snapshot_path.with_extension("stronghold.v2-backup")
}

fn password_migration_path(snapshot_path: &Path) -> PathBuf {
  snapshot_path.with_extension("stronghold.password-migrating")
}

fn password_backup_path(snapshot_path: &Path) -> PathBuf {
  snapshot_path.with_extension("stronghold.backup")
}

#[cfg(unix)]
fn restrict_snapshot_permissions(snapshot_path: &Path) -> Result<(), String> {
  if !snapshot_path.exists() {
    return Ok(());
  }

  let mut permissions = std::fs::metadata(snapshot_path)
    .map_err(|error| format!("Unable to read vault permissions: {error}"))?
    .permissions();
  permissions.set_mode(0o600);
  std::fs::set_permissions(snapshot_path, permissions)
    .map_err(|error| format!("Unable to restrict vault permissions: {error}"))
}

#[cfg(not(unix))]
fn restrict_snapshot_permissions(_snapshot_path: &Path) -> Result<(), String> {
  Ok(())
}

fn snapshot_version(snapshot_path: &Path) -> Result<[u8; 2], String> {
  let mut header = [0; 7];
  File::open(snapshot_path)
    .and_then(|mut file| file.read_exact(&mut header))
    .map_err(|error| format!("Unable to read the vault snapshot: {error}"))?;

  if &header[..5] != SNAPSHOT_MAGIC {
    return Err("The vault snapshot has an invalid header.".into());
  }

  Ok([header[5], header[6]])
}

fn restore_interrupted_migration(snapshot_path: &Path) -> Result<(), String> {
  let backup_path = migration_backup_path(snapshot_path);
  if !snapshot_path.exists() && backup_path.exists() {
    std::fs::rename(&backup_path, snapshot_path)
      .map_err(|error| format!("Unable to restore the vault migration backup: {error}"))?;
  }
  Ok(())
}

fn restore_interrupted_password_change(snapshot_path: &Path) -> Result<(), String> {
  let backup_path = password_backup_path(snapshot_path);
  let temporary_path = password_migration_path(snapshot_path);
  if !snapshot_path.exists() && backup_path.exists() {
    std::fs::rename(&backup_path, snapshot_path)
      .map_err(|error| format!("Unable to restore the password-change backup: {error}"))?;
  }
  if temporary_path.exists() {
    std::fs::remove_file(&temporary_path)
      .map_err(|error| format!("Unable to remove an incomplete password change: {error}"))?;
  }
  Ok(())
}

fn open_current_snapshot(snapshot_path: &Path, password: &str) -> Result<UnlockedVault, String> {
  let key_provider = current_key_provider(password)?;
  let stronghold = Stronghold::default();
  let client = stronghold
    .load_client_from_snapshot(
      CLIENT_NAME,
      &key_provider,
      &SnapshotPath::from_path(snapshot_path),
    )
    .map_err(|_| INVALID_PASSWORD_MESSAGE.to_string())?;

  Ok(UnlockedVault {
    stronghold,
    client,
    key_provider,
    snapshot_path: snapshot_path.to_path_buf(),
  })
}

fn migrate_legacy_snapshot(snapshot_path: &Path, password: &str) -> Result<UnlockedVault, String> {
  let temporary_path = migration_path(snapshot_path);
  let backup_path = migration_backup_path(snapshot_path);

  if backup_path.exists() {
    return Err(
      "A legacy vault and migration backup both exist. Move the .v2-backup file out of the Tauthy data directory, then try again."
        .into(),
    );
  }
  if temporary_path.exists() {
    std::fs::remove_file(&temporary_path)
      .map_err(|error| format!("Unable to remove an incomplete vault migration: {error}"))?;
  }

  let mut legacy_key = legacy_password_to_key(password);
  let migration_result = migrate(
    Version::v2(snapshot_path, &legacy_key, &[]),
    Version::v3(&temporary_path, password.as_bytes()),
  );
  legacy_key.zeroize();

  if migration_result.is_err() {
    let _ = std::fs::remove_file(&temporary_path);
    return Err(INVALID_PASSWORD_MESSAGE.into());
  }

  if let Err(error) = restrict_snapshot_permissions(&temporary_path) {
    let _ = std::fs::remove_file(&temporary_path);
    return Err(error);
  }

  // Never replace the user's vault until the migrated snapshot can be opened.
  let verified = match open_current_snapshot(&temporary_path, password) {
    Ok(verified) => verified,
    Err(error) => {
      let _ = std::fs::remove_file(&temporary_path);
      return Err(error);
    }
  };
  verified
    .stronghold
    .clear()
    .map_err(|error| error.to_string())?;

  restrict_snapshot_permissions(snapshot_path)?;
  std::fs::rename(snapshot_path, &backup_path)
    .map_err(|error| format!("Unable to back up the legacy vault: {error}"))?;

  if let Err(error) = std::fs::rename(&temporary_path, snapshot_path) {
    let _ = std::fs::rename(&backup_path, snapshot_path);
    return Err(format!("Unable to install the migrated vault: {error}"));
  }

  let opened = match open_current_snapshot(snapshot_path, password) {
    Ok(opened) => opened,
    Err(error) => {
      let _ = std::fs::remove_file(snapshot_path);
      let _ = std::fs::rename(&backup_path, snapshot_path);
      return Err(format!(
        "The migrated vault failed final verification: {error}"
      ));
    }
  };

  std::fs::remove_file(&backup_path)
    .map_err(|error| format!("Unable to remove the completed migration backup: {error}"))?;
  Ok(opened)
}

pub(crate) fn vault_load_at(
  state: &VaultState,
  snapshot_path: PathBuf,
  mut password: String,
) -> Result<(), String> {
  // The same mutex serializes migration, reads, writes, and lock operations.
  let mut guard = state
    .0
    .lock()
    .map_err(|_| "The vault state lock is unavailable.".to_string())?;
  if let Some(previous) = guard.take() {
    previous
      .stronghold
      .clear()
      .map_err(|error| error.to_string())?;
  }

  let opened = (|| {
    restore_interrupted_migration(&snapshot_path)?;
    restore_interrupted_password_change(&snapshot_path)?;

    if snapshot_path.exists() {
      match snapshot_version(&snapshot_path)? {
        SNAPSHOT_V2 => migrate_legacy_snapshot(&snapshot_path, &password),
        SNAPSHOT_V3 => open_current_snapshot(&snapshot_path, &password),
        version => Err(format!(
          "Unsupported vault snapshot version {}.{}.",
          version[0], version[1]
        )),
      }
    } else {
      let key_provider = current_key_provider(&password)?;
      let stronghold = Stronghold::default();
      let client = stronghold
        .create_client(CLIENT_NAME)
        .map_err(|error| error.to_string())?;
      Ok(UnlockedVault {
        stronghold,
        client,
        key_provider,
        snapshot_path,
      })
    }
  })();
  password.zeroize();
  let opened = opened?;

  restrict_snapshot_permissions(&opened.snapshot_path)?;

  let backup_path = migration_backup_path(&opened.snapshot_path);
  if backup_path.exists() {
    std::fs::remove_file(backup_path)
      .map_err(|error| format!("Unable to clean up the vault migration backup: {error}"))?;
  }
  let password_backup = password_backup_path(&opened.snapshot_path);
  if password_backup.exists() {
    std::fs::remove_file(password_backup)
      .map_err(|error| format!("Unable to clean up the password-change backup: {error}"))?;
  }

  guard.replace(opened);
  Ok(())
}

pub(crate) fn vault_record_at(state: &VaultState) -> Result<Option<String>, String> {
  let guard = state
    .0
    .lock()
    .map_err(|_| "The vault state lock is unavailable.".to_string())?;
  let Some(vault) = guard.as_ref() else {
    return Ok(None);
  };
  let record = vault
    .client
    .store()
    .get(&store_key())
    .map_err(|error| error.to_string())?
    .ok_or_else(|| "record not found".to_string())?;
  String::from_utf8(record)
    .map(Some)
    .map_err(|error| error.to_string())
}

fn vault_get_at(state: &VaultState) -> Result<String, String> {
  vault_record_at(state)?.ok_or_else(|| "vault is locked".to_string())
}

pub(crate) fn vault_save_at(state: &VaultState, record: String) -> Result<(), String> {
  state.with_unlocked(|vault| {
    vault.put_record(STORE_NAME, record.into_bytes())?;
    vault.commit()
  })
}

fn vault_unload_at(state: &VaultState) -> Result<(), String> {
  let mut guard = state
    .0
    .lock()
    .map_err(|_| "The vault state lock is unavailable.".to_string())?;
  if let Some(vault) = guard.take() {
    vault
      .stronghold
      .clear()
      .map_err(|error| error.to_string())?;
  }
  Ok(())
}

pub(crate) fn vault_change_password_at(
  state: &VaultState,
  mut password: String,
) -> Result<(), String> {
  let mut guard = state
    .0
    .lock()
    .map_err(|_| "The vault state lock is unavailable.".to_string())?;
  let vault = guard
    .as_mut()
    .ok_or_else(|| "vault is locked".to_string())?;
  let temporary_path = password_migration_path(&vault.snapshot_path);
  let backup_path = password_backup_path(&vault.snapshot_path);

  if temporary_path.exists() {
    std::fs::remove_file(&temporary_path)
      .map_err(|error| format!("Unable to remove an incomplete password change: {error}"))?;
  }
  if backup_path.exists() {
    std::fs::remove_file(&backup_path)
      .map_err(|error| format!("Unable to remove an old password backup: {error}"))?;
  }

  let result = (|| {
    let replacement_key = current_key_provider(&password)?;
    vault
      .stronghold
      .commit_with_keyprovider(&SnapshotPath::from_path(&temporary_path), &replacement_key)
      .map_err(|error| error.to_string())?;
    restrict_snapshot_permissions(&temporary_path)?;

    // Verify the replacement password and every record Tauthy currently owns
    // before moving the user's existing snapshot out of the way.
    let verified = open_current_snapshot(&temporary_path, &password)?;
    if !vault.raw_records()?.same_as(&verified.raw_records()?) {
      let _ = std::fs::remove_file(&temporary_path);
      return Err("The password replacement failed record verification.".into());
    }
    verified
      .stronghold
      .clear()
      .map_err(|error| error.to_string())?;

    std::fs::rename(&vault.snapshot_path, &backup_path).map_err(|error| {
      format!("Unable to back up the vault before changing its password: {error}")
    })?;
    if let Err(error) = std::fs::rename(&temporary_path, &vault.snapshot_path) {
      let _ = std::fs::rename(&backup_path, &vault.snapshot_path);
      return Err(format!(
        "Unable to install the password replacement: {error}"
      ));
    }
    if let Err(error) = std::fs::remove_file(&backup_path) {
      let _ = std::fs::remove_file(&vault.snapshot_path);
      let _ = std::fs::rename(&backup_path, &vault.snapshot_path);
      return Err(format!(
        "Unable to complete the password replacement: {error}"
      ));
    }
    vault.key_provider = replacement_key;
    Ok(())
  })();
  password.zeroize();
  if result.is_err() {
    let _ = std::fs::remove_file(&temporary_path);
  }
  result
}

fn vault_status_at(state: &VaultState) -> Result<serde_json::Value, String> {
  let guard = state
    .0
    .lock()
    .map_err(|_| "The vault state lock is unavailable.".to_string())?;
  Ok(serde_json::json!({ "status": if guard.is_some() { "unlocked" } else { "locked" } }))
}

#[cfg_attr(not(feature = "file-vault"), tauri::command)]
pub async fn vault_load(
  app: AppHandle,
  state: State<'_, VaultState>,
  password: String,
) -> Result<(), String> {
  let snapshot_path = snapshot_path(&app)?;
  let state = state.inner().clone();
  tauri::async_runtime::spawn_blocking(move || vault_load_at(&state, snapshot_path, password))
    .await
    .map_err(|error| format!("Vault task failed: {error}"))??;
  let _ = crate::tray::refresh_menu(&app);
  Ok(())
}

#[cfg_attr(not(feature = "file-vault"), tauri::command)]
pub async fn vault_get(state: State<'_, VaultState>) -> Result<String, String> {
  vault_get_at(&state)
}

#[cfg_attr(not(feature = "file-vault"), tauri::command)]
pub async fn vault_save(
  app: AppHandle,
  state: State<'_, VaultState>,
  record: String,
) -> Result<(), String> {
  let state = state.inner().clone();
  tauri::async_runtime::spawn_blocking(move || vault_save_at(&state, record))
    .await
    .map_err(|error| format!("Vault task failed: {error}"))??;
  let _ = crate::tray::refresh_menu(&app);
  Ok(())
}

#[cfg_attr(not(feature = "file-vault"), tauri::command)]
pub async fn vault_unload(app: AppHandle, state: State<'_, VaultState>) -> Result<(), String> {
  vault_unload_at(&state)?;
  let _ = crate::tray::refresh_menu(&app);
  Ok(())
}

#[cfg_attr(not(feature = "file-vault"), tauri::command)]
pub async fn vault_status(state: State<'_, VaultState>) -> Result<serde_json::Value, String> {
  vault_status_at(&state)
}

#[cfg_attr(not(feature = "file-vault"), tauri::command)]
pub async fn vault_change_password(
  state: State<'_, VaultState>,
  password: String,
) -> Result<(), String> {
  let state = state.inner().clone();
  tauri::async_runtime::spawn_blocking(move || vault_change_password_at(&state, password))
    .await
    .map_err(|error| format!("Vault task failed: {error}"))?
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::sync::Once;

  static FAST_ENCRYPTION: Once = Once::new();

  fn initialize_tests() {
    FAST_ENCRYPTION.call_once(|| {
      iota_stronghold::engine::snapshot::try_set_encrypt_work_factor(0).unwrap();
    });
  }

  fn temporary_snapshot(name: &str) -> PathBuf {
    std::env::temp_dir().join(format!(
      "tauthy-{name}-{}.stronghold",
      rand::random::<u64>()
    ))
  }

  fn copy_legacy_fixture(destination: &Path) {
    let fixture =
      PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/legacy-vault.stronghold");
    std::fs::copy(fixture, destination).unwrap();
  }

  #[test]
  fn production_reader_requires_journal_and_handles_v3_wrong_password_and_orphans() {
    use crate::{
      vault_journal,
      vault_transaction::{Coordinator, Credentials, Error},
    };
    struct NoCredentials;
    impl Credentials for NoCredentials {
      fn get(
        &mut self,
        _: &vault_journal::Identity,
      ) -> Result<Option<zeroize::Zeroizing<[u8; 32]>>, Error> {
        Err(Error::CredentialUnavailable)
      }
      fn set(&mut self, _: &vault_journal::Identity, _: &[u8; 32]) -> Result<(), Error> {
        Err(Error::CredentialUnavailable)
      }
      fn remove(&mut self, _: &vault_journal::Identity) -> Result<(), Error> {
        Err(Error::CredentialUnavailable)
      }
    }
    initialize_tests();
    let directory = tempfile::tempdir().unwrap();
    let source = directory.path().join("vault.stronghold");
    let state = VaultState::default();
    vault_load_at(&state, source.clone(), "password".into()).unwrap();
    state
      .with_unlocked(|vault| {
        vault.put_record(STORE_NAME, b"accounts".to_vec())?;
        vault.put_record(crate::sync::SYNC_STORE_NAME, b"sync".to_vec())?;
        vault
          .client
          .store()
          .insert(vec![255, 0], vec![11, 255], None)
          .unwrap();
        vault.commit()
      })
      .unwrap();
    let expected = state.with_unlocked(|vault| vault.raw_records()).unwrap();
    vault_unload_at(&state).unwrap();
    let original = std::fs::read(&source).unwrap();
    assert_eq!(
      migration_records(&source, "password").err(),
      Some(Error::ReconciliationFailed)
    );
    assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 1);
    let mut credentials = NoCredentials;
    let mut hook = |point| {
      if point == "afterJournal" {
        Err(Error::Interrupted)
      } else {
        Ok(())
      }
    };
    let mut coordinator = Coordinator::new(directory.path(), &mut credentials, &mut hook);
    assert_eq!(
      coordinator
        .begin_migration("password", &mut |_, _| panic!("reader preceded interrupt"))
        .err(),
      Some(Error::Interrupted)
    );
    let journal = std::fs::read(directory.path().join("vault.transaction.json")).unwrap();
    for name in MIGRATION_COPY_FILES {
      std::fs::write(directory.path().join(name), b"interrupted inert copy").unwrap();
    }
    assert_eq!(
      migration_records(&source, "wrong").err(),
      Some(Error::Envelope(crate::vault_file::Error::Authentication))
    );
    for name in MIGRATION_COPY_FILES {
      assert!(!directory.path().join(name).exists());
    }
    assert!(migration_records(&source, "password")
      .unwrap()
      .same_as(&expected));
    assert_eq!(std::fs::read(&source).unwrap(), original);
    assert_eq!(
      std::fs::read(directory.path().join("vault.transaction.json")).unwrap(),
      journal
    );
    assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 2);
    #[cfg(unix)]
    {
      let copy = directory.path().join(MIGRATION_COPY_FILES[0]);
      let link = directory.path().join(MIGRATION_COPY_FILES[1]);
      let outside = tempfile::NamedTempFile::new().unwrap();
      std::fs::write(&copy, b"inert").unwrap();
      std::os::unix::fs::symlink(outside.path(), &link).unwrap();
      assert_eq!(
        cleanup_migration_copy(directory.path()),
        Err(Error::LegacyCopyCleanupFailed)
      );
      assert!(copy.exists());
      assert!(outside.path().exists());
      assert_eq!(std::fs::read(&source).unwrap(), original);
      std::fs::remove_file(link).unwrap();
      cleanup_migration_copy(directory.path()).unwrap();
    }
    std::fs::write(&source, b"changed").unwrap();
    assert_eq!(
      migration_records(&source, "password").err(),
      Some(Error::SourceChanged)
    );
    assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 2);
  }

  #[test]
  fn orphan_working_copy_without_a_journal_is_recovery_not_creation_or_deletion() {
    let directory = tempfile::tempdir().unwrap();
    let copy = directory.path().join(MIGRATION_COPY_FILES[0]);
    std::fs::write(&copy, b"inert").unwrap();
    assert_eq!(
      cleanup_migration_copy(directory.path()),
      Err(crate::vault_transaction::Error::ReconciliationFailed)
    );
    assert!(copy.exists());
    assert_eq!(
      crate::vault_metadata::inspect(directory.path()).err(),
      Some(crate::vault_metadata::Error::ReconciliationFailed)
    );
  }

  #[cfg(unix)]
  fn assert_private_permissions(snapshot: &Path) {
    assert_eq!(
      std::fs::metadata(snapshot).unwrap().permissions().mode() & 0o777,
      0o600
    );
  }

  #[cfg(not(unix))]
  fn assert_private_permissions(_snapshot: &Path) {}

  #[cfg(unix)]
  fn make_permissions_insecure(snapshot: &Path) {
    let mut permissions = std::fs::metadata(snapshot).unwrap().permissions();
    permissions.set_mode(0o644);
    std::fs::set_permissions(snapshot, permissions).unwrap();
  }

  #[cfg(not(unix))]
  fn make_permissions_insecure(_snapshot: &Path) {}

  #[test]
  fn password_derivation_matches_the_legacy_plugin() {
    assert_eq!(
      legacy_password_to_key("tauthy"),
      [
        118, 117, 137, 95, 172, 65, 211, 163, 23, 173, 23, 96, 45, 27, 4, 187, 62, 194, 222, 20,
        169, 206, 190, 244, 11, 44, 95, 167, 224, 71, 2, 208,
      ]
    );
  }

  #[test]
  fn migrates_the_legacy_snapshot_and_preserves_its_record() {
    initialize_tests();
    let snapshot = temporary_snapshot("migration");
    copy_legacy_fixture(&snapshot);
    let state = VaultState::default();

    vault_load_at(&state, snapshot.clone(), "correct horse".into()).unwrap();

    assert_eq!(snapshot_version(&snapshot).unwrap(), SNAPSHOT_V3);
    assert_eq!(
      vault_get_at(&state).unwrap(),
      r#"[{"id":"legacy-fixture","secret":"JBSWY3DPEHPK3PXP"}]"#
    );
    assert!(!migration_path(&snapshot).exists());
    assert!(!migration_backup_path(&snapshot).exists());
    assert_private_permissions(&snapshot);

    let updated = r#"[{"id":"after-migration"}]"#.to_string();
    vault_save_at(&state, updated.clone()).unwrap();
    assert_private_permissions(&snapshot);
    vault_unload_at(&state).unwrap();

    vault_load_at(&state, snapshot.clone(), "correct horse".into()).unwrap();
    assert_eq!(vault_get_at(&state).unwrap(), updated);
    vault_unload_at(&state).unwrap();
    std::fs::remove_file(snapshot).unwrap();
  }

  #[test]
  fn wrong_migration_password_leaves_the_legacy_snapshot_untouched() {
    initialize_tests();
    let snapshot = temporary_snapshot("wrong-migration-password");
    copy_legacy_fixture(&snapshot);
    let before = std::fs::read(&snapshot).unwrap();
    let state = VaultState::default();

    let error = vault_load_at(&state, snapshot.clone(), "wrong password".into()).unwrap_err();

    assert!(error.contains("Please try another password."));
    assert_eq!(std::fs::read(&snapshot).unwrap(), before);
    assert!(!migration_path(&snapshot).exists());
    assert!(!migration_backup_path(&snapshot).exists());
    std::fs::remove_file(snapshot).unwrap();
  }

  #[test]
  fn conflicting_legacy_backup_has_actionable_recovery_instructions() {
    initialize_tests();
    let snapshot = temporary_snapshot("conflicting-backup");
    let backup = migration_backup_path(&snapshot);
    copy_legacy_fixture(&snapshot);
    copy_legacy_fixture(&backup);
    let state = VaultState::default();

    let error = vault_load_at(&state, snapshot.clone(), "correct horse".into()).unwrap_err();

    assert!(error.contains("Move the .v2-backup file"));
    assert!(snapshot.exists());
    assert!(backup.exists());
    std::fs::remove_file(snapshot).unwrap();
    std::fs::remove_file(backup).unwrap();
  }

  #[test]
  fn current_snapshot_round_trips_and_rejects_a_wrong_password() {
    initialize_tests();
    let snapshot = temporary_snapshot("round-trip");
    let state = VaultState::default();
    let record = r#"[{"id":"round-trip"}]"#.to_string();

    vault_load_at(&state, snapshot.clone(), "correct horse".into()).unwrap();
    vault_save_at(&state, record.clone()).unwrap();
    assert_private_permissions(&snapshot);
    vault_unload_at(&state).unwrap();
    assert!(vault_get_at(&state).is_err());

    // A successful unlock also hardens snapshots created by older releases.
    make_permissions_insecure(&snapshot);

    let error = vault_load_at(&state, snapshot.clone(), "wrong password".into()).unwrap_err();
    assert!(error.contains("Please try another password."));

    vault_load_at(&state, snapshot.clone(), "correct horse".into()).unwrap();
    assert_private_permissions(&snapshot);
    assert_eq!(vault_get_at(&state).unwrap(), record);
    vault_unload_at(&state).unwrap();
    std::fs::remove_file(snapshot).unwrap();
  }

  #[test]
  fn record_inventory_preserves_accounts_and_opaque_sync_state_across_password_change() {
    initialize_tests();
    let directory = tempfile::tempdir().unwrap();
    let snapshot = directory.path().join("vault.stronghold");
    let state = VaultState::default();
    // Include unknown fields and non-JSON bytes so preservation cannot depend
    // on today's account/sync deserializers or their default values.
    let accounts = br#"[{"id":"stable-id","futureField":{"keep":true}}]"#.to_vec();
    let sync = vec![0, 255, 1, 2, 3];
    vault_load_at(&state, snapshot.clone(), "old password".into()).unwrap();
    state
      .with_unlocked(|vault| {
        vault.put_record(STORE_NAME, accounts.clone())?;
        vault.put_record(crate::sync::SYNC_STORE_NAME, sync.clone())?;
        vault.commit()
      })
      .unwrap();
    let before = state.with_unlocked(|vault| vault.owned_records()).unwrap();

    vault_change_password_at(&state, "new password".into()).unwrap();
    vault_unload_at(&state).unwrap();
    vault_load_at(&state, snapshot, "new password".into()).unwrap();
    let after = state.with_unlocked(|vault| vault.owned_records()).unwrap();

    assert_eq!(before, after);
    assert_eq!(after[0].as_ref(), Some(&accounts));
    assert_eq!(after[1].as_ref(), Some(&sync));
  }

  #[test]
  fn record_inventory_distinguishes_missing_records_from_empty_records() {
    initialize_tests();
    let directory = tempfile::tempdir().unwrap();
    let state = VaultState::default();
    vault_load_at(
      &state,
      directory.path().join("vault.stronghold"),
      String::new(),
    )
    .unwrap();
    state
      .with_unlocked(|vault| {
        let missing = vault.owned_records()?;
        assert!(missing.iter().all(|record| record.is_none()));
        vault.put_record(STORE_NAME, Vec::new())?;
        let present = vault.owned_records()?;
        assert_eq!(present[0].as_ref(), Some(&Vec::new()));
        assert!(present[1].is_none());
        Ok(())
      })
      .unwrap();
  }

  #[test]
  fn encrypted_file_preserves_all_stronghold_store_keys_without_touching_source() {
    initialize_tests();
    let directory = tempfile::tempdir().unwrap();
    let snapshot = directory.path().join("vault.stronghold");
    let state = VaultState::default();
    vault_load_at(&state, snapshot.clone(), String::new()).unwrap();
    state
      .with_unlocked(|vault| {
        vault.put_record(STORE_NAME, b"[]".to_vec())?;
        vault.put_record(crate::sync::SYNC_STORE_NAME, vec![0, 255])?;
        vault
          .client
          .store()
          .insert(vec![13, 37], vec![4, 5, 6], None)
          .map_err(|error| error.to_string())?;
        vault.commit()
      })
      .unwrap();
    let source = std::fs::read(&snapshot).unwrap();
    let extracted = state.with_unlocked(|vault| vault.raw_records()).unwrap();
    let new_vault = crate::vault_file::Vault::create(extracted, None).unwrap();
    let encoded = new_vault.seal().unwrap();
    let reopened = crate::vault_file::Envelope::read(encoded.as_slice())
      .unwrap()
      .unlock_credential(Some(*new_vault.credential_key()))
      .unwrap();
    assert!(reopened.records.same_as(&new_vault.records));
    assert_eq!(reopened.records.get(&[13, 37]), Some([4, 5, 6].as_slice()));
    assert_eq!(std::fs::read(&snapshot).unwrap(), source);
    // Protection changes must preserve unknown records too.
    vault_change_password_at(&state, "replacement".into()).unwrap();
    let changed = state.with_unlocked(|vault| vault.raw_records()).unwrap();
    assert!(changed.same_as(&reopened.records));
  }

  #[test]
  fn legacy_fixture_converts_to_envelope_only_through_a_copy() {
    initialize_tests();
    let directory = tempfile::tempdir().unwrap();
    let original = directory.path().join("original.stronghold");
    let working = directory.path().join("transaction.stronghold");
    copy_legacy_fixture(&original);
    let before = std::fs::read(&original).unwrap();
    std::fs::copy(&original, &working).unwrap();
    let state = VaultState::default();
    vault_load_at(&state, working, "correct horse".into()).unwrap();
    let records = state.with_unlocked(|vault| vault.raw_records()).unwrap();
    let envelope = crate::vault_file::Vault::create(records, Some("correct horse")).unwrap();
    let encoded = envelope.seal().unwrap();
    let reopened = crate::vault_file::Envelope::read(encoded.as_slice())
      .unwrap()
      .unlock_password("correct horse")
      .unwrap();
    assert!(envelope.records.same_as(&reopened.records));
    assert_eq!(std::fs::read(&original).unwrap(), before);
    assert_eq!(snapshot_version(&original).unwrap(), SNAPSHOT_V2);
  }

  #[test]
  fn restores_an_interrupted_migration_backup() {
    initialize_tests();
    let snapshot = temporary_snapshot("recovery");
    let backup = migration_backup_path(&snapshot);
    copy_legacy_fixture(&backup);
    let state = VaultState::default();

    vault_load_at(&state, snapshot.clone(), "correct horse".into()).unwrap();

    assert_eq!(snapshot_version(&snapshot).unwrap(), SNAPSHOT_V3);
    assert_eq!(
      vault_get_at(&state).unwrap(),
      r#"[{"id":"legacy-fixture","secret":"JBSWY3DPEHPK3PXP"}]"#
    );
    assert!(!backup.exists());
    vault_unload_at(&state).unwrap();
    std::fs::remove_file(snapshot).unwrap();
  }

  #[cfg(unix)]
  #[test]
  fn coordinator_migrates_real_v2_fixture_after_journaling_and_retires_exact_source() {
    use crate::vault_journal::{self, Identity, Phase};
    use crate::vault_transaction::{Coordinator, Credentials, Error};
    use zeroize::Zeroizing;
    struct NoCredentials;
    impl Credentials for NoCredentials {
      fn remove(&mut self, _: &Identity) -> Result<(), Error> {
        Err(Error::CredentialUnavailable)
      }
      fn get(&mut self, _: &Identity) -> Result<Option<Zeroizing<[u8; 32]>>, Error> {
        Err(Error::CredentialUnavailable)
      }
      fn set(&mut self, _: &Identity, _: &[u8; 32]) -> Result<(), Error> {
        Err(Error::CredentialUnavailable)
      }
    }
    initialize_tests();
    let directory = tempfile::tempdir().unwrap();
    let source = directory.path().join("vault.stronghold");
    copy_legacy_fixture(&source);
    let original = std::fs::read(&source).unwrap();
    let mut reader = |path: &Path, password: &str| -> Result<crate::vault_file::Records, Error> {
      assert!(vault_journal::read(directory.path()).unwrap().is_some());
      let records = migration_records(path, password)?;
      for name in MIGRATION_COPY_FILES {
        assert!(!directory.path().join(name).exists());
      }
      assert_eq!(std::fs::read(path).unwrap(), original);
      assert_eq!(snapshot_version(path).unwrap(), SNAPSHOT_V2);
      Ok(records)
    };
    let mut credentials = NoCredentials;
    let mut hook = |_: &'static str| Ok(());
    let mut coordinator = Coordinator::new(directory.path(), &mut credentials, &mut hook);
    let candidate = coordinator
      .begin_migration("correct horse", &mut reader)
      .unwrap();
    let installed = coordinator
      .resume(Some("correct horse"), &mut reader)
      .unwrap();
    assert!(candidate.records.same_as(&installed.records));
    assert!(!source.exists());
    let retired = directory.path().join("vault.stronghold.retired");
    assert_eq!(std::fs::read(&retired).unwrap(), original);
    assert_eq!(snapshot_version(&retired).unwrap(), SNAPSHOT_V2);
    assert_private_permissions(&retired);
    assert_eq!(
      vault_journal::read(directory.path())
        .unwrap()
        .unwrap()
        .phase,
      Phase::Completed
    );
  }
}
