use aes_gcm::{
  aead::{Aead, KeyInit},
  Aes256Gcm, Nonce,
};
use data_encoding::BASE64;
use ring::pbkdf2;
use serde_json::Value;
use std::num::NonZeroU32;
use zeroize::{Zeroize, Zeroizing};

const KEY_SIZE: usize = 32;
const NONCE_SIZE: usize = 12;
const TAG_SIZE: usize = 16;
const MAX_SERVICES_SIZE: usize = 64 * 1024 * 1024;
const MAX_BACKUP_SIZE: usize = 90 * 1024 * 1024;
const PBKDF2_ROUNDS: NonZeroU32 = NonZeroU32::new(10_000).unwrap();

const ERR_UNSUPPORTED: &str = "importEncryptedUnsupported";
const ERR_AUTHENTICATION: &str = "importEncryptedAuthenticationFailed";
const ERR_CORRUPT: &str = "importEncryptedCorrupt";

fn decode_bounded(value: &str, max_len: usize) -> Result<Vec<u8>, String> {
  if value.len() > ((max_len + 2) / 3) * 4 + 4 {
    return Err(ERR_UNSUPPORTED.to_string());
  }
  let decoded = BASE64
    .decode(value.as_bytes())
    .map_err(|_| ERR_UNSUPPORTED.to_string())?;
  if decoded.len() > max_len {
    return Err(ERR_UNSUPPORTED.to_string());
  }
  Ok(decoded)
}

fn decrypt_services(encrypted: &str, password: &[u8]) -> Result<Value, String> {
  let mut parts = encrypted.split(':');
  let ciphertext = parts.next().ok_or_else(|| ERR_UNSUPPORTED.to_string())?;
  let salt = parts.next().ok_or_else(|| ERR_UNSUPPORTED.to_string())?;
  let nonce = parts.next().ok_or_else(|| ERR_UNSUPPORTED.to_string())?;
  if parts.next().is_some() {
    return Err(ERR_UNSUPPORTED.to_string());
  }

  let ciphertext = decode_bounded(ciphertext, MAX_SERVICES_SIZE + TAG_SIZE)?;
  let salt = decode_bounded(salt, 256)?;
  let nonce = decode_bounded(nonce, NONCE_SIZE)?;
  if ciphertext.len() < TAG_SIZE || !(16..=256).contains(&salt.len()) || nonce.len() != NONCE_SIZE {
    return Err(ERR_UNSUPPORTED.to_string());
  }

  // 2FAS Android and iOS both use PBKDF2-HMAC-SHA256 (10,000 rounds)
  // followed by AES-256-GCM, with the tag appended to the ciphertext.
  let mut key = Zeroizing::new([0_u8; KEY_SIZE]);
  pbkdf2::derive(
    pbkdf2::PBKDF2_HMAC_SHA256,
    PBKDF2_ROUNDS,
    &salt,
    password,
    key.as_mut(),
  );
  let cipher = Aes256Gcm::new_from_slice(key.as_ref()).map_err(|_| ERR_UNSUPPORTED.to_string())?;
  let plaintext = cipher
    .decrypt(Nonce::from_slice(&nonce), ciphertext.as_ref())
    .map_err(|_| ERR_AUTHENTICATION.to_string())?;
  let mut plaintext = Zeroizing::new(plaintext);
  let services: Value =
    serde_json::from_slice(plaintext.as_slice()).map_err(|_| ERR_CORRUPT.to_string())?;
  plaintext.zeroize();
  if !services.is_array() {
    return Err(ERR_CORRUPT.to_string());
  }
  Ok(services)
}

fn decrypt_backup(backup: &str, password: &[u8]) -> Result<Value, String> {
  if backup.len() > MAX_BACKUP_SIZE {
    return Err(ERR_UNSUPPORTED.to_string());
  }
  let mut backup: Value = serde_json::from_str(backup).map_err(|_| ERR_UNSUPPORTED.to_string())?;
  let encrypted = backup
    .get("servicesEncrypted")
    .and_then(Value::as_str)
    .ok_or_else(|| ERR_UNSUPPORTED.to_string())?;
  let services = decrypt_services(encrypted, password)?;
  backup["services"] = services;
  backup["servicesEncrypted"] = Value::Null;
  Ok(backup)
}

#[tauri::command]
pub async fn decrypt_twofas_backup(backup: String, password: String) -> Result<Value, String> {
  tauri::async_runtime::spawn_blocking(move || {
    let mut password = password;
    let result = decrypt_backup(&backup, password.as_bytes());
    password.zeroize();
    result
  })
  .await
  .map_err(|_| ERR_CORRUPT.to_string())?
}

#[cfg(test)]
mod tests {
  use super::*;

  const PASSWORD: &str = "correct horse battery staple";
  const FIXTURE: &str = include_str!("../tests/fixtures/2fas_encrypted_minimal.json");
  const ANDROID_FIXTURE: &str = include_str!("../tests/fixtures/2fas_encrypted_android.json");

  #[test]
  fn decrypts_password_protected_backup() {
    let backup = decrypt_backup(FIXTURE, PASSWORD.as_bytes()).unwrap();
    assert_eq!(backup["services"][0]["name"], "Dropbox");
    assert_eq!(backup["services"][0]["secret"], "JBSWY3DPEHPK3PXP");
    assert_eq!(backup["groups"][0]["name"], "Work");
  }

  #[test]
  fn decrypts_android_backup_with_256_byte_salt() {
    let backup = decrypt_backup(ANDROID_FIXTURE, PASSWORD.as_bytes()).unwrap();
    assert_eq!(backup["services"][0]["name"], "GitHub");
    assert_eq!(backup["services"][0]["secret"], "JBSWY3DPEHPK3PXP");
  }

  #[test]
  fn rejects_wrong_password() {
    assert_eq!(
      decrypt_backup(FIXTURE, b"wrong password"),
      Err(ERR_AUTHENTICATION.to_string())
    );
  }

  #[test]
  fn rejects_modified_ciphertext() {
    let changed = FIXTURE.replacen("jgHyD", "kgHyD", 1);
    assert_eq!(
      decrypt_backup(&changed, PASSWORD.as_bytes()),
      Err(ERR_AUTHENTICATION.to_string())
    );
  }

  #[test]
  fn rejects_malformed_envelope() {
    let changed = FIXTURE.replace("ICEiIyQlJicoKSor", "invalid");
    assert_eq!(
      decrypt_backup(&changed, PASSWORD.as_bytes()),
      Err(ERR_UNSUPPORTED.to_string())
    );
  }
}
