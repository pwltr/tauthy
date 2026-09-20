use argon2::{Algorithm, Argon2, Params, Version};
use chacha20poly1305::{
  aead::{Aead, Payload},
  KeyInit, XChaCha20Poly1305, XNonce,
};
use data_encoding::BASE64;
use ring::rand::{SecureRandom, SystemRandom};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use zeroize::{Zeroize, Zeroizing};

const FORMAT: &str = "tauthy-backup-encrypted";
const VERSION: u8 = 1;
const KDF_ALGORITHM: &str = "argon2id";
const CIPHER_ALGORITHM: &str = "xchacha20-poly1305";
const MEMORY_KIB: u32 = 65_536;
const ITERATIONS: u32 = 3;
const PARALLELISM: u32 = 1;
const KEY_SIZE: usize = 32;
const SALT_SIZE: usize = 16;
const NONCE_SIZE: usize = 24;
const MIN_PASSWORD_LENGTH: usize = 8;
const MAX_ENCRYPTED_SIZE: usize = 64 * 1024 * 1024;
const MAX_MEMORY_KIB: u32 = 256 * 1024;
const MAX_ITERATIONS: u32 = 10;
const MAX_PARALLELISM: u32 = 4;
const AAD: &[u8] = b"tauthy-backup-encrypted:v1";

const ERR_AUTHENTICATION: &str = "importEncryptedAuthenticationFailed";
const ERR_CORRUPT: &str = "importEncryptedCorrupt";
const ERR_UNSUPPORTED: &str = "importEncryptedUnsupported";

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EncryptedBackup {
  format: String,
  version: u8,
  kdf: KdfParameters,
  cipher: CipherParameters,
  ciphertext: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct KdfParameters {
  algorithm: String,
  memory_kib: u32,
  iterations: u32,
  parallelism: u32,
  salt: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CipherParameters {
  algorithm: String,
  nonce: String,
}

fn derive_key(
  password: &[u8],
  salt: &[u8],
  memory_kib: u32,
  iterations: u32,
  parallelism: u32,
) -> Result<Zeroizing<[u8; KEY_SIZE]>, String> {
  if memory_kib == 0
    || memory_kib > MAX_MEMORY_KIB
    || iterations == 0
    || iterations > MAX_ITERATIONS
    || parallelism == 0
    || parallelism > MAX_PARALLELISM
  {
    return Err(ERR_UNSUPPORTED.into());
  }

  let params = Params::new(memory_kib, iterations, parallelism, Some(KEY_SIZE))
    .map_err(|_| ERR_UNSUPPORTED.to_string())?;
  let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
  let mut key = Zeroizing::new([0_u8; KEY_SIZE]);
  argon2
    .hash_password_into(password, salt, key.as_mut())
    .map_err(|_| ERR_UNSUPPORTED.to_string())?;
  Ok(key)
}

fn encrypt_backup(backup: &Value, password: &[u8]) -> Result<Value, String> {
  if password.len() < MIN_PASSWORD_LENGTH {
    return Err("exportFailed".into());
  }

  let plaintext = Zeroizing::new(serde_json::to_vec(backup).map_err(|_| ERR_CORRUPT.to_string())?);
  if plaintext.is_empty() || plaintext.len() > MAX_ENCRYPTED_SIZE {
    return Err(ERR_CORRUPT.into());
  }

  let random = SystemRandom::new();
  let mut salt = [0_u8; SALT_SIZE];
  let mut nonce = [0_u8; NONCE_SIZE];
  random
    .fill(&mut salt)
    .map_err(|_| ERR_CORRUPT.to_string())?;
  random
    .fill(&mut nonce)
    .map_err(|_| ERR_CORRUPT.to_string())?;

  let key = derive_key(password, &salt, MEMORY_KIB, ITERATIONS, PARALLELISM)?;
  let cipher =
    XChaCha20Poly1305::new_from_slice(key.as_ref()).map_err(|_| ERR_CORRUPT.to_string())?;
  let ciphertext = cipher
    .encrypt(
      XNonce::from_slice(&nonce),
      Payload {
        msg: plaintext.as_slice(),
        aad: AAD,
      },
    )
    .map_err(|_| ERR_CORRUPT.to_string())?;

  serde_json::to_value(EncryptedBackup {
    format: FORMAT.into(),
    version: VERSION,
    kdf: KdfParameters {
      algorithm: KDF_ALGORITHM.into(),
      memory_kib: MEMORY_KIB,
      iterations: ITERATIONS,
      parallelism: PARALLELISM,
      salt: BASE64.encode(&salt),
    },
    cipher: CipherParameters {
      algorithm: CIPHER_ALGORITHM.into(),
      nonce: BASE64.encode(&nonce),
    },
    ciphertext: BASE64.encode(&ciphertext),
  })
  .map_err(|_| ERR_CORRUPT.into())
}

fn decode_exact(value: &str, length: usize) -> Result<Vec<u8>, String> {
  let decoded = BASE64
    .decode(value.as_bytes())
    .map_err(|_| ERR_UNSUPPORTED.to_string())?;
  if decoded.len() != length {
    return Err(ERR_UNSUPPORTED.into());
  }
  Ok(decoded)
}

fn decrypt_backup(envelope: &str, password: &[u8]) -> Result<Value, String> {
  if envelope.len() > MAX_ENCRYPTED_SIZE * 2 {
    return Err(ERR_UNSUPPORTED.into());
  }
  let envelope: EncryptedBackup =
    serde_json::from_str(envelope).map_err(|_| ERR_UNSUPPORTED.to_string())?;
  if envelope.format != FORMAT
    || envelope.version != VERSION
    || envelope.kdf.algorithm != KDF_ALGORITHM
    || envelope.cipher.algorithm != CIPHER_ALGORITHM
  {
    return Err(ERR_UNSUPPORTED.into());
  }

  let salt = decode_exact(&envelope.kdf.salt, SALT_SIZE)?;
  let nonce = decode_exact(&envelope.cipher.nonce, NONCE_SIZE)?;
  let ciphertext = BASE64
    .decode(envelope.ciphertext.as_bytes())
    .map_err(|_| ERR_UNSUPPORTED.to_string())?;
  if ciphertext.is_empty() || ciphertext.len() > MAX_ENCRYPTED_SIZE {
    return Err(ERR_UNSUPPORTED.into());
  }

  let key = derive_key(
    password,
    &salt,
    envelope.kdf.memory_kib,
    envelope.kdf.iterations,
    envelope.kdf.parallelism,
  )?;
  let cipher =
    XChaCha20Poly1305::new_from_slice(key.as_ref()).map_err(|_| ERR_UNSUPPORTED.to_string())?;
  let plaintext = cipher
    .decrypt(
      XNonce::from_slice(&nonce),
      Payload {
        msg: &ciphertext,
        aad: AAD,
      },
    )
    .map_err(|_| ERR_AUTHENTICATION.to_string())?;
  let mut plaintext = Zeroizing::new(plaintext);
  let result = serde_json::from_slice(plaintext.as_slice()).map_err(|_| ERR_CORRUPT.to_string());
  plaintext.zeroize();
  result
}

#[tauri::command]
pub async fn encrypt_tauthy_backup(backup: Value, password: String) -> Result<Value, String> {
  tauri::async_runtime::spawn_blocking(move || {
    let mut password = password;
    let result = encrypt_backup(&backup, password.as_bytes());
    password.zeroize();
    result
  })
  .await
  .map_err(|_| ERR_CORRUPT.to_string())?
}

#[tauri::command]
pub async fn decrypt_tauthy_backup(backup: String, password: String) -> Result<Value, String> {
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

  fn backup() -> Value {
    serde_json::json!({
      "format": "tauthy-backup",
      "version": 1,
      "exportedAt": "2026-09-20T12:30:00.000Z",
      "entries": [{ "id": "entry-id", "name": "alice@example.com" }]
    })
  }

  #[test]
  fn encrypted_backup_round_trips() {
    let envelope = encrypt_backup(&backup(), PASSWORD.as_bytes()).unwrap();
    let decrypted = decrypt_backup(&envelope.to_string(), PASSWORD.as_bytes()).unwrap();
    assert_eq!(decrypted, backup());
  }

  #[test]
  fn wrong_password_is_rejected() {
    let envelope = encrypt_backup(&backup(), PASSWORD.as_bytes()).unwrap();
    assert_eq!(
      decrypt_backup(&envelope.to_string(), b"wrong password"),
      Err(ERR_AUTHENTICATION.into())
    );
  }

  #[test]
  fn short_export_password_is_rejected() {
    assert_eq!(
      encrypt_backup(&backup(), b"short"),
      Err("exportFailed".into())
    );
  }

  #[test]
  fn tampering_is_rejected() {
    let mut envelope = encrypt_backup(&backup(), PASSWORD.as_bytes()).unwrap();
    let ciphertext = envelope["ciphertext"].as_str().unwrap();
    let replacement = if ciphertext.starts_with('A') {
      "B"
    } else {
      "A"
    };
    envelope["ciphertext"] = format!("{replacement}{}", &ciphertext[1..]).into();
    assert_eq!(
      decrypt_backup(&envelope.to_string(), PASSWORD.as_bytes()),
      Err(ERR_AUTHENTICATION.into())
    );
  }

  #[test]
  fn excessive_kdf_cost_is_rejected() {
    let mut envelope = encrypt_backup(&backup(), PASSWORD.as_bytes()).unwrap();
    envelope["kdf"]["memoryKib"] = (MAX_MEMORY_KIB + 1).into();
    assert_eq!(
      decrypt_backup(&envelope.to_string(), PASSWORD.as_bytes()),
      Err(ERR_UNSUPPORTED.into())
    );
  }
}
