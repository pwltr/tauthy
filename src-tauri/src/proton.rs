use aes_gcm::{
  aead::{Aead, KeyInit, Payload},
  Aes256Gcm, Nonce,
};
use argon2::{Algorithm, Argon2, Params, Version};
use data_encoding::BASE64;
use serde::Deserialize;
use serde_json::Value;
use zeroize::Zeroizing;

const MAX_EXPORT_SIZE: usize = 16 * 1024 * 1024;
const MAX_CONTENT_SIZE: usize = 12 * 1024 * 1024;
const NONCE_SIZE: usize = 12;
const TAG_SIZE: usize = 16;
const AAD: &[u8] = b"proton.authenticator.export.v1";
const ERR_UNSUPPORTED: &str = "importEncryptedUnsupported";
const ERR_AUTHENTICATION: &str = "importEncryptedAuthenticationFailed";
const ERR_CORRUPT: &str = "importEncryptedCorrupt";

#[derive(Deserialize)]
struct ProtonExport {
  version: u8,
  salt: String,
  content: String,
}

fn decode_bounded(value: &str, max_len: usize) -> Result<Vec<u8>, String> {
  if value.len() > max_len.div_ceil(3) * 4 {
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

fn decrypt_export(export: &str, password: &[u8]) -> Result<Value, String> {
  if export.len() > MAX_EXPORT_SIZE {
    return Err(ERR_UNSUPPORTED.into());
  }
  let export: ProtonExport =
    serde_json::from_str(export).map_err(|_| ERR_UNSUPPORTED.to_string())?;
  if export.version != 1 {
    return Err(ERR_UNSUPPORTED.into());
  }
  let salt = decode_bounded(&export.salt, 16)?;
  let content = decode_bounded(&export.content, MAX_CONTENT_SIZE + NONCE_SIZE + TAG_SIZE)?;
  if salt.len() != 16 || content.len() < NONCE_SIZE + TAG_SIZE {
    return Err(ERR_UNSUPPORTED.into());
  }

  // Proton v1 fixes Argon2id v1.3 to 19 MiB, two iterations and one lane.
  // Its content is nonce || AES-GCM ciphertext || tag, authenticated with this AAD.
  let params = Params::new(19 * 1024, 2, 1, Some(32)).map_err(|_| ERR_UNSUPPORTED.to_string())?;
  let mut key = Zeroizing::new([0_u8; 32]);
  Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
    .hash_password_into(password, &salt, key.as_mut())
    .map_err(|_| ERR_UNSUPPORTED.to_string())?;
  let cipher = Aes256Gcm::new_from_slice(key.as_ref()).map_err(|_| ERR_UNSUPPORTED.to_string())?;
  let plaintext = Zeroizing::new(
    cipher
      .decrypt(
        Nonce::from_slice(&content[..NONCE_SIZE]),
        Payload {
          msg: &content[NONCE_SIZE..],
          aad: AAD,
        },
      )
      .map_err(|_| ERR_AUTHENTICATION.to_string())?,
  );
  // JSON strings (and frontend/IPC copies) are not covered by buffer zeroization.
  serde_json::from_slice(plaintext.as_slice()).map_err(|_| ERR_CORRUPT.to_string())
}

#[tauri::command]
pub async fn decrypt_proton_export(export: String, password: String) -> Result<Value, String> {
  let password = Zeroizing::new(password);
  tauri::async_runtime::spawn_blocking(move || decrypt_export(&export, password.as_bytes()))
    .await
    .map_err(|_| ERR_CORRUPT.to_string())?
}

#[cfg(test)]
mod tests {
  use super::*;

  // Independently produced Proton export from Aegis' importer test suite (password: test).
  const FIXTURE: &str = include_str!("../tests/fixtures/proton_encrypted_upstream.json");

  #[test]
  fn round_trips_supported_entries() {
    let plaintext = serde_json::json!({ "version": 1, "entries": [{
      "id": "a19e0019-47e3-4d3b-af63-6dad0cb49e31",
      "content": { "entry_type": "Totp", "name": "Dropbox", "uri": "otpauth://totp/Dropbox:Demo?secret=JBSWY3DPEHPK3PXP&issuer=Dropbox&algorithm=SHA1&digits=6&period=30" },
      "note": null
    }] });
    let salt = [0x42_u8; 16];
    let nonce = [0x24_u8; NONCE_SIZE];
    let mut key = Zeroizing::new([0_u8; 32]);
    Argon2::new(
      Algorithm::Argon2id,
      Version::V0x13,
      Params::new(19 * 1024, 2, 1, Some(32)).unwrap(),
    )
    .hash_password_into(b"test", &salt, key.as_mut())
    .unwrap();
    let cipher = Aes256Gcm::new_from_slice(key.as_ref()).unwrap();
    let serialized = plaintext.to_string();
    let ciphertext = cipher
      .encrypt(
        Nonce::from_slice(&nonce),
        Payload {
          msg: serialized.as_bytes(),
          aad: AAD,
        },
      )
      .unwrap();
    let content = [nonce.as_slice(), ciphertext.as_slice()].concat();
    let export = serde_json::json!({ "version": 1, "salt": BASE64.encode(&salt), "content": BASE64.encode(&content) });
    assert_eq!(
      decrypt_export(&export.to_string(), b"test").unwrap(),
      plaintext
    );
    let fixture = include_str!("../tests/fixtures/proton_encrypted_minimal.json");
    assert_eq!(decrypt_export(fixture, b"test").unwrap(), plaintext);
  }

  #[test]
  fn decrypts_upstream_export() {
    let result = decrypt_export(FIXTURE, b"test").unwrap();
    assert_eq!(result["version"], 1);
    assert!(!result["entries"].as_array().unwrap().is_empty());
    assert!(result["entries"][0]["content"]["uri"]
      .as_str()
      .unwrap()
      .contains("secret="));
  }

  #[test]
  fn rejects_wrong_password_and_tampering() {
    assert_eq!(
      decrypt_export(FIXTURE, b"wrong"),
      Err(ERR_AUTHENTICATION.into())
    );
    let mut export: Value = serde_json::from_str(FIXTURE).unwrap();
    let mut content = BASE64
      .decode(export["content"].as_str().unwrap().as_bytes())
      .unwrap();
    content[NONCE_SIZE] ^= 1;
    export["content"] = Value::String(BASE64.encode(&content));
    assert_eq!(
      decrypt_export(&export.to_string(), b"test"),
      Err(ERR_AUTHENTICATION.into())
    );
  }

  #[test]
  fn rejects_invalid_envelopes() {
    for replacement in [
      serde_json::json!({"version": 2}),
      serde_json::json!({"salt": "AA=="}),
      serde_json::json!({"content": "invalid"}),
      serde_json::json!({"content": "AA=="}),
    ] {
      let mut export: Value = serde_json::from_str(FIXTURE).unwrap();
      for (key, value) in replacement.as_object().unwrap() {
        export[key] = value.clone();
      }
      assert_eq!(
        decrypt_export(&export.to_string(), b"test"),
        Err(ERR_UNSUPPORTED.into())
      );
    }
    assert_eq!(
      decode_bounded(&"A".repeat(25), 16),
      Err(ERR_UNSUPPORTED.into())
    );
    assert_eq!(
      decrypt_export(&" ".repeat(MAX_EXPORT_SIZE + 1), b"test"),
      Err(ERR_UNSUPPORTED.into())
    );
  }
}
