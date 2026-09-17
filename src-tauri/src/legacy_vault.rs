//! Compatibility commands for snapshots created by the original Tauri v1
//! Stronghold plugin. Keep this module until existing installations have had
//! a chance to migrate to a current Stronghold snapshot format.

use std::{convert::TryInto, path::PathBuf, time::Duration};

use async_std::sync::Mutex;

#[allow(dead_code, unused_mut)]
#[rustfmt::skip]
#[path = "../../tauri-plugin-stronghold/src/stronghold.rs"]
mod stronghold;

use iota_stronghold::Location;
use once_cell::sync::Lazy;
use stronghold::Api;
use tauri::{AppHandle, Manager};
use zeroize::Zeroize;

const APP_DATA_DIRECTORY: &str = "tauthy";
const SNAPSHOT_FILE_NAME: &str = "vault.stronghold";
const STORE_NAME: &str = "vault";
const VAULT_NAME: &str = "vault";
const RECORD_NAME: &str = "record";
const INVALID_LOCKED_KEY: [u8; 32] = [0; 32];

static VAULT_OPERATION_LOCK: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));

fn password_to_key(password: &str) -> Vec<u8> {
  let mut derived_key = [0; 64];
  crypto::keys::pbkdf::PBKDF2_HMAC_SHA512(password.as_bytes(), b"tauri", 100, &mut derived_key)
    .expect("PBKDF2 rounds are non-zero");

  let mut key: [u8; 32] = derived_key[0..32]
    .try_into()
    .expect("the derived key has at least 32 bytes");
  derived_key.zeroize();
  let key_bytes = key.to_vec();
  key.zeroize();
  key_bytes
}

fn api(snapshot_path: PathBuf) -> Api {
  Api::new(snapshot_path)
}

fn record_location() -> Location {
  Location::generic(VAULT_NAME, RECORD_NAME)
}

fn snapshot_path(app: &AppHandle) -> Result<PathBuf, String> {
  app
    .path()
    .data_dir()
    .map(|path| path.join(APP_DATA_DIRECTORY).join(SNAPSHOT_FILE_NAME))
    .map_err(|error| error.to_string())
}

async fn vault_load_at(snapshot_path: PathBuf, mut password: String) -> Result<(), String> {
  let key = password_to_key(&password);
  password.zeroize();
  let api = api(snapshot_path);

  // A failed read with a locked/incorrect key can leave the legacy engine's
  // actor selected. Clear that state before installing a newly supplied key;
  // otherwise Api::load may persist the selected actor with the old key.
  api.unload(false).await.map_err(|error| error.to_string())?;
  api.load(key).await.map_err(|error| error.to_string())?;
  stronghold::set_password_clear_interval(Duration::ZERO).await;
  Ok(())
}

async fn vault_get_at(snapshot_path: PathBuf) -> Result<String, String> {
  api(snapshot_path)
    .get_store(STORE_NAME, vec![])
    .get_record(record_location())
    .await
    .map_err(|error| error.to_string())
}

async fn vault_save_at(snapshot_path: PathBuf, record: String) -> Result<(), String> {
  let api = api(snapshot_path);
  api
    .get_store(STORE_NAME, vec![])
    .save_record(record_location(), record, None)
    .await
    .map_err(|error| error.to_string())?;
  api.save().await.map_err(|error| error.to_string())
}

async fn vault_unload_at(snapshot_path: PathBuf) -> Result<(), String> {
  let api = api(snapshot_path);
  api.unload(false).await.map_err(|error| error.to_string())?;

  // The legacy engine normally retains the derived key until its background
  // sweeper runs. Replace it before returning so a completed lock operation
  // cannot reopen the snapshot without another password.
  api.set_password(INVALID_LOCKED_KEY.to_vec()).await;
  stronghold::set_password_clear_interval(Duration::from_secs(1)).await;
  Ok(())
}

async fn vault_status_at(snapshot_path: PathBuf) -> Result<serde_json::Value, String> {
  serde_json::to_value(api(snapshot_path).get_status().await).map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn vault_load(app: AppHandle, password: String) -> Result<(), String> {
  let _operation = VAULT_OPERATION_LOCK.lock().await;
  vault_load_at(snapshot_path(&app)?, password).await
}

#[tauri::command]
pub async fn vault_get(app: AppHandle) -> Result<String, String> {
  let _operation = VAULT_OPERATION_LOCK.lock().await;
  vault_get_at(snapshot_path(&app)?).await
}

#[tauri::command]
pub async fn vault_save(app: AppHandle, record: String) -> Result<(), String> {
  let _operation = VAULT_OPERATION_LOCK.lock().await;
  vault_save_at(snapshot_path(&app)?, record).await
}

#[tauri::command]
pub async fn vault_unload(app: AppHandle) -> Result<(), String> {
  let _operation = VAULT_OPERATION_LOCK.lock().await;
  vault_unload_at(snapshot_path(&app)?).await
}

#[tauri::command]
pub async fn vault_status(app: AppHandle) -> Result<serde_json::Value, String> {
  let _operation = VAULT_OPERATION_LOCK.lock().await;
  vault_status_at(snapshot_path(&app)?).await
}

#[cfg(test)]
mod tests {
  use super::*;
  use rusty_fork::rusty_fork_test;

  #[test]
  fn password_derivation_matches_the_legacy_plugin() {
    assert_eq!(
      password_to_key("tauthy"),
      vec![
        118, 117, 137, 95, 172, 65, 211, 163, 23, 173, 23, 96, 45, 27, 4, 187, 62, 194, 222, 20,
        169, 206, 190, 244, 11, 44, 95, 167, 224, 71, 2, 208,
      ]
    );
  }

  rusty_fork_test! {
    #[test]
    fn commands_read_and_write_the_existing_snapshot_format() {
      async_std::task::block_on(async {
        let snapshot_path = std::env::temp_dir().join(format!(
          "tauthy-legacy-{}.stronghold",
          rand::random::<u64>()
        ));
        let record = r#"[{"id":"compatibility-test"}]"#.to_string();

        vault_load_at(snapshot_path.clone(), "correct horse".into())
          .await
          .unwrap();
        vault_save_at(snapshot_path.clone(), record.clone()).await.unwrap();
        vault_unload_at(snapshot_path.clone()).await.unwrap();
        assert!(vault_get_at(snapshot_path.clone()).await.is_err());

        vault_load_at(snapshot_path.clone(), "wrong password".into())
          .await
          .unwrap();
        assert!(vault_get_at(snapshot_path.clone()).await.is_err());
        vault_unload_at(snapshot_path.clone()).await.unwrap();

        vault_load_at(snapshot_path.clone(), "correct horse".into())
          .await
          .unwrap();
        assert_eq!(vault_get_at(snapshot_path.clone()).await.unwrap(), record);
        vault_unload_at(snapshot_path.clone()).await.unwrap();

        std::fs::remove_file(snapshot_path).unwrap();
      });
    }
  }
}
