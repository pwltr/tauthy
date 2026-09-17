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
  sync::Mutex,
};

use crypto::hashes::blake2b::Blake2b256;
use iota_stronghold::{
  derive_vault_id,
  engine::snapshot::migration::{migrate, Version},
  Client, KeyProvider, SnapshotPath, Stronghold,
};
use tauri::{AppHandle, Manager, State};
use zeroize::Zeroize;

const APP_DATA_DIRECTORY: &str = "tauthy";
const SNAPSHOT_FILE_NAME: &str = "vault.stronghold";
const CLIENT_NAME: &[u8] = b"vault";
const STORE_NAME: &[u8] = b"vault";
const SNAPSHOT_MAGIC: &[u8; 5] = b"PARTI";
const SNAPSHOT_V2: [u8; 2] = [2, 0];
const SNAPSHOT_V3: [u8; 2] = [3, 0];
const INVALID_PASSWORD_MESSAGE: &str = "Unable to unlock the vault. Please try another password.";

pub struct VaultState(Mutex<Option<UnlockedVault>>);

impl Default for VaultState {
  fn default() -> Self {
    Self(Mutex::new(None))
  }
}

struct UnlockedVault {
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

fn store_key() -> Vec<u8> {
  // The legacy plugin stored records under the derived vault id, rather than
  // the literal location name. Keeping that key makes migrated data readable.
  derive_vault_id(STORE_NAME).as_ref().to_vec()
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
      "A previous vault migration backup already exists. Restart Tauthy to recover it.".into(),
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

fn vault_load_at(
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

  let backup_path = migration_backup_path(&opened.snapshot_path);
  if backup_path.exists() {
    std::fs::remove_file(backup_path)
      .map_err(|error| format!("Unable to clean up the vault migration backup: {error}"))?;
  }

  guard.replace(opened);
  Ok(())
}

fn vault_get_at(state: &VaultState) -> Result<String, String> {
  let guard = state
    .0
    .lock()
    .map_err(|_| "The vault state lock is unavailable.".to_string())?;
  let vault = guard
    .as_ref()
    .ok_or_else(|| "vault is locked".to_string())?;
  let record = vault
    .client
    .store()
    .get(&store_key())
    .map_err(|error| error.to_string())?
    .ok_or_else(|| "record not found".to_string())?;
  String::from_utf8(record).map_err(|error| error.to_string())
}

fn vault_save_at(state: &VaultState, record: String) -> Result<(), String> {
  let guard = state
    .0
    .lock()
    .map_err(|_| "The vault state lock is unavailable.".to_string())?;
  let vault = guard
    .as_ref()
    .ok_or_else(|| "vault is locked".to_string())?;
  vault
    .client
    .store()
    .insert(store_key(), record.into_bytes(), None)
    .map_err(|error| error.to_string())?;
  vault
    .stronghold
    .commit_with_keyprovider(
      &SnapshotPath::from_path(&vault.snapshot_path),
      &vault.key_provider,
    )
    .map_err(|error| error.to_string())
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

fn vault_status_at(state: &VaultState) -> Result<serde_json::Value, String> {
  let guard = state
    .0
    .lock()
    .map_err(|_| "The vault state lock is unavailable.".to_string())?;
  Ok(serde_json::json!({ "status": if guard.is_some() { "unlocked" } else { "locked" } }))
}

#[tauri::command]
pub async fn vault_load(
  app: AppHandle,
  state: State<'_, VaultState>,
  password: String,
) -> Result<(), String> {
  vault_load_at(&state, snapshot_path(&app)?, password)
}

#[tauri::command]
pub async fn vault_get(state: State<'_, VaultState>) -> Result<String, String> {
  vault_get_at(&state)
}

#[tauri::command]
pub async fn vault_save(state: State<'_, VaultState>, record: String) -> Result<(), String> {
  vault_save_at(&state, record)
}

#[tauri::command]
pub async fn vault_unload(state: State<'_, VaultState>) -> Result<(), String> {
  vault_unload_at(&state)
}

#[tauri::command]
pub async fn vault_status(state: State<'_, VaultState>) -> Result<serde_json::Value, String> {
  vault_status_at(&state)
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

    let updated = r#"[{"id":"after-migration"}]"#.to_string();
    vault_save_at(&state, updated.clone()).unwrap();
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
  fn current_snapshot_round_trips_and_rejects_a_wrong_password() {
    initialize_tests();
    let snapshot = temporary_snapshot("round-trip");
    let state = VaultState::default();
    let record = r#"[{"id":"round-trip"}]"#.to_string();

    vault_load_at(&state, snapshot.clone(), "correct horse".into()).unwrap();
    vault_save_at(&state, record.clone()).unwrap();
    vault_unload_at(&state).unwrap();
    assert!(vault_get_at(&state).is_err());

    let error = vault_load_at(&state, snapshot.clone(), "wrong password".into()).unwrap_err();
    assert!(error.contains("Please try another password."));

    vault_load_at(&state, snapshot.clone(), "correct horse".into()).unwrap();
    assert_eq!(vault_get_at(&state).unwrap(), record);
    vault_unload_at(&state).unwrap();
    std::fs::remove_file(snapshot).unwrap();
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
}
