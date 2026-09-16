//! Compatibility commands for snapshots created by the original Tauri v1
//! Stronghold plugin. Keep this module until existing installations have had
//! a chance to migrate to a current Stronghold snapshot format.

use std::{convert::TryInto, path::PathBuf, time::Duration};

#[allow(dead_code, unused_mut)]
#[rustfmt::skip]
#[path = "../../tauri-plugin-stronghold/src/stronghold.rs"]
mod stronghold;

use iota_stronghold::Location;
use stronghold::Api;

const STORE_NAME: &str = "vault";
const VAULT_NAME: &str = "vault";
const RECORD_NAME: &str = "record";

fn password_to_key(password: &str) -> Vec<u8> {
  let mut derived_key = [0; 64];
  crypto::keys::pbkdf::PBKDF2_HMAC_SHA512(password.as_bytes(), b"tauri", 100, &mut derived_key)
    .expect("PBKDF2 rounds are non-zero");

  let key: [u8; 32] = derived_key[0..32]
    .try_into()
    .expect("the derived key has at least 32 bytes");
  key.to_vec()
}

fn api(snapshot_path: PathBuf) -> Api {
  Api::new(snapshot_path)
}

fn record_location() -> Location {
  Location::generic(VAULT_NAME, RECORD_NAME)
}

#[tauri::command]
pub async fn vault_load(snapshot_path: PathBuf, password: String) -> Result<(), String> {
  api(snapshot_path)
    .load(password_to_key(&password))
    .await
    .map_err(|error| error.to_string())?;
  stronghold::set_password_clear_interval(Duration::ZERO).await;
  Ok(())
}

#[tauri::command]
pub async fn vault_get(snapshot_path: PathBuf) -> Result<String, String> {
  api(snapshot_path)
    .get_store(STORE_NAME, vec![])
    .get_record(record_location())
    .await
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn vault_save(snapshot_path: PathBuf, record: String) -> Result<(), String> {
  let api = api(snapshot_path);
  api
    .get_store(STORE_NAME, vec![])
    .save_record(record_location(), record, None)
    .await
    .map_err(|error| error.to_string())?;
  api.save().await.map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn vault_unload(snapshot_path: PathBuf) -> Result<(), String> {
  stronghold::set_password_clear_interval(Duration::from_secs(1)).await;
  api(snapshot_path)
    .unload(false)
    .await
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn vault_status(snapshot_path: PathBuf) -> Result<serde_json::Value, String> {
  serde_json::to_value(api(snapshot_path).get_status().await).map_err(|error| error.to_string())
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

        vault_load(snapshot_path.clone(), "correct horse".into())
          .await
          .unwrap();
        vault_save(snapshot_path.clone(), record.clone()).await.unwrap();
        vault_unload(snapshot_path.clone()).await.unwrap();

        vault_load(snapshot_path.clone(), "wrong password".into())
          .await
          .unwrap();
        assert!(vault_get(snapshot_path.clone()).await.is_err());
        vault_unload(snapshot_path.clone()).await.unwrap();

        vault_load(snapshot_path.clone(), "correct horse".into())
          .await
          .unwrap();
        assert_eq!(vault_get(snapshot_path.clone()).await.unwrap(), record);
        vault_unload(snapshot_path.clone()).await.unwrap();

        std::fs::remove_file(snapshot_path).unwrap();
      });
    }
  }
}
