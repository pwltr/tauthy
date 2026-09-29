use std::{
  cmp::Ordering,
  collections::{BTreeMap, HashMap, HashSet},
  fs,
  io::Write,
  path::{Path, PathBuf},
  time::{SystemTime, UNIX_EPOCH},
};

use argon2::{Algorithm, Argon2, Params, Version};
use chacha20poly1305::{
  aead::{Aead, Payload},
  KeyInit, XChaCha20Poly1305, XNonce,
};
use data_encoding::BASE64;
use pubky::{AuthFlowKind, Capabilities, ClientId, Pubky, PubkyGrantAuthFlow, PubkySession};
use ring::rand::{SecureRandom, SystemRandom};
use serde::{Deserialize, Serialize};
use tauri::async_runtime::Mutex as AsyncMutex;
use tauri::{AppHandle, State};
use zeroize::{Zeroize, Zeroizing};

use crate::vault_access::{ApplicationVault, RecordAccess, VaultAccess};

pub(crate) const SYNC_STORE_NAME: &[u8] = b"sync-config-v1";
pub(crate) const PUBKY_SYNC_STORE_NAME: &[u8] = b"pubky-sync-config-v1";
const VAULT_STORE_NAME: &[u8] = b"vault";
const ENVELOPE_FORMAT: &str = "tauthy-sync-encrypted";
const PAYLOAD_FORMAT: &str = "tauthy-sync";
const VERSION: u8 = 1;
const KDF_ALGORITHM: &str = "argon2id";
const CIPHER_ALGORITHM: &str = "xchacha20-poly1305";
const MEMORY_KIB: u32 = 65_536;
const ITERATIONS: u32 = 3;
const PARALLELISM: u32 = 1;
const KEY_SIZE: usize = 32;
const SALT_SIZE: usize = 16;
const NONCE_SIZE: usize = 24;
const TAG_SIZE: usize = 16;
const MIN_PASSWORD_LENGTH: usize = 8;
const MAX_PAYLOAD_SIZE: usize = 64 * 1024 * 1024;
const MAX_ENVELOPE_SIZE: usize = MAX_PAYLOAD_SIZE * 2;
const MAX_RECORDS: usize = 100_000;
const MAX_ICON_LENGTH: usize = 512 * 1024;
const MAX_DEVICE_FILES: usize = 32;
const SYNC_FOLDER_NAME: &str = "Tauthy Sync";
const FOLDER_ANCHOR_NAME: &str = "anchor.tauthy-sync";
const WRAP_AAD: &[u8] = b"tauthy-sync-key:v1";
const PAYLOAD_AAD: &[u8] = b"tauthy-sync-payload:v1";
const PUBKY_ROOT: &str = "/priv/tauthy/sync/v1/";
const PUBKY_ANCHOR: &str = "/priv/tauthy/sync/v1/anchor.json";
const PUBKY_DEVICES: &str = "/priv/tauthy/sync/v1/devices/";
const PUBKY_CLIENT_ID: &str = "com.pwltr.tauthy";

const ERR_AUTHENTICATION: &str = "syncAuthenticationFailed";
const ERR_CONFLICT: &str = "syncConflict";
const ERR_LOCAL_CONFLICT: &str = "syncLocalConflict";
const ERR_CORRUPT: &str = "syncCorrupt";
const ERR_FILE_EXISTS: &str = "syncFileExists";
const ERR_DEVICE_FILE: &str = "syncDeviceFileInvalid";
const ERR_DEVICE_LIMIT: &str = "syncDeviceFileLimit";
const ERR_MULTIPLE_FILES: &str = "syncMultipleFiles";
const ERR_NOT_CONFIGURED: &str = "syncNotConfigured";
const ERR_UNAVAILABLE: &str = "syncUnavailable";
const ERR_UNSUPPORTED: &str = "syncUnsupported";

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct VaultEntry {
  uuid: String,
  name: String,
  secret: String,
  #[serde(default, skip_serializing_if = "Option::is_none")]
  issuer: Option<String>,
  #[serde(default, skip_serializing_if = "Option::is_none")]
  group: Option<String>,
  #[serde(default, skip_serializing_if = "Option::is_none")]
  icon: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Revision {
  counter: u64,
  device_id: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SyncRecord {
  id: String,
  revision: Revision,
  deleted: bool,
  #[serde(default, skip_serializing_if = "Option::is_none")]
  entry: Option<VaultEntry>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SyncPayload {
  format: String,
  version: u8,
  vault_id: String,
  clock: u64,
  records: Vec<SyncRecord>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct KdfParameters {
  algorithm: String,
  memory_kib: u32,
  iterations: u32,
  parallelism: u32,
  salt: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Ciphertext {
  algorithm: String,
  nonce: String,
  ciphertext: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct WrappedKey {
  kdf: KdfParameters,
  cipher: Ciphertext,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SyncEnvelope {
  format: String,
  version: u8,
  key: WrappedKey,
  payload: Ciphertext,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SyncConfig {
  path: String,
  device_id: String,
  key: String,
  wrapped_key: WrappedKey,
  payload: SyncPayload,
  last_synced_at: Option<u64>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PubkySyncConfig {
  public_key: String,
  session_secret: String,
  recovery_code: String,
  device_id: String,
  key: String,
  wrapped_key: WrappedKey,
  payload: SyncPayload,
  last_synced_at: Option<u64>,
}

impl Drop for PubkySyncConfig {
  fn drop(&mut self) {
    self.session_secret.zeroize();
    self.recovery_code.zeroize();
    self.key.zeroize();
  }
}

#[derive(Default)]
pub struct PubkySyncState {
  client: AsyncMutex<Option<Pubky>>,
  pending: AsyncMutex<Option<PubkyGrantAuthFlow>>,
  session: AsyncMutex<Option<PubkySession>>,
  operation: AsyncMutex<()>,
}

impl PubkySyncState {
  async fn client(&self) -> Result<Pubky, String> {
    let mut cached = self.client.lock().await;
    if let Some(client) = cached.as_ref() {
      return Ok(client.clone());
    }
    let client = Pubky::new().map_err(|_| ERR_UNAVAILABLE.to_string())?;
    *cached = Some(client.clone());
    Ok(client)
  }
}

impl Drop for SyncConfig {
  fn drop(&mut self) {
    self.key.zeroize();
  }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncStatus {
  enabled: bool,
  path: Option<String>,
  last_synced_at: Option<u64>,
  vault_changed: bool,
  provider: Option<&'static str>,
}

fn random_bytes<const N: usize>() -> Result<[u8; N], String> {
  let mut bytes = [0_u8; N];
  SystemRandom::new()
    .fill(&mut bytes)
    .map_err(|_| ERR_CORRUPT.to_string())?;
  Ok(bytes)
}

fn random_id() -> Result<String, String> {
  let bytes = random_bytes::<16>()?;
  Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn now_millis() -> Result<u64, String> {
  SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .map(|duration| duration.as_millis() as u64)
    .map_err(|_| ERR_CORRUPT.to_string())
}

fn decode_exact(value: &str, length: usize) -> Result<Vec<u8>, String> {
  if value.len() != base64_encoded_length(length) {
    return Err(ERR_UNSUPPORTED.into());
  }
  let decoded = BASE64
    .decode(value.as_bytes())
    .map_err(|_| ERR_UNSUPPORTED.to_string())?;
  if decoded.len() != length {
    return Err(ERR_UNSUPPORTED.into());
  }
  Ok(decoded)
}

const fn base64_encoded_length(decoded_length: usize) -> usize {
  decoded_length.div_ceil(3) * 4
}

fn decode_bounded(value: &str, max_decoded_length: usize) -> Result<Vec<u8>, String> {
  if value.is_empty() || value.len() > base64_encoded_length(max_decoded_length) {
    return Err(ERR_UNSUPPORTED.into());
  }
  let decoded = BASE64
    .decode(value.as_bytes())
    .map_err(|_| ERR_UNSUPPORTED.to_string())?;
  if decoded.is_empty() || decoded.len() > max_decoded_length {
    return Err(ERR_UNSUPPORTED.into());
  }
  Ok(decoded)
}

fn derive_key(password: &[u8], kdf: &KdfParameters) -> Result<Zeroizing<[u8; KEY_SIZE]>, String> {
  if kdf.algorithm != KDF_ALGORITHM
    || kdf.memory_kib != MEMORY_KIB
    || kdf.iterations != ITERATIONS
    || kdf.parallelism != PARALLELISM
  {
    return Err(ERR_UNSUPPORTED.into());
  }
  let salt = decode_exact(&kdf.salt, SALT_SIZE)?;
  let params = Params::new(MEMORY_KIB, ITERATIONS, PARALLELISM, Some(KEY_SIZE))
    .map_err(|_| ERR_UNSUPPORTED.to_string())?;
  let mut key = Zeroizing::new([0_u8; KEY_SIZE]);
  Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
    .hash_password_into(password, &salt, key.as_mut())
    .map_err(|_| ERR_UNSUPPORTED.to_string())?;
  Ok(key)
}

fn encrypt_bytes(bytes: &[u8], key: &[u8], aad: &[u8]) -> Result<Ciphertext, String> {
  if bytes.is_empty() || bytes.len() > MAX_PAYLOAD_SIZE {
    return Err(ERR_CORRUPT.into());
  }
  let nonce = random_bytes::<NONCE_SIZE>()?;
  let cipher = XChaCha20Poly1305::new_from_slice(key).map_err(|_| ERR_CORRUPT.to_string())?;
  let ciphertext = cipher
    .encrypt(XNonce::from_slice(&nonce), Payload { msg: bytes, aad })
    .map_err(|_| ERR_CORRUPT.to_string())?;
  Ok(Ciphertext {
    algorithm: CIPHER_ALGORITHM.into(),
    nonce: BASE64.encode(&nonce),
    ciphertext: BASE64.encode(&ciphertext),
  })
}

fn decrypt_bytes(
  encrypted: &Ciphertext,
  key: &[u8],
  aad: &[u8],
  expected_length: Option<usize>,
) -> Result<Zeroizing<Vec<u8>>, String> {
  if encrypted.algorithm != CIPHER_ALGORITHM {
    return Err(ERR_UNSUPPORTED.into());
  }
  let nonce = decode_exact(&encrypted.nonce, NONCE_SIZE)?;
  let ciphertext = decode_bounded(&encrypted.ciphertext, MAX_PAYLOAD_SIZE + TAG_SIZE)?;
  let cipher = XChaCha20Poly1305::new_from_slice(key).map_err(|_| ERR_UNSUPPORTED.to_string())?;
  let plaintext = cipher
    .decrypt(
      XNonce::from_slice(&nonce),
      Payload {
        msg: &ciphertext,
        aad,
      },
    )
    .map_err(|_| ERR_AUTHENTICATION.to_string())?;
  if expected_length.is_some_and(|length| plaintext.len() != length) {
    return Err(ERR_UNSUPPORTED.into());
  }
  Ok(Zeroizing::new(plaintext))
}

fn wrap_key(sync_key: &[u8; KEY_SIZE], password: &[u8]) -> Result<WrappedKey, String> {
  if password.len() < MIN_PASSWORD_LENGTH {
    return Err(ERR_AUTHENTICATION.into());
  }
  let salt = random_bytes::<SALT_SIZE>()?;
  let kdf = KdfParameters {
    algorithm: KDF_ALGORITHM.into(),
    memory_kib: MEMORY_KIB,
    iterations: ITERATIONS,
    parallelism: PARALLELISM,
    salt: BASE64.encode(&salt),
  };
  let wrapping_key = derive_key(password, &kdf)?;
  let cipher = encrypt_bytes(sync_key, wrapping_key.as_ref(), WRAP_AAD)?;
  Ok(WrappedKey { kdf, cipher })
}

fn unwrap_key(wrapped: &WrappedKey, password: &[u8]) -> Result<Zeroizing<[u8; KEY_SIZE]>, String> {
  let wrapping_key = derive_key(password, &wrapped.kdf)?;
  let plaintext = decrypt_bytes(
    &wrapped.cipher,
    wrapping_key.as_ref(),
    WRAP_AAD,
    Some(KEY_SIZE),
  )?;
  let mut key = Zeroizing::new([0_u8; KEY_SIZE]);
  key.copy_from_slice(&plaintext);
  Ok(key)
}

fn envelope(
  payload: &SyncPayload,
  key: &[u8],
  wrapped_key: WrappedKey,
) -> Result<SyncEnvelope, String> {
  validate_payload(payload)?;
  let plaintext = Zeroizing::new(serde_json::to_vec(payload).map_err(|_| ERR_CORRUPT.to_string())?);
  Ok(SyncEnvelope {
    format: ENVELOPE_FORMAT.into(),
    version: VERSION,
    key: wrapped_key,
    payload: encrypt_bytes(&plaintext, key, PAYLOAD_AAD)?,
  })
}

fn decrypt_payload(envelope: &SyncEnvelope, key: &[u8]) -> Result<SyncPayload, String> {
  if envelope.format != ENVELOPE_FORMAT || envelope.version != VERSION {
    return Err(ERR_UNSUPPORTED.into());
  }
  let plaintext = decrypt_bytes(&envelope.payload, key, PAYLOAD_AAD, None)?;
  let payload = serde_json::from_slice(&plaintext).map_err(|_| ERR_CORRUPT.to_string())?;
  validate_payload(&payload)?;
  Ok(payload)
}

fn valid_entry(entry: &VaultEntry) -> bool {
  !entry.uuid.is_empty()
    && entry.uuid.len() <= 256
    && !entry.name.is_empty()
    && entry.name.len() <= 16_384
    && !entry.secret.is_empty()
    && entry.secret.len() <= 16_384
    && entry
      .issuer
      .as_ref()
      .is_none_or(|value| value.len() <= 16_384)
    && entry
      .group
      .as_ref()
      .is_none_or(|value| value.len() <= 16_384)
    && entry
      .icon
      .as_ref()
      .is_none_or(|value| value.len() <= MAX_ICON_LENGTH)
}

fn validate_payload(payload: &SyncPayload) -> Result<(), String> {
  if payload.format != PAYLOAD_FORMAT
    || payload.version != VERSION
    || payload.vault_id.is_empty()
    || payload.vault_id.len() > 256
    || payload.records.len() > MAX_RECORDS
  {
    return Err(ERR_UNSUPPORTED.into());
  }
  let mut ids = HashSet::new();
  for record in &payload.records {
    if record.id.is_empty()
      || record.id.len() > 256
      || !ids.insert(&record.id)
      || record.revision.counter == 0
      || record.revision.counter > payload.clock
      || record.revision.device_id.is_empty()
      || record.revision.device_id.len() > 256
    {
      return Err(ERR_CORRUPT.into());
    }
    match (&record.entry, record.deleted) {
      (None, true) => {}
      (Some(entry), false) if entry.uuid == record.id && valid_entry(entry) => {}
      _ => return Err(ERR_CORRUPT.into()),
    }
  }
  Ok(())
}

fn parse_entries(bytes: &[u8]) -> Result<Vec<VaultEntry>, String> {
  let entries: Vec<VaultEntry> =
    serde_json::from_slice(bytes).map_err(|_| ERR_CORRUPT.to_string())?;
  let mut ids = HashSet::new();
  if entries.len() > MAX_RECORDS
    || entries
      .iter()
      .any(|entry| !valid_entry(entry) || !ids.insert(&entry.uuid))
  {
    return Err(ERR_CORRUPT.into());
  }
  Ok(entries)
}

fn revision_order(left: &Revision, right: &Revision) -> Ordering {
  left
    .counter
    .cmp(&right.counter)
    .then_with(|| left.device_id.cmp(&right.device_id))
}

fn next_revision(payload: &mut SyncPayload, device_id: &str) -> Revision {
  payload.clock = payload.clock.saturating_add(1);
  Revision {
    counter: payload.clock,
    device_id: device_id.into(),
  }
}

fn new_payload(entries: Vec<VaultEntry>, vault_id: String, device_id: &str) -> SyncPayload {
  let mut payload = SyncPayload {
    format: PAYLOAD_FORMAT.into(),
    version: VERSION,
    vault_id,
    clock: 0,
    records: Vec::with_capacity(entries.len()),
  };
  for entry in entries {
    let revision = next_revision(&mut payload, device_id);
    payload.records.push(SyncRecord {
      id: entry.uuid.clone(),
      revision,
      deleted: false,
      entry: Some(entry),
    });
  }
  payload
    .records
    .sort_by(|left, right| left.id.cmp(&right.id));
  payload
}

fn update_from_local(payload: &mut SyncPayload, entries: Vec<VaultEntry>, device_id: &str) {
  let current: HashMap<String, VaultEntry> = entries
    .into_iter()
    .map(|entry| (entry.uuid.clone(), entry))
    .collect();
  let existing: HashMap<String, SyncRecord> = payload
    .records
    .drain(..)
    .map(|record| (record.id.clone(), record))
    .collect();
  let mut ids: HashSet<String> = current.keys().cloned().collect();
  ids.extend(existing.keys().cloned());
  let mut ids: Vec<_> = ids.into_iter().collect();
  ids.sort();

  for id in ids {
    let entry = current.get(&id);
    let previous = existing.get(&id);
    let unchanged = matches!((entry, previous), (Some(entry), Some(record)) if !record.deleted && record.entry.as_ref() == Some(entry))
      || matches!((entry, previous), (None, Some(record)) if record.deleted);
    if unchanged {
      payload
        .records
        .push(previous.cloned().expect("matched record"));
      continue;
    }
    let revision = next_revision(payload, device_id);
    payload.records.push(SyncRecord {
      id,
      revision,
      deleted: entry.is_none(),
      entry: entry.cloned(),
    });
  }
}

fn add_initial_local_entries(
  payload: &mut SyncPayload,
  entries: Vec<VaultEntry>,
  device_id: &str,
) -> Result<(), String> {
  let mut records: HashMap<String, SyncRecord> = payload
    .records
    .drain(..)
    .map(|record| (record.id.clone(), record))
    .collect();
  for entry in entries {
    match records.get(&entry.uuid) {
      Some(record) if !record.deleted && record.entry.as_ref() == Some(&entry) => continue,
      Some(record) if !record.deleted => return Err(ERR_CONFLICT.into()),
      _ => {}
    }
    let revision = next_revision(payload, device_id);
    records.insert(
      entry.uuid.clone(),
      SyncRecord {
        id: entry.uuid.clone(),
        revision,
        deleted: false,
        entry: Some(entry),
      },
    );
  }
  payload.records = records.into_values().collect();
  payload
    .records
    .sort_by(|left, right| left.id.cmp(&right.id));
  Ok(())
}

fn merge_payloads(local: SyncPayload, remote: SyncPayload) -> Result<SyncPayload, String> {
  validate_payload(&local)?;
  validate_payload(&remote)?;
  if local.vault_id != remote.vault_id {
    return Err(ERR_CONFLICT.into());
  }
  let mut records: BTreeMap<String, SyncRecord> = local
    .records
    .into_iter()
    .map(|record| (record.id.clone(), record))
    .collect();
  for remote_record in remote.records {
    match records.get(&remote_record.id) {
      None => {
        records.insert(remote_record.id.clone(), remote_record);
      }
      Some(local_record) => match revision_order(&local_record.revision, &remote_record.revision) {
        Ordering::Less => {
          records.insert(remote_record.id.clone(), remote_record);
        }
        Ordering::Equal if local_record != &remote_record => return Err(ERR_CONFLICT.into()),
        _ => {}
      },
    }
  }
  Ok(SyncPayload {
    format: PAYLOAD_FORMAT.into(),
    version: VERSION,
    vault_id: local.vault_id,
    clock: local.clock.max(remote.clock),
    records: records.into_values().collect(),
  })
}

fn active_entries(payload: &SyncPayload) -> Vec<VaultEntry> {
  payload
    .records
    .iter()
    .filter_map(|record| (!record.deleted).then(|| record.entry.clone()).flatten())
    .collect()
}

fn read_envelope(path: &Path) -> Result<SyncEnvelope, String> {
  let file_length = fs::metadata(path)
    .map_err(|_| ERR_UNAVAILABLE.to_string())?
    .len();
  if file_length == 0 || file_length > MAX_ENVELOPE_SIZE as u64 {
    return Err(ERR_UNSUPPORTED.into());
  }
  let bytes = fs::read(path).map_err(|_| ERR_UNAVAILABLE.to_string())?;
  if bytes.is_empty() || bytes.len() > MAX_ENVELOPE_SIZE {
    return Err(ERR_UNSUPPORTED.into());
  }
  let envelope: SyncEnvelope =
    serde_json::from_slice(&bytes).map_err(|_| ERR_UNSUPPORTED.to_string())?;
  if envelope.format != ENVELOPE_FORMAT || envelope.version != VERSION {
    return Err(ERR_UNSUPPORTED.into());
  }
  Ok(envelope)
}

fn write_envelope(path: &Path, envelope: &SyncEnvelope) -> Result<(), String> {
  let parent = path.parent().ok_or_else(|| ERR_UNAVAILABLE.to_string())?;
  if !parent.is_dir() {
    return Err(ERR_UNAVAILABLE.into());
  }
  let bytes = serde_json::to_vec_pretty(envelope).map_err(|_| ERR_CORRUPT.to_string())?;
  if bytes.len() > MAX_ENVELOPE_SIZE {
    return Err(ERR_UNSUPPORTED.into());
  }
  let mut temporary = tempfile::Builder::new()
    .prefix(".tauthy-sync-")
    .tempfile_in(parent)
    .map_err(|_| ERR_UNAVAILABLE.to_string())?;
  temporary
    .write_all(&bytes)
    .and_then(|_| temporary.as_file().sync_all())
    .map_err(|_| ERR_UNAVAILABLE.to_string())?;
  temporary
    .persist(path)
    .map_err(|_| ERR_UNAVAILABLE.to_string())?;
  Ok(())
}

fn anchor_path(base: &Path) -> PathBuf {
  if base.is_dir() {
    base.join(FOLDER_ANCHOR_NAME)
  } else {
    base.to_path_buf()
  }
}

fn join_path(selected: &Path) -> Result<PathBuf, String> {
  if !selected.is_dir() || selected.join(FOLDER_ANCHOR_NAME).is_file() {
    return Ok(selected.to_path_buf());
  }
  let mut legacy = None;
  for entry in fs::read_dir(selected).map_err(|_| ERR_UNAVAILABLE.to_string())? {
    let entry = entry.map_err(|_| ERR_UNAVAILABLE.to_string())?;
    let name = entry.file_name();
    if !name
      .to_str()
      .is_some_and(|name| name.ends_with(".tauthy-sync"))
      || !entry
        .file_type()
        .map_err(|_| ERR_UNAVAILABLE.to_string())?
        .is_file()
    {
      continue;
    }
    if legacy.replace(entry.path()).is_some() {
      return Err(ERR_MULTIPLE_FILES.into());
    }
  }
  legacy.ok_or_else(|| ERR_UNAVAILABLE.to_string())
}

fn device_file_path(base: &Path, device_id: &str) -> Result<PathBuf, String> {
  if device_id.len() != 32
    || !device_id
      .bytes()
      .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
  {
    return Err(ERR_CORRUPT.into());
  }
  if base.is_dir() {
    return Ok(base.join(format!("device-{device_id}.tauthy-sync")));
  }
  let name = base
    .file_name()
    .and_then(|name| name.to_str())
    .ok_or_else(|| ERR_UNAVAILABLE.to_string())?;
  Ok(base.with_file_name(format!("{name}.device-{device_id}")))
}

fn device_file_error(path: &Path) -> String {
  let name = path
    .file_name()
    .and_then(|name| name.to_str())
    .unwrap_or("?");
  format!("{ERR_DEVICE_FILE}:{name}")
}

fn read_remote_payload(
  base: &Path,
  key: &[u8],
  wrapped_key: &WrappedKey,
) -> Result<SyncPayload, String> {
  let anchor = read_envelope(&anchor_path(base))?;
  if &anchor.key != wrapped_key {
    return Err(ERR_CONFLICT.into());
  }
  let mut payload = decrypt_payload(&anchor, key)?;
  let folder_layout = base.is_dir();
  let prefix = if folder_layout {
    "device-".to_string()
  } else {
    let name = base
      .file_name()
      .and_then(|name| name.to_str())
      .ok_or_else(|| ERR_UNAVAILABLE.to_string())?;
    format!("{name}.device-")
  };
  let parent = if folder_layout {
    base
  } else {
    base.parent().ok_or_else(|| ERR_UNAVAILABLE.to_string())?
  };
  let mut paths = Vec::new();
  for entry in fs::read_dir(parent).map_err(|_| ERR_UNAVAILABLE.to_string())? {
    let entry = entry.map_err(|_| ERR_UNAVAILABLE.to_string())?;
    let file_name = entry.file_name();
    let Some(suffix) = file_name
      .to_str()
      .and_then(|name| name.strip_prefix(&prefix))
    else {
      continue;
    };
    let Some(id) = (if folder_layout {
      suffix.strip_suffix(".tauthy-sync")
    } else {
      Some(suffix)
    }) else {
      continue;
    };
    if id.len() != 32
      || !id
        .bytes()
        .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    {
      continue;
    }
    paths.push(entry.path());
    if paths.len() > MAX_DEVICE_FILES {
      return Err(ERR_DEVICE_LIMIT.into());
    }
  }
  paths.sort();
  for path in paths {
    let file_error = || device_file_error(&path);
    if !fs::symlink_metadata(&path)
      .map_err(|_| file_error())?
      .file_type()
      .is_file()
    {
      return Err(file_error());
    }
    let envelope = read_envelope(&path).map_err(|_| file_error())?;
    if &envelope.key != wrapped_key {
      return Err(file_error());
    }
    payload = merge_payloads(
      payload,
      decrypt_payload(&envelope, key).map_err(|_| file_error())?,
    )
    .map_err(|_| file_error())?;
  }
  Ok(payload)
}

fn publish_device_payload(
  base: &Path,
  config: &SyncConfig,
  key: &[u8],
  payload: &SyncPayload,
) -> Result<(), String> {
  let path = device_file_path(base, &config.device_id)?;
  write_envelope(&path, &envelope(payload, key, config.wrapped_key.clone())?)
}

fn load_config(vault: &dyn RecordAccess) -> Result<SyncConfig, String> {
  let bytes = vault
    .get_record(SYNC_STORE_NAME)?
    .ok_or_else(|| ERR_NOT_CONFIGURED.to_string())?;
  let config: SyncConfig = serde_json::from_slice(&bytes).map_err(|_| ERR_CORRUPT.to_string())?;
  validate_payload(&config.payload)?;
  decode_exact(&config.key, KEY_SIZE)?;
  if config.path.is_empty() || config.device_id.is_empty() {
    return Err(ERR_CORRUPT.into());
  }
  Ok(config)
}

fn save_local(
  vault: &dyn RecordAccess,
  entries: &[VaultEntry],
  config: &SyncConfig,
) -> Result<(), String> {
  vault.save_records(vec![
    (
      VAULT_STORE_NAME,
      Some(serde_json::to_vec(entries).map_err(|_| ERR_CORRUPT.to_string())?),
    ),
    (
      SYNC_STORE_NAME,
      Some(serde_json::to_vec(config).map_err(|_| ERR_CORRUPT.to_string())?),
    ),
  ])
}

fn current_entries(vault: &dyn RecordAccess) -> Result<Vec<VaultEntry>, String> {
  let record = vault
    .get_record(VAULT_STORE_NAME)?
    .ok_or_else(|| ERR_CORRUPT.to_string())?;
  parse_entries(&record)
}

fn status_for(config: Option<&SyncConfig>) -> SyncStatus {
  SyncStatus {
    enabled: config.is_some(),
    path: config.map(|config| config.path.clone()),
    last_synced_at: config.and_then(|config| config.last_synced_at),
    provider: config.map(|_| "folder"),
    vault_changed: false,
  }
}

fn pubky_status_for(config: &PubkySyncConfig) -> SyncStatus {
  SyncStatus {
    enabled: true,
    path: Some(config.public_key.clone()),
    last_synced_at: config.last_synced_at,
    provider: Some("pubky"),
    vault_changed: false,
  }
}

fn load_pubky_config(vault: &dyn RecordAccess) -> Result<PubkySyncConfig, String> {
  let bytes = Zeroizing::new(
    vault
      .get_record(PUBKY_SYNC_STORE_NAME)?
      .ok_or_else(|| ERR_NOT_CONFIGURED.to_string())?,
  );
  let config: PubkySyncConfig =
    serde_json::from_slice(&bytes).map_err(|_| ERR_CORRUPT.to_string())?;
  validate_payload(&config.payload)?;
  decode_exact(&config.key, KEY_SIZE)?;
  if config.public_key.is_empty()
    || config.session_secret.is_empty()
    || config.recovery_code.len() != KEY_SIZE * 2
    || config.device_id.is_empty()
  {
    return Err(ERR_CORRUPT.into());
  }
  Ok(config)
}

fn save_pubky_local(
  vault: &dyn RecordAccess,
  entries: &[VaultEntry],
  config: &PubkySyncConfig,
) -> Result<(), String> {
  vault.save_records(vec![
    (
      VAULT_STORE_NAME,
      Some(serde_json::to_vec(entries).map_err(|_| ERR_CORRUPT.to_string())?),
    ),
    (
      PUBKY_SYNC_STORE_NAME,
      Some(serde_json::to_vec(config).map_err(|_| ERR_CORRUPT.to_string())?),
    ),
  ])
}

fn pubky_device_path(device_id: &str) -> Result<String, String> {
  if device_id.len() != 32
    || !device_id
      .bytes()
      .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
  {
    return Err(ERR_CORRUPT.into());
  }
  Ok(format!("{PUBKY_DEVICES}{device_id}.json"))
}

async fn pubky_read_envelope(session: &PubkySession, path: &str) -> Result<SyncEnvelope, String> {
  let mut response = session
    .storage()
    .get(path)
    .await
    .map_err(|_| ERR_UNAVAILABLE.to_string())?;
  if response
    .content_length()
    .is_some_and(|length| length == 0 || length > MAX_ENVELOPE_SIZE as u64)
  {
    return Err(ERR_UNSUPPORTED.into());
  }
  let mut bytes = Vec::new();
  while let Some(chunk) = response
    .chunk()
    .await
    .map_err(|_| ERR_UNAVAILABLE.to_string())?
  {
    if bytes.len().saturating_add(chunk.len()) > MAX_ENVELOPE_SIZE {
      return Err(ERR_UNSUPPORTED.into());
    }
    bytes.extend_from_slice(&chunk);
  }
  if bytes.is_empty() {
    return Err(ERR_UNSUPPORTED.into());
  }
  let envelope: SyncEnvelope =
    serde_json::from_slice(&bytes).map_err(|_| ERR_UNSUPPORTED.to_string())?;
  if envelope.format != ENVELOPE_FORMAT || envelope.version != VERSION {
    return Err(ERR_UNSUPPORTED.into());
  }
  Ok(envelope)
}

async fn pubky_write_envelope(
  session: &PubkySession,
  path: &str,
  envelope: &SyncEnvelope,
) -> Result<(), String> {
  let bytes = serde_json::to_vec(envelope).map_err(|_| ERR_CORRUPT.to_string())?;
  if bytes.len() > MAX_ENVELOPE_SIZE {
    return Err(ERR_UNSUPPORTED.into());
  }
  session
    .storage()
    .put(path, bytes)
    .await
    .map_err(|_| ERR_UNAVAILABLE.to_string())?;
  Ok(())
}

async fn pubky_remote_payload(
  session: &PubkySession,
  key: &[u8],
  wrapped_key: &WrappedKey,
) -> Result<SyncPayload, String> {
  let anchor = pubky_read_envelope(session, PUBKY_ANCHOR).await?;
  if &anchor.key != wrapped_key {
    return Err(ERR_CONFLICT.into());
  }
  let mut payload = decrypt_payload(&anchor, key)?;
  let listed = session
    .storage()
    .list(PUBKY_DEVICES)
    .map_err(|_| ERR_UNAVAILABLE.to_string())?
    .limit((MAX_DEVICE_FILES + 1) as u16)
    .send()
    .await;
  let paths = match listed {
    Ok(paths) => paths,
    Err(pubky::Error::Request(pubky::errors::RequestError::Server { status, .. }))
      if status.as_u16() == 404 =>
    {
      Vec::new()
    }
    Err(_) => return Err(ERR_UNAVAILABLE.into()),
  };
  if paths.len() > MAX_DEVICE_FILES {
    return Err(ERR_UNSUPPORTED.into());
  }
  for resource in paths {
    let path = resource.path.as_str();
    let id = path
      .strip_prefix(PUBKY_DEVICES)
      .and_then(|suffix| suffix.strip_suffix(".json"))
      .ok_or_else(|| ERR_UNSUPPORTED.to_string())?;
    if pubky_device_path(id)? != path {
      return Err(ERR_UNSUPPORTED.into());
    }
    let item = pubky_read_envelope(session, path).await?;
    if &item.key != wrapped_key {
      return Err(ERR_CONFLICT.into());
    }
    payload = merge_payloads(payload, decrypt_payload(&item, key)?)?;
  }
  Ok(payload)
}

async fn pubky_publish(
  session: &PubkySession,
  device_id: &str,
  payload: &SyncPayload,
  key: &[u8],
  wrapped_key: &WrappedKey,
) -> Result<(), String> {
  let path = pubky_device_path(device_id)?;
  let encrypted = envelope(payload, key, wrapped_key.clone())?;
  pubky_write_envelope(session, &path, &encrypted).await
}

async fn pubky_restore(
  config: &PubkySyncConfig,
  pubky_state: &PubkySyncState,
) -> Result<PubkySession, String> {
  let client = pubky_state.client().await?;
  let session = client
    .restore_session(&config.session_secret)
    .await
    .map_err(|_| ERR_UNAVAILABLE.to_string())?;
  if session.info().public_key().z32() != config.public_key {
    return Err(ERR_CORRUPT.into());
  }
  Ok(session)
}

async fn pubky_sync_at(
  state: &impl VaultAccess,
  pubky_state: &PubkySyncState,
) -> Result<SyncStatus, String> {
  let (mut config, local_entries) =
    state.with_records(|vault| Ok((load_pubky_config(vault)?, current_entries(vault)?)))?;
  let session = pubky_restore(&config, pubky_state).await?;
  let key = Zeroizing::new(decode_exact(&config.key, KEY_SIZE)?);
  let remote = pubky_remote_payload(&session, &key, &config.wrapped_key).await?;
  update_from_local(&mut config.payload, local_entries, &config.device_id);
  let merged = merge_payloads(config.payload.clone(), remote.clone())?;
  if merged != remote {
    pubky_publish(
      &session,
      &config.device_id,
      &merged,
      &key,
      &config.wrapped_key,
    )
    .await?;
  }
  state.with_records(|vault| {
    // Edits may have happened while the network request was in flight.
    let current = load_pubky_config(vault)?;
    if current.public_key != config.public_key || current.device_id != config.device_id {
      return Err(ERR_CONFLICT.into());
    }
    let latest_entries = current_entries(vault)?;
    config.payload = rebase_pubky_local(
      &config.payload,
      latest_entries.clone(),
      merged,
      &config.device_id,
    )?;
    config.last_synced_at = Some(now_millis()?);
    let entries = active_entries(&config.payload);
    save_pubky_local(vault, &entries, &config)?;
    let mut status = pubky_status_for(&config);
    status.vault_changed = entries != latest_entries;
    Ok(status)
  })
}

fn rebase_pubky_local(
  local_before_network: &SyncPayload,
  current_entries: Vec<VaultEntry>,
  merged_before_commit: SyncPayload,
  device_id: &str,
) -> Result<SyncPayload, String> {
  let mut latest_local = local_before_network.clone();
  latest_local.clock = latest_local.clock.max(merged_before_commit.clock);
  update_from_local(&mut latest_local, current_entries, device_id);
  merge_payloads(latest_local, merged_before_commit)
}

fn create_at(
  state: &impl VaultAccess,
  path: String,
  mut password: String,
) -> Result<SyncStatus, String> {
  let result = state.with_records(|vault| {
    let parent = Path::new(&path);
    if vault.get_record(PUBKY_SYNC_STORE_NAME)?.is_some() {
      return Err(ERR_CONFLICT.into());
    }
    if !parent.is_dir() {
      return Err(ERR_UNAVAILABLE.into());
    }
    let folder = parent.join(SYNC_FOLDER_NAME);
    if folder.exists() {
      return Err(ERR_FILE_EXISTS.into());
    }
    let entries = current_entries(vault)?;
    let device_id = random_id()?;
    let payload = new_payload(entries, random_id()?, &device_id);
    let sync_key = Zeroizing::new(random_bytes::<KEY_SIZE>()?);
    let wrapped_key = wrap_key(&sync_key, password.as_bytes())?;
    let remote = envelope(&payload, sync_key.as_ref(), wrapped_key.clone())?;
    fs::create_dir(&folder).map_err(|error| {
      if error.kind() == std::io::ErrorKind::AlreadyExists {
        ERR_FILE_EXISTS.to_string()
      } else {
        ERR_UNAVAILABLE.to_string()
      }
    })?;
    if let Err(error) = write_envelope(&folder.join(FOLDER_ANCHOR_NAME), &remote) {
      let _ = fs::remove_dir(&folder);
      return Err(error);
    }
    let config = SyncConfig {
      path: folder.to_string_lossy().into_owned(),
      device_id,
      key: BASE64.encode(sync_key.as_ref()),
      wrapped_key,
      payload,
      last_synced_at: Some(now_millis()?),
    };
    let entries = active_entries(&config.payload);
    save_local(vault, &entries, &config)?;
    Ok(status_for(Some(&config)))
  });
  password.zeroize();
  result
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PubkyApproval {
  approved: bool,
  public_key: Option<String>,
  has_remote: Option<bool>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PubkySetupResult {
  status: SyncStatus,
}

#[tauri::command]
pub async fn pubky_sync_start(
  state: State<'_, ApplicationVault>,
  pubky_state: State<'_, PubkySyncState>,
) -> Result<String, String> {
  state.with_records(|vault| {
    if vault.get_record(SYNC_STORE_NAME)?.is_some()
      || vault.get_record(PUBKY_SYNC_STORE_NAME)?.is_some()
    {
      return Err(ERR_CONFLICT.into());
    }
    Ok(())
  })?;
  let client = pubky_state.client().await?;
  let caps = pubky_capabilities()?;
  let client_id = ClientId::new(PUBKY_CLIENT_ID).map_err(|_| ERR_CORRUPT.to_string())?;
  let flow = client
    .start_grant_auth_flow(&caps, AuthFlowKind::signin(), client_id)
    .map_err(|_| ERR_UNAVAILABLE.to_string())?;
  let url = flow.authorization_url().to_string();
  let mut pending = pubky_state.pending.lock().await;
  *pubky_state.session.lock().await = None;
  *pending = Some(flow);
  Ok(url)
}

fn pubky_capabilities() -> Result<Capabilities, String> {
  Ok(
    Capabilities::builder()
      .read_write(PUBKY_ROOT)
      .map_err(|_| ERR_CORRUPT.to_string())?
      .finish(),
  )
}

#[tauri::command]
pub async fn pubky_sync_poll(
  pubky_state: State<'_, PubkySyncState>,
) -> Result<PubkyApproval, String> {
  let mut pending = pubky_state.pending.lock().await;
  if let Some(flow) = pending.as_ref() {
    if let Some(session) = flow
      .try_poll_once()
      .await
      .map_err(|_| ERR_UNAVAILABLE.to_string())?
    {
      *pubky_state.session.lock().await = Some(session);
      *pending = None;
    }
  }
  drop(pending);
  let session = pubky_state.session.lock().await.clone();
  match session {
    Some(session) => {
      let has_remote = session
        .storage()
        .exists(PUBKY_ANCHOR)
        .await
        .map_err(|_| ERR_UNAVAILABLE.to_string())?;
      Ok(PubkyApproval {
        approved: true,
        public_key: Some(session.info().public_key().z32()),
        has_remote: Some(has_remote),
      })
    }
    None => Ok(PubkyApproval {
      approved: false,
      public_key: None,
      has_remote: None,
    }),
  }
}

#[tauri::command]
pub async fn pubky_sync_cancel(pubky_state: State<'_, PubkySyncState>) -> Result<(), String> {
  *pubky_state.pending.lock().await = None;
  let session = pubky_state.session.lock().await.take();
  if let Some(session) = session {
    // A canceled setup must not leave an unused grant behind when online.
    let _ = session.signout().await;
  }
  Ok(())
}

#[tauri::command]
pub async fn pubky_sync_create(
  app: AppHandle,
  state: State<'_, ApplicationVault>,
  pubky_state: State<'_, PubkySyncState>,
  recovery_code: String,
) -> Result<PubkySetupResult, String> {
  let recovery_code = Zeroizing::new(recovery_code);
  if recovery_code.len() != KEY_SIZE * 2
    || !recovery_code.bytes().all(|byte| byte.is_ascii_hexdigit())
  {
    return Err(ERR_AUTHENTICATION.into());
  }
  let _operation = pubky_state.operation.lock().await;
  let session = pubky_state
    .session
    .lock()
    .await
    .clone()
    .ok_or_else(|| ERR_NOT_CONFIGURED.to_string())?;
  if session
    .storage()
    .exists(PUBKY_ANCHOR)
    .await
    .map_err(|_| ERR_UNAVAILABLE.to_string())?
  {
    return Err(ERR_FILE_EXISTS.into());
  }
  let entries = state.with_records(|vault| {
    if vault.get_record(SYNC_STORE_NAME)?.is_some()
      || vault.get_record(PUBKY_SYNC_STORE_NAME)?.is_some()
    {
      return Err(ERR_CONFLICT.into());
    }
    current_entries(vault)
  })?;
  let device_id = random_id()?;
  let payload = new_payload(entries, random_id()?, &device_id);
  let sync_key = Zeroizing::new(random_bytes::<KEY_SIZE>()?);
  let wrapped_key = wrap_key(&sync_key, recovery_code.as_bytes())?;
  let remote = envelope(&payload, sync_key.as_ref(), wrapped_key.clone())?;
  // The anchor contains the initial payload. If the next write fails, the
  // already-displayed recovery code can still join that anchor on retry.
  pubky_write_envelope(&session, PUBKY_ANCHOR, &remote).await?;
  pubky_publish(
    &session,
    &device_id,
    &payload,
    sync_key.as_ref(),
    &wrapped_key,
  )
  .await?;
  let session_secret = session
    .as_grant()
    .ok_or_else(|| ERR_UNSUPPORTED.to_string())?
    .export_local_secret()
    .await
    .ok_or_else(|| ERR_UNSUPPORTED.to_string())?;
  let config = PubkySyncConfig {
    public_key: session.info().public_key().z32(),
    session_secret,
    recovery_code: recovery_code.to_string(),
    device_id,
    key: BASE64.encode(sync_key.as_ref()),
    wrapped_key,
    payload,
    last_synced_at: Some(now_millis()?),
  };
  state.with_records(|vault| {
    if vault.get_record(SYNC_STORE_NAME)?.is_some()
      || vault.get_record(PUBKY_SYNC_STORE_NAME)?.is_some()
    {
      return Err(ERR_CONFLICT.into());
    }
    save_pubky_local(vault, &active_entries(&config.payload), &config)
  })?;
  *pubky_state.session.lock().await = None;
  let _ = crate::tray::refresh_menu(&app);
  Ok(PubkySetupResult {
    status: pubky_status_for(&config),
  })
}

#[tauri::command]
pub async fn pubky_sync_join(
  app: AppHandle,
  state: State<'_, ApplicationVault>,
  pubky_state: State<'_, PubkySyncState>,
  mut recovery_code: String,
) -> Result<PubkySetupResult, String> {
  let _operation = pubky_state.operation.lock().await;
  let result = async {
    if recovery_code.len() != KEY_SIZE * 2
      || !recovery_code.bytes().all(|byte| byte.is_ascii_hexdigit())
    {
      return Err(ERR_AUTHENTICATION.into());
    }
    let session = pubky_state
      .session
      .lock()
      .await
      .clone()
      .ok_or_else(|| ERR_NOT_CONFIGURED.to_string())?;
    let anchor = pubky_read_envelope(&session, PUBKY_ANCHOR).await?;
    let sync_key = unwrap_key(&anchor.key, recovery_code.as_bytes())?;
    let remote = pubky_remote_payload(&session, sync_key.as_ref(), &anchor.key).await?;
    let local_entries = state.with_records(|vault| {
      if vault.get_record(SYNC_STORE_NAME)?.is_some()
        || vault.get_record(PUBKY_SYNC_STORE_NAME)?.is_some()
      {
        return Err(ERR_CONFLICT.into());
      }
      current_entries(vault)
    })?;
    let device_id = random_id()?;
    let mut payload = remote.clone();
    add_initial_local_entries(&mut payload, local_entries, &device_id).map_err(|error| {
      if error == ERR_CONFLICT {
        ERR_LOCAL_CONFLICT.to_string()
      } else {
        error
      }
    })?;
    if payload != remote {
      pubky_publish(
        &session,
        &device_id,
        &payload,
        sync_key.as_ref(),
        &anchor.key,
      )
      .await?;
    }
    let session_secret = session
      .as_grant()
      .ok_or_else(|| ERR_UNSUPPORTED.to_string())?
      .export_local_secret()
      .await
      .ok_or_else(|| ERR_UNSUPPORTED.to_string())?;
    let config = PubkySyncConfig {
      public_key: session.info().public_key().z32(),
      session_secret,
      recovery_code: recovery_code.clone(),
      device_id,
      key: BASE64.encode(sync_key.as_ref()),
      wrapped_key: anchor.key,
      payload,
      last_synced_at: Some(now_millis()?),
    };
    state.with_records(|vault| {
      if vault.get_record(SYNC_STORE_NAME)?.is_some()
        || vault.get_record(PUBKY_SYNC_STORE_NAME)?.is_some()
      {
        return Err(ERR_CONFLICT.into());
      }
      save_pubky_local(vault, &active_entries(&config.payload), &config)
    })?;
    *pubky_state.session.lock().await = None;
    let _ = crate::tray::refresh_menu(&app);
    Ok(PubkySetupResult {
      status: pubky_status_for(&config),
    })
  }
  .await;
  recovery_code.zeroize();
  result
}

#[tauri::command]
pub async fn pubky_sync_recovery_code(
  state: State<'_, ApplicationVault>,
) -> Result<String, String> {
  state.with_records(|vault| Ok(load_pubky_config(vault)?.recovery_code.clone()))
}

fn join_at(
  state: &impl VaultAccess,
  path: String,
  mut password: String,
) -> Result<SyncStatus, String> {
  let result = state.with_records(|vault| {
    let selected = join_path(Path::new(&path))?;
    if vault.get_record(PUBKY_SYNC_STORE_NAME)?.is_some() {
      return Err(ERR_CONFLICT.into());
    }
    let remote = read_envelope(&anchor_path(&selected))?;
    let sync_key = unwrap_key(&remote.key, password.as_bytes())?;
    let remote_payload = read_remote_payload(&selected, sync_key.as_ref(), &remote.key)?;
    let mut payload = remote_payload.clone();
    let device_id = random_id()?;
    add_initial_local_entries(&mut payload, current_entries(vault)?, &device_id)?;
    let config = SyncConfig {
      path: selected.to_string_lossy().into_owned(),
      device_id,
      key: BASE64.encode(sync_key.as_ref()),
      wrapped_key: remote.key,
      payload,
      last_synced_at: Some(now_millis()?),
    };
    if config.payload != remote_payload {
      publish_device_payload(
        Path::new(&config.path),
        &config,
        sync_key.as_ref(),
        &config.payload,
      )?;
    }
    let entries = active_entries(&config.payload);
    save_local(vault, &entries, &config)?;
    Ok(status_for(Some(&config)))
  });
  password.zeroize();
  result
}

fn sync_at(state: &impl VaultAccess) -> Result<SyncStatus, String> {
  sync_at_with_import(state, None)
}

fn sync_at_with_import(
  state: &impl VaultAccess,
  import_path: Option<&Path>,
) -> Result<SyncStatus, String> {
  state.with_records(|vault| {
    let mut config = load_config(vault)?;
    let previous_payload = config.payload.clone();
    let local_entries = current_entries(vault)?;
    update_from_local(
      &mut config.payload,
      local_entries.clone(),
      &config.device_id,
    );
    let key = Zeroizing::new(decode_exact(&config.key, KEY_SIZE)?);
    let base = Path::new(&config.path);
    let remote_payload = read_remote_payload(base, &key, &config.wrapped_key)?;
    let mut merged = merge_payloads(config.payload.clone(), remote_payload.clone())?;
    if let Some(path) = import_path {
      let imported = read_envelope(path)?;
      if imported.key != config.wrapped_key {
        return Err(ERR_CONFLICT.into());
      }
      merged = merge_payloads(merged, decrypt_payload(&imported, &key)?)?;
    }
    if merged != remote_payload {
      publish_device_payload(base, &config, &key, &merged)?;
    }
    let entries = active_entries(&merged);
    let vault_changed = entries != local_entries;
    if merged == previous_payload && !vault_changed {
      // A successful poll with no new records should not re-encrypt the local
      // Stronghold snapshot or make the frontend rebuild its account list.
      return Ok(status_for(Some(&config)));
    }
    config.payload = merged;
    config.last_synced_at = Some(now_millis()?);
    save_local(vault, &entries, &config)?;
    let mut status = status_for(Some(&config));
    status.vault_changed = vault_changed;
    Ok(status)
  })
}

#[tauri::command]
pub async fn sync_merge_conflicted_copy(
  app: AppHandle,
  state: State<'_, ApplicationVault>,
  path: String,
) -> Result<SyncStatus, String> {
  let state = state.inner().clone();
  let status = tauri::async_runtime::spawn_blocking(move || {
    sync_at_with_import(&state, Some(Path::new(&path)))
  })
  .await
  .map_err(|_| ERR_CORRUPT.to_string())
  .and_then(|result| result);
  let _ = crate::tray::refresh_menu(&app);
  status
}

#[tauri::command]
pub async fn sync_create(
  app: AppHandle,
  state: State<'_, ApplicationVault>,
  path: String,
  password: String,
) -> Result<SyncStatus, String> {
  let state = state.inner().clone();
  let status = tauri::async_runtime::spawn_blocking(move || create_at(&state, path, password))
    .await
    .map_err(|_| ERR_CORRUPT.to_string())
    .and_then(|result| result);
  let _ = crate::tray::refresh_menu(&app);
  status
}

#[tauri::command]
pub async fn sync_join(
  app: AppHandle,
  state: State<'_, ApplicationVault>,
  path: String,
  password: String,
) -> Result<SyncStatus, String> {
  let state = state.inner().clone();
  let status = tauri::async_runtime::spawn_blocking(move || join_at(&state, path, password))
    .await
    .map_err(|_| ERR_CORRUPT.to_string())
    .and_then(|result| result);
  let _ = crate::tray::refresh_menu(&app);
  status
}

#[tauri::command]
pub async fn sync_now(
  app: AppHandle,
  state: State<'_, ApplicationVault>,
  pubky_state: State<'_, PubkySyncState>,
) -> Result<SyncStatus, String> {
  let state = state.inner().clone();
  let is_pubky =
    state.with_records(|vault| Ok(vault.get_record(PUBKY_SYNC_STORE_NAME)?.is_some()))?;
  let status = if is_pubky {
    let _operation = pubky_state.operation.lock().await;
    pubky_sync_at(&state, &pubky_state).await
  } else {
    tauri::async_runtime::spawn_blocking(move || sync_at(&state))
      .await
      .map_err(|_| ERR_CORRUPT.to_string())
      .and_then(|result| result)
  };
  let _ = crate::tray::refresh_menu(&app);
  status
}

fn status_at(state: &impl VaultAccess) -> Result<SyncStatus, String> {
  state.with_records(|vault| {
    if vault.get_record(PUBKY_SYNC_STORE_NAME)?.is_some() {
      return Ok(pubky_status_for(&load_pubky_config(vault)?));
    }
    match vault.get_record(SYNC_STORE_NAME)? {
      None => Ok(status_for(None)),
      Some(bytes) => {
        let config: SyncConfig =
          serde_json::from_slice(&bytes).map_err(|_| ERR_CORRUPT.to_string())?;
        Ok(status_for(Some(&config)))
      }
    }
  })
}

fn disconnect_at(state: &impl VaultAccess) -> Result<SyncStatus, String> {
  state.with_records(|vault| {
    vault.save_records(vec![(SYNC_STORE_NAME, None), (PUBKY_SYNC_STORE_NAME, None)])?;
    Ok(status_for(None))
  })
}

#[tauri::command]
pub async fn sync_status(state: State<'_, ApplicationVault>) -> Result<SyncStatus, String> {
  let state = state.inner().clone();
  tauri::async_runtime::spawn_blocking(move || status_at(&state))
    .await
    .map_err(|_| ERR_CORRUPT.to_string())?
}

#[tauri::command]
pub async fn sync_disconnect(
  app: AppHandle,
  state: State<'_, ApplicationVault>,
  pubky_state: State<'_, PubkySyncState>,
) -> Result<SyncStatus, String> {
  let _operation = pubky_state.operation.lock().await;
  let state = state.inner().clone();
  let status = tauri::async_runtime::spawn_blocking(move || disconnect_at(&state))
    .await
    .map_err(|_| ERR_CORRUPT.to_string())
    .and_then(|result| result);
  let _ = crate::tray::refresh_menu(&app);
  if status.is_ok() {
    *pubky_state.session.lock().await = None;
  }
  status
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::legacy_vault::{vault_change_password_at, vault_load_at, vault_save_at, VaultState};
  use std::path::PathBuf;

  fn entry(id: &str, name: &str) -> VaultEntry {
    VaultEntry {
      uuid: id.into(),
      name: name.into(),
      secret: "JBSWY3DPEHPK3PXP".into(),
      issuer: Some("Example".into()),
      group: None,
      icon: None,
    }
  }

  #[test]
  fn local_edits_and_deletions_create_revisions() {
    let mut payload = new_payload(
      vec![entry("one", "One"), entry("two", "Two")],
      "vault".into(),
      "a",
    );
    let initial_clock = payload.clock;
    update_from_local(&mut payload, vec![entry("one", "Changed")], "a");
    assert_eq!(payload.clock, initial_clock + 2);
    assert_eq!(active_entries(&payload), vec![entry("one", "Changed")]);
    assert!(payload
      .records
      .iter()
      .any(|record| record.id == "two" && record.deleted));
  }

  #[test]
  fn merge_keeps_independent_changes_and_propagates_deletions() {
    let base = new_payload(
      vec![entry("one", "One"), entry("two", "Two")],
      "vault".into(),
      "a",
    );
    let mut left = base.clone();
    let mut right = base;
    update_from_local(
      &mut left,
      vec![entry("one", "Left"), entry("two", "Two")],
      "a",
    );
    update_from_local(&mut right, vec![entry("one", "One")], "b");
    let merged = merge_payloads(left, right).unwrap();
    assert_eq!(active_entries(&merged), vec![entry("one", "Left")]);
  }

  #[test]
  fn concurrent_edits_resolve_deterministically() {
    let base = new_payload(vec![entry("one", "One")], "vault".into(), "seed");
    let mut left = base.clone();
    let mut right = base;
    update_from_local(&mut left, vec![entry("one", "Left")], "a");
    update_from_local(&mut right, vec![entry("one", "Right")], "b");
    let merged_lr = merge_payloads(left.clone(), right.clone()).unwrap();
    let merged_rl = merge_payloads(right, left).unwrap();
    assert_eq!(merged_lr, merged_rl);
    assert_eq!(active_entries(&merged_lr), vec![entry("one", "Right")]);
  }

  #[test]
  fn encrypted_payload_round_trips_and_rejects_wrong_password() {
    let payload = new_payload(vec![entry("one", "One")], "vault".into(), "device");
    let key = random_bytes::<KEY_SIZE>().unwrap();
    let wrapped = wrap_key(&key, b"correct horse battery staple").unwrap();
    let encrypted = envelope(&payload, &key, wrapped.clone()).unwrap();
    let recovered_key = unwrap_key(&wrapped, b"correct horse battery staple").unwrap();
    assert_eq!(
      decrypt_payload(&encrypted, recovered_key.as_ref()).unwrap(),
      payload
    );
    assert_eq!(
      unwrap_key(&wrapped, b"incorrect password").unwrap_err(),
      ERR_AUTHENTICATION
    );
  }

  #[test]
  fn encoded_values_are_bounded_before_decoding() {
    let encoded = BASE64.encode(&[0_u8; 4]);
    assert_eq!(decode_bounded(&encoded, 3), Err(ERR_UNSUPPORTED.into()));
  }

  #[test]
  fn oversized_envelopes_are_rejected_before_reading() {
    let temporary = tempfile::tempdir().unwrap();
    let path = temporary.path().join("oversized.tauthy-sync");
    let file = std::fs::File::create(&path).unwrap();
    file.set_len(MAX_ENVELOPE_SIZE as u64 + 1).unwrap();

    assert_eq!(read_envelope(&path), Err(ERR_UNSUPPORTED.into()));
  }

  #[test]
  fn joining_preserves_distinct_local_and_remote_entries() {
    let mut payload = new_payload(
      vec![entry("remote", "Remote")],
      "vault".into(),
      "remote-device",
    );
    add_initial_local_entries(&mut payload, vec![entry("local", "Local")], "local-device").unwrap();
    assert_eq!(active_entries(&payload).len(), 2);
  }

  #[test]
  fn joining_rejects_different_entries_with_the_same_id() {
    let mut payload = new_payload(
      vec![entry("same", "Remote")],
      "vault".into(),
      "remote-device",
    );
    assert_eq!(
      add_initial_local_entries(&mut payload, vec![entry("same", "Local")], "local-device"),
      Err(ERR_CONFLICT.into())
    );
  }

  fn open_test_vault(root: &Path, name: &str, entries: Vec<VaultEntry>) -> VaultState {
    let _ = iota_stronghold::engine::snapshot::try_set_encrypt_work_factor(0);
    let state = VaultState::default();
    let path = root.join(format!("{name}.stronghold"));
    vault_load_at(&state, path, String::new()).unwrap();
    vault_save_at(&state, serde_json::to_string(&entries).unwrap()).unwrap();
    state
  }

  fn stored_entries(state: &impl VaultAccess) -> Vec<VaultEntry> {
    state.with_records(current_entries).unwrap()
  }

  fn config_for(state: &impl VaultAccess) -> SyncConfig {
    state.with_records(load_config).unwrap()
  }

  #[test]
  fn vault_deferred_legacy_session_syncs_with_file_backend_without_native_calls() {
    use crate::{
      vault_journal::Identity,
      vault_runtime::Runtime,
      vault_transaction::{Credentials, Error as TxError},
    };
    struct Unavailable {
      calls: usize,
    }
    impl Credentials for Unavailable {
      fn get(&mut self, _: &Identity) -> Result<Option<Zeroizing<[u8; 32]>>, TxError> {
        self.calls += 1;
        Err(TxError::CredentialUnavailable)
      }
      fn set(&mut self, _: &Identity, _: &[u8; 32]) -> Result<(), TxError> {
        panic!("unexpected native key write")
      }
      fn remove(&mut self, _: &Identity) -> Result<(), TxError> {
        panic!("unexpected native key removal")
      }
    }
    let root = tempfile::tempdir().unwrap();
    let legacy_directory = root.path().join("legacy");
    let file_directory = root.path().join("file");
    fs::create_dir(&legacy_directory).unwrap();
    fs::create_dir(&file_directory).unwrap();
    let legacy = VaultState::default();
    crate::legacy_vault::vault_load_at(
      &legacy,
      legacy_directory.join("vault.stronghold"),
      "".into(),
    )
    .unwrap();
    crate::legacy_vault::vault_save_at(
      &legacy,
      serde_json::to_string(&vec![entry("a", "Alpha")]).unwrap(),
    )
    .unwrap();
    drop(legacy);
    let a = Runtime::new(legacy_directory);
    let b = Runtime::new(file_directory);
    let mut keys = Unavailable { calls: 0 };
    a.migrate_legacy("", &mut keys).unwrap();
    let calls = keys.calls;
    b.create(Some("local"), &mut keys).unwrap();
    b.with_records(|vault| {
      vault.save_records(vec![(
        VAULT_STORE_NAME,
        Some(serde_json::to_vec(&vec![entry("b", "Beta")]).unwrap()),
      )])
    })
    .unwrap();
    create_at(
      &a,
      root.path().to_string_lossy().into_owned(),
      "sync-password".into(),
    )
    .unwrap();
    join_at(
      &b,
      root
        .path()
        .join(SYNC_FOLDER_NAME)
        .to_string_lossy()
        .into_owned(),
      "sync-password".into(),
    )
    .unwrap();
    sync_at(&a).unwrap();
    assert_eq!(a.with_records(current_entries).unwrap().len(), 2);
    assert_eq!(keys.calls, calls);
    assert!(a.status().unwrap().legacy_password.is_some());
    a.lock().unwrap();
    a.unlock_current(Some(""), None, &mut keys).unwrap();
    sync_at(&a).unwrap();
    assert_eq!(keys.calls, calls);
    assert_eq!(a.with_records(current_entries).unwrap().len(), 2);
  }

  #[test]
  fn vault_file_backend_two_vaults_sync_deletion_noop_restart_and_disconnect() {
    use crate::{
      vault_journal::Identity,
      vault_runtime::Runtime,
      vault_transaction::{Credentials, Error as TxError},
    };
    struct NoNative;
    impl Credentials for NoNative {
      fn get(&mut self, _: &Identity) -> Result<Option<Zeroizing<[u8; 32]>>, TxError> {
        panic!("native key lookup in password fixture")
      }
      fn set(&mut self, _: &Identity, _: &[u8; 32]) -> Result<(), TxError> {
        panic!("native key write in password fixture")
      }
      fn remove(&mut self, _: &Identity) -> Result<(), TxError> {
        panic!("native key removal in password fixture")
      }
    }
    let root = tempfile::tempdir().unwrap();
    let mut runtimes = Vec::new();
    for (name, account) in [("a", entry("a", "Alpha")), ("b", entry("b", "Beta"))] {
      let directory = root.path().join(name);
      fs::create_dir(&directory).unwrap();
      let runtime = Runtime::new(directory);
      runtime.create(Some("local"), &mut NoNative).unwrap();
      runtime
        .with_records(|vault| {
          vault.save_records(vec![
            (
              VAULT_STORE_NAME,
              Some(serde_json::to_vec(&vec![account]).unwrap()),
            ),
            (b"opaque", Some(vec![0, 255])),
          ])
        })
        .unwrap();
      runtimes.push(runtime);
    }
    let a = &runtimes[0];
    let b = &runtimes[1];
    create_at(
      a,
      root.path().to_string_lossy().into_owned(),
      "sync-password".into(),
    )
    .unwrap();
    join_at(
      b,
      root
        .path()
        .join(SYNC_FOLDER_NAME)
        .to_string_lossy()
        .into_owned(),
      "sync-password".into(),
    )
    .unwrap();
    assert!(sync_at(a).unwrap().vault_changed);
    assert_eq!(a.with_records(current_entries).unwrap().len(), 2);
    a.with_records(|vault| {
      vault.save_records(vec![(
        VAULT_STORE_NAME,
        Some(serde_json::to_vec(&vec![entry("b", "Beta")]).unwrap()),
      )])
    })
    .unwrap();
    sync_at(a).unwrap();
    assert!(sync_at(b).unwrap().vault_changed);
    assert_eq!(
      b.with_records(current_entries).unwrap(),
      vec![entry("b", "Beta")]
    );
    let file = root.path().join("a/vault.tauthy");
    let before = fs::read(&file).unwrap();
    assert!(!sync_at(a).unwrap().vault_changed);
    assert_eq!(fs::read(&file).unwrap(), before);
    a.lock().unwrap();
    assert_eq!(sync_at(a).err(), Some("vault is locked".into()));
    // Reconstruct the backend, not just its session: this must load the sync
    // configuration from disk exactly as an application restart does.
    let restarted = Runtime::new(root.path().join("a"));
    restarted
      .unlock_current(Some("local"), None, &mut NoNative)
      .unwrap();
    let a = &restarted;
    assert!(status_at(a).unwrap().enabled);
    assert!(!sync_at(a).unwrap().vault_changed);
    assert_eq!(
      a.with_records(|vault| vault.get_record(b"opaque")).unwrap(),
      Some(vec![0, 255])
    );
    disconnect_at(a).unwrap();
    assert!(!status_at(a).unwrap().enabled);
    assert_eq!(
      a.with_records(current_entries).unwrap(),
      vec![entry("b", "Beta")]
    );
    assert!(root
      .path()
      .join(SYNC_FOLDER_NAME)
      .join(FOLDER_ANCHOR_NAME)
      .exists());
    a.delete(true, &mut NoNative).unwrap();
    assert!(root
      .path()
      .join(SYNC_FOLDER_NAME)
      .join(FOLDER_ANCHOR_NAME)
      .exists());
  }

  #[test]
  fn two_vaults_create_join_and_propagate_a_deletion() {
    let temporary = tempfile::tempdir().unwrap();
    let sync_path: PathBuf = temporary.path().join(SYNC_FOLDER_NAME);
    let first = open_test_vault(temporary.path(), "first", vec![entry("one", "One")]);
    create_at(
      &first,
      temporary.path().to_string_lossy().into_owned(),
      "recovery password".into(),
    )
    .unwrap();
    assert!(sync_path.join(FOLDER_ANCHOR_NAME).exists());

    let second = open_test_vault(temporary.path(), "second", Vec::new());
    join_at(
      &second,
      sync_path.to_string_lossy().into_owned(),
      "recovery password".into(),
    )
    .unwrap();
    assert_eq!(stored_entries(&second), vec![entry("one", "One")]);

    vault_save_at(&second, "[]".into()).unwrap();
    sync_at(&second).unwrap();
    assert!(sync_at(&first).unwrap().vault_changed);
    assert!(stored_entries(&first).is_empty());
  }

  #[test]
  fn unchanged_sync_does_not_rewrite_the_local_snapshot() {
    let temporary = tempfile::tempdir().unwrap();
    let vault_path = temporary.path().join("local.stronghold");
    let state = open_test_vault(temporary.path(), "local", vec![entry("one", "One")]);
    create_at(
      &state,
      temporary.path().to_string_lossy().into_owned(),
      "recovery password".into(),
    )
    .unwrap();
    let before = fs::read(&vault_path).unwrap();
    let last_synced_at = config_for(&state).last_synced_at;

    let status = sync_at(&state).unwrap();

    assert!(!status.vault_changed);
    assert_eq!(status.last_synced_at, last_synced_at);
    assert_eq!(fs::read(&vault_path).unwrap(), before);
  }

  #[test]
  fn independent_folder_replicas_preserve_concurrent_edits_without_rewriting_anchor() {
    let temporary = tempfile::tempdir().unwrap();
    let left_dir = temporary.path().join("left-cloud");
    let right_dir = temporary.path().join("right-cloud");
    fs::create_dir_all(&left_dir).unwrap();
    fs::create_dir_all(&right_dir).unwrap();
    let left_path = left_dir.join(SYNC_FOLDER_NAME);
    let right_path = right_dir.join(SYNC_FOLDER_NAME);
    let left = open_test_vault(temporary.path(), "left", vec![entry("base", "Base")]);
    create_at(
      &left,
      left_dir.to_string_lossy().into_owned(),
      "recovery password".into(),
    )
    .unwrap();
    let anchor = fs::read(anchor_path(&left_path)).unwrap();
    sync_at(&left).unwrap();
    assert!(!device_file_path(&left_path, &config_for(&left).device_id)
      .unwrap()
      .exists());
    assert_eq!(fs::read(anchor_path(&left_path)).unwrap(), anchor);
    fs::create_dir(&right_path).unwrap();
    fs::copy(anchor_path(&left_path), anchor_path(&right_path)).unwrap();
    let right = open_test_vault(temporary.path(), "right", Vec::new());
    join_at(
      &right,
      right_path.to_string_lossy().into_owned(),
      "recovery password".into(),
    )
    .unwrap();
    assert_eq!(fs::read(anchor_path(&right_path)).unwrap(), anchor);
    assert!(
      !device_file_path(&right_path, &config_for(&right).device_id)
        .unwrap()
        .exists()
    );

    vault_save_at(
      &left,
      serde_json::to_string(&vec![entry("base", "Base"), entry("left", "Left")]).unwrap(),
    )
    .unwrap();
    vault_save_at(
      &right,
      serde_json::to_string(&vec![entry("base", "Base"), entry("right", "Right")]).unwrap(),
    )
    .unwrap();
    sync_at(&left).unwrap();
    sync_at(&right).unwrap();
    let left_file = device_file_path(&left_path, &config_for(&left).device_id).unwrap();
    let right_file = device_file_path(&right_path, &config_for(&right).device_id).unwrap();
    assert!(left_file.exists());
    assert!(right_file.exists());
    fs::copy(&left_file, right_path.join(left_file.file_name().unwrap())).unwrap();
    fs::copy(&right_file, left_path.join(right_file.file_name().unwrap())).unwrap();
    sync_at(&left).unwrap();
    sync_at(&right).unwrap();
    let expected = vec![
      entry("base", "Base"),
      entry("left", "Left"),
      entry("right", "Right"),
    ];
    assert_eq!(stored_entries(&left), expected);
    assert_eq!(stored_entries(&right), expected);
    assert_eq!(fs::read(anchor_path(&left_path)).unwrap(), anchor);
    assert_eq!(fs::read(anchor_path(&right_path)).unwrap(), anchor);
    let left_sidecar = fs::read(&left_file).unwrap();
    sync_at(&left).unwrap();
    assert_eq!(fs::read(&left_file).unwrap(), left_sidecar);
  }

  #[test]
  fn conflicted_copy_can_be_merged_without_modifying_it() {
    let temporary = tempfile::tempdir().unwrap();
    let conflict_path = temporary
      .path()
      .join("Tauthy Sync (conflicted copy).tauthy-sync");
    let state = open_test_vault(temporary.path(), "local", vec![entry("base", "Base")]);
    create_at(
      &state,
      temporary.path().to_string_lossy().into_owned(),
      "recovery password".into(),
    )
    .unwrap();
    let config = config_for(&state);
    let key = decode_exact(&config.key, KEY_SIZE).unwrap();
    let mut conflict = config.payload.clone();
    update_from_local(
      &mut conflict,
      vec![entry("base", "Base"), entry("rescued", "Rescued")],
      "other-device",
    );
    write_envelope(
      &conflict_path,
      &envelope(&conflict, &key, config.wrapped_key.clone()).unwrap(),
    )
    .unwrap();
    let original_conflict = fs::read(&conflict_path).unwrap();
    sync_at_with_import(&state, Some(&conflict_path)).unwrap();
    assert_eq!(
      stored_entries(&state),
      vec![entry("base", "Base"), entry("rescued", "Rescued")]
    );
    assert_eq!(fs::read(&conflict_path).unwrap(), original_conflict);
  }

  #[test]
  fn new_device_joins_from_anchor_and_device_files() {
    let temporary = tempfile::tempdir().unwrap();
    let sync_path = temporary.path().join(SYNC_FOLDER_NAME);
    let first = open_test_vault(temporary.path(), "first", vec![entry("base", "Base")]);
    create_at(
      &first,
      temporary.path().to_string_lossy().into_owned(),
      "recovery password".into(),
    )
    .unwrap();
    vault_save_at(
      &first,
      serde_json::to_string(&vec![entry("base", "Base"), entry("new", "New")]).unwrap(),
    )
    .unwrap();
    sync_at(&first).unwrap();

    let second = open_test_vault(temporary.path(), "second", Vec::new());
    join_at(
      &second,
      sync_path.to_string_lossy().into_owned(),
      "recovery password".into(),
    )
    .unwrap();
    assert_eq!(
      stored_entries(&second),
      vec![entry("base", "Base"), entry("new", "New")]
    );
  }

  #[test]
  fn existing_file_sync_remains_usable() {
    let temporary = tempfile::tempdir().unwrap();
    let folder = temporary.path().join(SYNC_FOLDER_NAME);
    let legacy_file = temporary.path().join("Tauthy Sync.tauthy-sync");
    let first = open_test_vault(temporary.path(), "first", vec![entry("base", "Base")]);
    create_at(
      &first,
      temporary.path().to_string_lossy().into_owned(),
      "recovery password".into(),
    )
    .unwrap();

    fs::copy(anchor_path(&folder), &legacy_file).unwrap();
    let mut config = config_for(&first);
    config.path = legacy_file.to_string_lossy().into_owned();
    first
      .with_unlocked(|vault| save_local(vault, &current_entries(vault)?, &config))
      .unwrap();
    vault_save_at(
      &first,
      serde_json::to_string(&vec![entry("base", "Base"), entry("new", "New")]).unwrap(),
    )
    .unwrap();
    sync_at(&first).unwrap();
    assert!(device_file_path(&legacy_file, &config.device_id)
      .unwrap()
      .exists());

    let second = open_test_vault(temporary.path(), "second", Vec::new());
    join_at(
      &second,
      temporary.path().to_string_lossy().into_owned(),
      "recovery password".into(),
    )
    .unwrap();
    assert_eq!(
      config_for(&second).path,
      legacy_file.to_string_lossy().into_owned()
    );
    assert_eq!(
      stored_entries(&second),
      vec![entry("base", "Base"), entry("new", "New")]
    );
  }

  #[test]
  fn joining_a_folder_with_multiple_legacy_sync_files_is_ambiguous() {
    let temporary = tempfile::tempdir().unwrap();
    fs::write(temporary.path().join("one.tauthy-sync"), b"one").unwrap();
    fs::write(temporary.path().join("two.tauthy-sync"), b"two").unwrap();
    assert_eq!(join_path(temporary.path()), Err(ERR_MULTIPLE_FILES.into()));
  }

  #[test]
  fn invalid_device_file_error_names_the_file_without_changing_the_local_vault() {
    let temporary = tempfile::tempdir().unwrap();
    let state = open_test_vault(temporary.path(), "local", vec![entry("base", "Base")]);
    create_at(
      &state,
      temporary.path().to_string_lossy().into_owned(),
      "recovery password".into(),
    )
    .unwrap();
    let folder = temporary.path().join(SYNC_FOLDER_NAME);
    let filename = "device-00000000000000000000000000000001.tauthy-sync";
    fs::write(folder.join(filename), b"incomplete cloud copy").unwrap();

    assert_eq!(
      sync_at(&state).err().unwrap(),
      format!("{ERR_DEVICE_FILE}:{filename}")
    );
    assert_eq!(stored_entries(&state), vec![entry("base", "Base")]);
  }

  #[test]
  fn device_file_limit_has_a_distinct_error() {
    let temporary = tempfile::tempdir().unwrap();
    let state = open_test_vault(temporary.path(), "local", Vec::new());
    create_at(
      &state,
      temporary.path().to_string_lossy().into_owned(),
      "recovery password".into(),
    )
    .unwrap();
    let folder = temporary.path().join(SYNC_FOLDER_NAME);
    for number in 0..=MAX_DEVICE_FILES {
      fs::write(
        folder.join(format!("device-{number:032x}.tauthy-sync")),
        b"unused",
      )
      .unwrap();
    }

    assert_eq!(sync_at(&state).err().unwrap(), ERR_DEVICE_LIMIT);
  }

  #[test]
  fn pubky_grant_and_storage_are_scoped_to_private_sync_data() {
    assert_eq!(
      pubky_capabilities().unwrap().to_string(),
      "/priv/tauthy/sync/v1/:rw"
    );
    assert_eq!(PUBKY_ANCHOR, format!("{PUBKY_ROOT}anchor.json"));
    assert_eq!(PUBKY_DEVICES, format!("{PUBKY_ROOT}devices/"));
    assert!(!PUBKY_ROOT.starts_with("/pub/"));
  }

  #[test]
  fn pubky_device_paths_accept_only_generated_ids() {
    assert_eq!(
      pubky_device_path("0123456789abcdef0123456789abcdef").unwrap(),
      "/priv/tauthy/sync/v1/devices/0123456789abcdef0123456789abcdef.json"
    );
    for invalid in ["../anchor", "ABCDEF0123456789abcdef0123456789", "short"] {
      assert!(pubky_device_path(invalid).is_err());
    }
  }

  #[test]
  fn pubky_rebase_keeps_remote_additions_and_late_local_edits() {
    let local = new_payload(vec![entry("one", "Original")], "vault".into(), "local");
    let mut remote = local.clone();
    update_from_local(
      &mut remote,
      vec![entry("one", "Original"), entry("two", "Remote")],
      "remote",
    );
    let merged = merge_payloads(local.clone(), remote).unwrap();

    let unchanged = rebase_pubky_local(
      &local,
      vec![entry("one", "Original")],
      merged.clone(),
      "local",
    )
    .unwrap();
    assert_eq!(
      active_entries(&unchanged),
      vec![entry("one", "Original"), entry("two", "Remote")]
    );

    let changed = rebase_pubky_local(
      &local,
      vec![entry("one", "Changed locally")],
      merged,
      "local",
    )
    .unwrap();
    assert_eq!(
      active_entries(&changed),
      vec![entry("one", "Changed locally"), entry("two", "Remote")]
    );
  }

  #[test]
  fn changing_the_local_vault_password_preserves_sync_configuration() {
    let temporary = tempfile::tempdir().unwrap();
    let vault_path = temporary.path().join("password-change.stronghold");
    let _ = iota_stronghold::engine::snapshot::try_set_encrypt_work_factor(0);
    let state = VaultState::default();
    vault_load_at(&state, vault_path.clone(), String::new()).unwrap();
    vault_save_at(
      &state,
      serde_json::to_string(&vec![entry("one", "One")]).unwrap(),
    )
    .unwrap();
    create_at(
      &state,
      temporary.path().to_string_lossy().into_owned(),
      "recovery password".into(),
    )
    .unwrap();

    vault_change_password_at(&state, "new local password".into()).unwrap();
    vault_load_at(&state, vault_path, "new local password".into()).unwrap();

    assert!(state
      .with_unlocked(|vault| Ok(load_config(vault).is_ok()))
      .unwrap());
    sync_at(&state).unwrap();
  }

  #[test]
  fn changing_the_local_vault_password_preserves_pubky_credentials() {
    let temporary = tempfile::tempdir().unwrap();
    let vault_path = temporary.path().join("pubky-password-change.stronghold");
    let _ = iota_stronghold::engine::snapshot::try_set_encrypt_work_factor(0);
    let state = VaultState::default();
    vault_load_at(&state, vault_path.clone(), String::new()).unwrap();
    vault_save_at(
      &state,
      serde_json::to_string(&vec![entry("one", "One")]).unwrap(),
    )
    .unwrap();
    let credentials = b"encrypted-pubky-configuration".to_vec();
    state
      .with_unlocked(|vault| {
        vault.put_record(PUBKY_SYNC_STORE_NAME, credentials.clone())?;
        vault.commit()
      })
      .unwrap();

    vault_change_password_at(&state, "new local password".into()).unwrap();
    vault_load_at(&state, vault_path, "new local password".into()).unwrap();
    assert_eq!(
      state
        .with_unlocked(|vault| vault.get_record(PUBKY_SYNC_STORE_NAME))
        .unwrap(),
      Some(credentials)
    );
  }
}
