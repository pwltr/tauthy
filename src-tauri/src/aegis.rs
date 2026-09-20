use aes_gcm::{
  aead::{Aead, KeyInit},
  Aes256Gcm, Nonce,
};
use data_encoding::{BASE64, HEXLOWER};
use scrypt::{scrypt, Params};
use serde::Deserialize;
use serde_json::Value;
use zeroize::{Zeroize, Zeroizing};

const AEGIS_FILE_VERSION: u64 = 1;
const MAX_AEGIS_DATABASE_VERSION: u64 = 3;
const PASSWORD_SLOT_TYPE: u8 = 1;
const KEY_SIZE: usize = 32;
const NONCE_SIZE: usize = 12;
const TAG_SIZE: usize = 16;
const MAX_PASSWORD_SLOTS: usize = 16;
const MAX_SALT_SIZE: usize = 64;
const MIN_SALT_SIZE: usize = 16;
const MAX_SCRYPT_MEMORY: u64 = 128 * 1024 * 1024;
const MAX_SCRYPT_WORK: u64 = 1 << 23;
const MAX_ENCRYPTED_DATABASE_SIZE: usize = 64 * 1024 * 1024;

const ERR_CORRUPT: &str = "importEncryptedCorrupt";
const ERR_NO_PASSWORD_SLOT: &str = "importEncryptedNoPasswordKey";
const ERR_UNSUPPORTED: &str = "importEncryptedUnsupported";
const ERR_WRONG_PASSWORD: &str = "importEncryptedWrongPassword";

enum DecryptError {
  Authentication,
  InvalidParameters,
}

#[derive(Deserialize)]
struct AegisVault {
  version: u64,
  header: AegisHeader,
  db: String,
}

#[derive(Deserialize)]
struct AegisHeader {
  slots: Vec<AegisSlot>,
  params: AegisCipherParams,
}

#[derive(Deserialize)]
struct AegisSlot {
  #[serde(rename = "type")]
  slot_type: u8,
  key: String,
  key_params: AegisCipherParams,
  n: Option<u64>,
  r: Option<u32>,
  p: Option<u32>,
  salt: Option<String>,
}

#[derive(Deserialize)]
struct AegisCipherParams {
  nonce: String,
  tag: String,
}

fn decode_hex(value: &str, expected_len: Option<usize>) -> Result<Vec<u8>, String> {
  let normalized = value.to_ascii_lowercase();
  let decoded = HEXLOWER
    .decode(normalized.as_bytes())
    .map_err(|_| ERR_UNSUPPORTED.to_string())?;

  if expected_len.is_some_and(|expected| decoded.len() != expected) {
    return Err(ERR_UNSUPPORTED.to_string());
  }

  Ok(decoded)
}

fn scrypt_params(n: u64, r: u32, p: u32) -> Result<Params, String> {
  if !n.is_power_of_two() || n < 2 || r == 0 || p == 0 {
    return Err(ERR_UNSUPPORTED.to_string());
  }

  let memory = 128_u64
    .checked_mul(n)
    .and_then(|value| value.checked_mul(u64::from(r)))
    .ok_or_else(|| ERR_UNSUPPORTED.to_string())?;
  let work = n
    .checked_mul(u64::from(r))
    .and_then(|value| value.checked_mul(u64::from(p)))
    .ok_or_else(|| ERR_UNSUPPORTED.to_string())?;

  if memory > MAX_SCRYPT_MEMORY || work > MAX_SCRYPT_WORK {
    return Err(ERR_UNSUPPORTED.to_string());
  }

  let log_n = u8::try_from(n.ilog2()).map_err(|_| ERR_UNSUPPORTED.to_string())?;
  Params::new(log_n, r, p, KEY_SIZE).map_err(|_| ERR_UNSUPPORTED.to_string())
}

fn decrypt_aes_gcm(
  key: &[u8],
  ciphertext: &[u8],
  params: &AegisCipherParams,
) -> Result<Vec<u8>, DecryptError> {
  let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| DecryptError::InvalidParameters)?;
  let nonce =
    decode_hex(&params.nonce, Some(NONCE_SIZE)).map_err(|_| DecryptError::InvalidParameters)?;
  let tag = decode_hex(&params.tag, Some(TAG_SIZE)).map_err(|_| DecryptError::InvalidParameters)?;
  let mut sealed = Vec::with_capacity(ciphertext.len() + TAG_SIZE);
  sealed.extend_from_slice(ciphertext);
  sealed.extend_from_slice(&tag);
  cipher
    .decrypt(Nonce::from_slice(&nonce), sealed.as_ref())
    .map_err(|_| DecryptError::Authentication)
}

fn decrypt_password_slot(slot: &AegisSlot, password: &[u8]) -> Result<Option<Vec<u8>>, String> {
  let n = slot.n.ok_or_else(|| ERR_UNSUPPORTED.to_string())?;
  let r = slot.r.ok_or_else(|| ERR_UNSUPPORTED.to_string())?;
  let p = slot.p.ok_or_else(|| ERR_UNSUPPORTED.to_string())?;
  let salt = decode_hex(
    slot
      .salt
      .as_deref()
      .ok_or_else(|| ERR_UNSUPPORTED.to_string())?,
    None,
  )?;
  if !(MIN_SALT_SIZE..=MAX_SALT_SIZE).contains(&salt.len()) {
    return Err(ERR_UNSUPPORTED.to_string());
  }

  let params = scrypt_params(n, r, p)?;
  let mut wrapping_key = Zeroizing::new([0_u8; KEY_SIZE]);
  scrypt(password, &salt, &params, wrapping_key.as_mut())
    .map_err(|_| ERR_UNSUPPORTED.to_string())?;

  let encrypted_key = decode_hex(&slot.key, Some(KEY_SIZE))?;
  match decrypt_aes_gcm(wrapping_key.as_ref(), &encrypted_key, &slot.key_params) {
    Ok(master_key) if master_key.len() == KEY_SIZE => Ok(Some(master_key)),
    Ok(mut master_key) => {
      master_key.zeroize();
      Err(ERR_CORRUPT.to_string())
    }
    Err(DecryptError::Authentication) => Ok(None),
    Err(DecryptError::InvalidParameters) => Err(ERR_UNSUPPORTED.to_string()),
  }
}

fn decrypt_vault(vault: &str, password: &[u8]) -> Result<Value, String> {
  let vault: AegisVault = serde_json::from_str(vault).map_err(|_| ERR_UNSUPPORTED.to_string())?;
  if vault.version != AEGIS_FILE_VERSION || vault.header.slots.len() > MAX_PASSWORD_SLOTS {
    return Err(ERR_UNSUPPORTED.to_string());
  }

  let password_slots = vault
    .header
    .slots
    .iter()
    .filter(|slot| slot.slot_type == PASSWORD_SLOT_TYPE)
    .collect::<Vec<_>>();
  if password_slots.is_empty() {
    return Err(ERR_NO_PASSWORD_SLOT.to_string());
  }

  let mut master_key = None;
  let mut supported_password_slots = 0;
  for slot in password_slots {
    match decrypt_password_slot(slot, password) {
      Ok(Some(key)) => {
        supported_password_slots += 1;
        master_key = Some(Zeroizing::new(key));
        break;
      }
      Ok(None) => supported_password_slots += 1,
      Err(error) if error == ERR_UNSUPPORTED => continue,
      Err(error) => return Err(error),
    }
  }
  let master_key = match master_key {
    Some(key) => key,
    None if supported_password_slots == 0 => return Err(ERR_UNSUPPORTED.to_string()),
    None => return Err(ERR_WRONG_PASSWORD.to_string()),
  };

  let encrypted_db = BASE64
    .decode(vault.db.as_bytes())
    .map_err(|_| ERR_UNSUPPORTED.to_string())?;
  if encrypted_db.is_empty() || encrypted_db.len() > MAX_ENCRYPTED_DATABASE_SIZE {
    return Err(ERR_UNSUPPORTED.to_string());
  }

  let plaintext = match decrypt_aes_gcm(master_key.as_ref(), &encrypted_db, &vault.header.params) {
    Ok(plaintext) => plaintext,
    Err(DecryptError::Authentication) => return Err(ERR_CORRUPT.to_string()),
    Err(DecryptError::InvalidParameters) => return Err(ERR_UNSUPPORTED.to_string()),
  };
  let mut plaintext = Zeroizing::new(plaintext);
  let database: Result<Value, String> = serde_json::from_slice(plaintext.as_slice())
    .map_err(|_| ERR_CORRUPT.to_string())
    .and_then(|database: Value| {
      let version = database
        .get("version")
        .and_then(Value::as_u64)
        .ok_or_else(|| ERR_UNSUPPORTED.to_string())?;
      if !(1..=MAX_AEGIS_DATABASE_VERSION).contains(&version) {
        return Err(ERR_UNSUPPORTED.to_string());
      }
      Ok(database)
    });
  plaintext.zeroize();
  database
}

#[tauri::command]
pub async fn decrypt_aegis_vault(vault: String, password: String) -> Result<Value, String> {
  tauri::async_runtime::spawn_blocking(move || {
    let mut password = password;
    let result = decrypt_vault(&vault, password.as_bytes());
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

  fn encrypted_fixture() -> String {
    // Generated independently with Node.js's crypto module using the
    // algorithm documented by Aegis. Keeping the values fixed makes this an
    // interoperability test instead of an encrypt/decrypt round trip.
    include_str!("../tests/fixtures/aegis_encrypted_minimal.json").to_string()
  }

  #[test]
  fn decrypts_aegis_password_vault() {
    let database = decrypt_vault(&encrypted_fixture(), PASSWORD.as_bytes()).unwrap();
    assert_eq!(database["version"], 3);
    assert_eq!(database["entries"][0]["name"], "alice@example.com");
    assert_eq!(database["entries"][0]["info"]["secret"], "JBSWY3DPEHPK3PXP");
  }

  #[test]
  fn rejects_wrong_password() {
    assert_eq!(
      decrypt_vault(&encrypted_fixture(), b"wrong password"),
      Err(ERR_WRONG_PASSWORD.to_string())
    );
  }

  #[test]
  fn rejects_tampered_database() {
    let fixture = encrypted_fixture().replace("\"db\": \"mRg4", "\"db\": \"nRg4");
    assert_eq!(
      decrypt_vault(&fixture, PASSWORD.as_bytes()),
      Err(ERR_CORRUPT.to_string())
    );
  }

  #[test]
  fn rejects_excessive_scrypt_cost_before_deriving() {
    let fixture = encrypted_fixture().replace("\"n\": 32768", "\"n\": 1073741824");
    assert_eq!(
      decrypt_vault(&fixture, PASSWORD.as_bytes()),
      Err(ERR_UNSUPPORTED.to_string())
    );
  }

  #[test]
  fn rejects_vault_without_password_slot() {
    let fixture = encrypted_fixture().replace("\"type\": 1", "\"type\": 2");
    assert_eq!(
      decrypt_vault(&fixture, PASSWORD.as_bytes()),
      Err(ERR_NO_PASSWORD_SLOT.to_string())
    );
  }
}
