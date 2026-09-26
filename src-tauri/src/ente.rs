use argon2::{Algorithm, Argon2, Params, Version};
use data_encoding::BASE64;
use dryoc::{
  classic::crypto_secretstream_xchacha20poly1305::{
    crypto_secretstream_xchacha20poly1305_init_pull, crypto_secretstream_xchacha20poly1305_pull,
    Header, State,
  },
  constants::{
    CRYPTO_SECRETSTREAM_XCHACHA20POLY1305_ABYTES, CRYPTO_SECRETSTREAM_XCHACHA20POLY1305_TAG_FINAL,
    CRYPTO_SECRETSTREAM_XCHACHA20POLY1305_TAG_MESSAGE,
  },
};
use serde::Deserialize;
use zeroize::{Zeroize, Zeroizing};

const KEY_SIZE: usize = 32;
const SALT_SIZE: usize = 16;
const MAX_ENVELOPE_SIZE: usize = 4 * 1024 * 1024;
const MAX_CIPHERTEXT_SIZE: usize = 3 * 1024 * 1024;
const MAX_MEMORY_KIB: u32 = 1024 * 1024;
const MAX_OPS_LIMIT: u32 = 16;
const MAX_WORK_KIB: u64 = 4 * 1024 * 1024;

const ERR_UNSUPPORTED: &str = "importEncryptedUnsupported";
const ERR_AUTHENTICATION: &str = "importEncryptedAuthenticationFailed";
const ERR_CORRUPT: &str = "importEncryptedCorrupt";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EnteExport {
  version: u8,
  kdf_params: KdfParams,
  encrypted_data: String,
  encryption_nonce: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct KdfParams {
  mem_limit: u64,
  ops_limit: u32,
  salt: String,
}

fn decode_bounded(value: &str, max_len: usize) -> Result<Vec<u8>, String> {
  if value.len() > ((max_len + 2) / 3) * 4 + 4 {
    return Err(ERR_UNSUPPORTED.into());
  }
  let decoded = BASE64
    .decode(value.as_bytes())
    .map_err(|_| ERR_UNSUPPORTED.to_string())?;
  if decoded.len() > max_len {
    return Err(ERR_UNSUPPORTED.into());
  }
  Ok(decoded)
}

fn decrypt_export(export: &str, password: &[u8]) -> Result<String, String> {
  if export.len() > MAX_ENVELOPE_SIZE {
    return Err(ERR_UNSUPPORTED.into());
  }
  let export: EnteExport = serde_json::from_str(export).map_err(|_| ERR_UNSUPPORTED.to_string())?;
  if export.version != 1 {
    return Err(ERR_UNSUPPORTED.into());
  }

  // Ente stores libsodium's Argon2id memory cost in bytes. Argon2's Rust API
  // takes KiB, matching Ente's CLI conversion (memLimit / 1024).
  let memory_kib =
    u32::try_from(export.kdf_params.mem_limit / 1024).map_err(|_| ERR_UNSUPPORTED.to_string())?;
  if !(8..=MAX_MEMORY_KIB).contains(&memory_kib)
    || !(1..=MAX_OPS_LIMIT).contains(&export.kdf_params.ops_limit)
    || u64::from(memory_kib) * u64::from(export.kdf_params.ops_limit) > MAX_WORK_KIB
  {
    return Err(ERR_UNSUPPORTED.into());
  }

  let salt = decode_bounded(&export.kdf_params.salt, SALT_SIZE)?;
  let header = decode_bounded(&export.encryption_nonce, std::mem::size_of::<Header>())?;
  let ciphertext = decode_bounded(&export.encrypted_data, MAX_CIPHERTEXT_SIZE)?;
  if salt.len() != SALT_SIZE
    || header.len() != std::mem::size_of::<Header>()
    || ciphertext.len() < CRYPTO_SECRETSTREAM_XCHACHA20POLY1305_ABYTES
  {
    return Err(ERR_UNSUPPORTED.into());
  }

  let params = Params::new(memory_kib, export.kdf_params.ops_limit, 1, Some(KEY_SIZE))
    .map_err(|_| ERR_UNSUPPORTED.to_string())?;
  let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
  let mut key = Zeroizing::new([0_u8; KEY_SIZE]);
  argon2
    .hash_password_into(password, &salt, key.as_mut())
    .map_err(|_| ERR_UNSUPPORTED.to_string())?;

  // Ente's "encryptData" is libsodium secretstream, not a one-shot
  // XChaCha20-Poly1305 AEAD. Both mobile exports and its CLI use one frame.
  let mut state = State::new();
  let header: Header = header.try_into().map_err(|_| ERR_UNSUPPORTED.to_string())?;
  crypto_secretstream_xchacha20poly1305_init_pull(&mut state, &header, &key);
  let mut plaintext = Zeroizing::new(vec![
    0_u8;
    ciphertext.len()
      - CRYPTO_SECRETSTREAM_XCHACHA20POLY1305_ABYTES
  ]);
  let mut tag = 0_u8;
  let length = crypto_secretstream_xchacha20poly1305_pull(
    &mut state,
    plaintext.as_mut_slice(),
    &mut tag,
    &ciphertext,
    None,
  )
  .map_err(|_| ERR_AUTHENTICATION.to_string())?;
  if tag != CRYPTO_SECRETSTREAM_XCHACHA20POLY1305_TAG_MESSAGE
    && tag != CRYPTO_SECRETSTREAM_XCHACHA20POLY1305_TAG_FINAL
  {
    return Err(ERR_UNSUPPORTED.into());
  }
  plaintext.truncate(length);
  let text = std::str::from_utf8(plaintext.as_slice())
    .map_err(|_| ERR_CORRUPT.to_string())?
    .to_owned();
  plaintext.zeroize();
  Ok(text)
}

#[tauri::command]
pub async fn decrypt_ente_export(export: String, password: String) -> Result<String, String> {
  tauri::async_runtime::spawn_blocking(move || {
    let mut password = password;
    let result = decrypt_export(&export, password.as_bytes());
    password.zeroize();
    result
  })
  .await
  .map_err(|_| ERR_CORRUPT.to_string())?
}

#[cfg(test)]
mod tests {
  use super::*;

  const FIXTURE: &str = include_str!("../tests/fixtures/ente_encrypted_minimal.json");

  #[test]
  fn decrypts_libsodium_secretstream_export() {
    let text = decrypt_export(FIXTURE, b"test").unwrap();
    assert_eq!(text.lines().count(), 2);
    assert!(text.starts_with("otpauth://totp/Example:alice?"));
  }

  #[test]
  fn rejects_wrong_password_and_ciphertext_changes() {
    assert_eq!(
      decrypt_export(FIXTURE, b"wrong"),
      Err(ERR_AUTHENTICATION.into())
    );
    let tampered = FIXTURE.replacen("Yu/bdL", "Zu/bdL", 1);
    assert_eq!(
      decrypt_export(&tampered, b"test"),
      Err(ERR_AUTHENTICATION.into())
    );
  }

  #[test]
  fn rejects_new_versions_and_excessive_kdf_cost() {
    let newer = FIXTURE.replacen("\"version\": 1", "\"version\": 2", 1);
    assert_eq!(decrypt_export(&newer, b"test"), Err(ERR_UNSUPPORTED.into()));
    let oversized = FIXTURE.replacen("8388608", "2147483648", 1);
    assert_eq!(
      decrypt_export(&oversized, b"test"),
      Err(ERR_UNSUPPORTED.into())
    );
    let excessive_work = FIXTURE.replacen("8388608", "1073741824", 1).replacen(
      "\"opsLimit\": 3",
      "\"opsLimit\": 16",
      1,
    );
    assert_eq!(
      decrypt_export(&excessive_work, b"test"),
      Err(ERR_UNSUPPORTED.into())
    );
  }
}
