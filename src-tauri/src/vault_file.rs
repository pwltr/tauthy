//! Bounded local-vault envelope. No filesystem, keychain, or Tauri side effects.
use std::{collections::BTreeMap, io::Read};

use argon2::{Algorithm, Argon2, Params, Version};
use chacha20poly1305::{
  aead::{Aead, Payload},
  KeyInit, XChaCha20Poly1305, XNonce,
};
use ring::rand::{SecureRandom, SystemRandom};
use zeroize::{Zeroize, Zeroizing};

const MAGIC: &[u8; 8] = b"TAUTHYV\0";
const HEADER_SIZE: usize = 163;
const MAX_PLAINTEXT: usize = 64 * 1024 * 1024;
const MAX_RECORDS: usize = 4096;
const MAX_KEY: usize = 4096;
const WRAP_CONTEXT: &[u8] = b"tauthy-local-vault-key:v1";
const PAYLOAD_CONTEXT: &[u8] = b"tauthy-local-vault-payload:v1";

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Error {
  Authentication,
  Corrupt,
  Unsupported,
  TooLarge,
  EmptyPassword,
  CredentialMissing,
  WrongProtection,
  Random,
  Io,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Protection {
  Password,
  Credential,
}

/// Values, including unknown records, are cleared on drop. Never derive Debug.
#[derive(Default)]
pub(crate) struct Records(BTreeMap<Vec<u8>, Vec<u8>>);

impl Drop for Records {
  fn drop(&mut self) {
    for value in self.0.values_mut() {
      value.zeroize();
    }
  }
}

impl Records {
  pub(crate) fn insert(&mut self, key: Vec<u8>, value: Vec<u8>) {
    if let Some(mut previous) = self.0.insert(key, value) {
      previous.zeroize();
    }
  }

  pub(crate) fn get(&self, key: &[u8]) -> Option<&[u8]> {
    self.0.get(key).map(Vec::as_slice)
  }

  pub(crate) fn same_as(&self, other: &Self) -> bool {
    self.0 == other.0
  }

  fn encode(&self) -> Result<Zeroizing<Vec<u8>>, Error> {
    if self.0.len() > MAX_RECORDS {
      return Err(Error::TooLarge);
    }
    let mut length = 4usize;
    for (key, value) in &self.0 {
      if key.is_empty() || key.len() > MAX_KEY {
        return Err(Error::Corrupt);
      }
      length = length
        .checked_add(12)
        .and_then(|n| n.checked_add(key.len()))
        .and_then(|n| n.checked_add(value.len()))
        .ok_or(Error::TooLarge)?;
      if length > MAX_PLAINTEXT {
        return Err(Error::TooLarge);
      }
    }
    let mut bytes = Zeroizing::new(Vec::with_capacity(length));
    bytes.extend_from_slice(&(self.0.len() as u32).to_le_bytes());
    for (key, value) in &self.0 {
      bytes.extend_from_slice(&(key.len() as u32).to_le_bytes());
      bytes.extend_from_slice(key);
      bytes.extend_from_slice(&(value.len() as u64).to_le_bytes());
      bytes.extend_from_slice(value);
    }
    Ok(bytes)
  }

  fn decode(bytes: &[u8]) -> Result<Self, Error> {
    if bytes.len() > MAX_PLAINTEXT {
      return Err(Error::TooLarge);
    }
    let mut cursor = Cursor { bytes, offset: 0 };
    let count = u32::from_le_bytes(cursor.take(4)?.try_into().unwrap()) as usize;
    if count > MAX_RECORDS {
      return Err(Error::TooLarge);
    }
    let mut records = Self::default();
    let mut previous: Option<Vec<u8>> = None;
    for _ in 0..count {
      let key_length = u32::from_le_bytes(cursor.take(4)?.try_into().unwrap()) as usize;
      if key_length == 0 || key_length > MAX_KEY {
        return Err(Error::Corrupt);
      }
      let key = cursor.take(key_length)?.to_vec();
      if previous.as_ref().is_some_and(|old| old >= &key) {
        return Err(Error::Corrupt);
      }
      let value_length = u64::from_le_bytes(cursor.take(8)?.try_into().unwrap());
      let value_length = usize::try_from(value_length).map_err(|_| Error::TooLarge)?;
      let value = cursor.take(value_length)?.to_vec();
      previous = Some(key.clone());
      records.insert(key, value);
    }
    if cursor.offset != bytes.len() {
      return Err(Error::Corrupt);
    }
    Ok(records)
  }
}

struct Cursor<'a> {
  bytes: &'a [u8],
  offset: usize,
}

impl<'a> Cursor<'a> {
  fn take(&mut self, count: usize) -> Result<&'a [u8], Error> {
    let end = self.offset.checked_add(count).ok_or(Error::Corrupt)?;
    let result = self.bytes.get(self.offset..end).ok_or(Error::Corrupt)?;
    self.offset = end;
    Ok(result)
  }
}

fn random<const N: usize>() -> Result<[u8; N], Error> {
  let mut bytes = [0; N];
  SystemRandom::new()
    .fill(&mut bytes)
    .map_err(|_| Error::Random)?;
  Ok(bytes)
}

fn derive(password: &str, salt: &[u8]) -> Result<Zeroizing<[u8; 32]>, Error> {
  if password.is_empty() {
    return Err(Error::EmptyPassword);
  }
  let params = Params::new(65_536, 3, 1, Some(32)).map_err(|_| Error::Unsupported)?;
  let mut key = Zeroizing::new([0; 32]);
  Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
    .hash_password_into(password.as_bytes(), salt, key.as_mut())
    .map_err(|_| Error::Authentication)?;
  Ok(key)
}

fn aad(context: &[u8], header: &[u8]) -> Vec<u8> {
  [context, header].concat()
}

pub(crate) struct Envelope {
  header: [u8; HEADER_SIZE],
  ciphertext: Vec<u8>,
}

impl Envelope {
  /// Reader is capped even if the file grows after metadata inspection.
  pub(crate) fn read(mut reader: impl Read) -> Result<Self, Error> {
    let mut header = [0; HEADER_SIZE];
    reader.read_exact(&mut header).map_err(|_| Error::Corrupt)?;
    if &header[..8] != MAGIC {
      return Err(Error::Corrupt);
    }
    if header[8..10] != 1u16.to_le_bytes() {
      return Err(Error::Unsupported);
    }
    match header[10] {
      1 => {}
      2 if header[67..155].iter().all(|byte| *byte == 0) => {}
      2 => return Err(Error::Corrupt),
      _ => return Err(Error::Unsupported),
    }
    let length = u64::from_le_bytes(header[155..163].try_into().unwrap());
    if length < 20 {
      return Err(Error::Corrupt);
    }
    if length > MAX_PLAINTEXT as u64 + 16 {
      return Err(Error::TooLarge);
    }
    let mut ciphertext = Vec::new();
    reader
      .by_ref()
      .take(length + 1)
      .read_to_end(&mut ciphertext)
      .map_err(|_| Error::Io)?;
    if ciphertext.len() as u64 != length {
      return Err(Error::Corrupt);
    }
    Ok(Self { header, ciphertext })
  }

  pub(crate) fn protection(&self) -> Protection {
    if self.header[10] == 1 {
      Protection::Password
    } else {
      Protection::Credential
    }
  }

  pub(crate) fn identity(&self) -> ([u8; 16], [u8; 16]) {
    (
      self.header[11..27].try_into().unwrap(),
      self.header[27..43].try_into().unwrap(),
    )
  }

  pub(crate) fn unlock_password(self, password: &str) -> Result<Vault, Error> {
    self.unlock_password_with(password, derive)
  }

  fn unlock_password_with(
    self,
    password: &str,
    kdf: impl FnOnce(&str, &[u8]) -> Result<Zeroizing<[u8; 32]>, Error>,
  ) -> Result<Vault, Error> {
    if self.protection() != Protection::Password {
      return Err(Error::WrongProtection);
    }
    if password.is_empty() {
      return Err(Error::EmptyPassword);
    }
    let wrapping_key = kdf(password, &self.header[67..83])?;
    let key = Zeroizing::new(
      XChaCha20Poly1305::new_from_slice(wrapping_key.as_ref())
        .unwrap()
        .decrypt(
          XNonce::from_slice(&self.header[83..107]),
          Payload {
            msg: &self.header[107..155],
            aad: &aad(WRAP_CONTEXT, &self.header[..43]),
          },
        )
        .map_err(|_| Error::Authentication)?,
    );
    let data_key = Zeroizing::new(key.as_slice().try_into().map_err(|_| Error::Corrupt)?);
    self.unlock(data_key)
  }

  pub(crate) fn unlock_credential(self, key: Option<[u8; 32]>) -> Result<Vault, Error> {
    let key = key.map(Zeroizing::new).ok_or(Error::CredentialMissing)?;
    if self.protection() != Protection::Credential {
      return Err(Error::WrongProtection);
    }
    self.unlock(key)
  }

  fn unlock(self, key: Zeroizing<[u8; 32]>) -> Result<Vault, Error> {
    let plaintext = Zeroizing::new(
      XChaCha20Poly1305::new_from_slice(key.as_ref())
        .unwrap()
        .decrypt(
          XNonce::from_slice(&self.header[43..67]),
          Payload {
            msg: &self.ciphertext,
            aad: &aad(PAYLOAD_CONTEXT, &self.header),
          },
        )
        .map_err(|_| Error::Authentication)?,
    );
    let records = Records::decode(&plaintext)?;
    Ok(Vault {
      header: self.header,
      key,
      records,
    })
  }

  /// Internal authenticated payload open; callers already own the data key.
  /// This is never exposed as an IPC command or a password bypass.
  pub(crate) fn unlock_data_key(self, key: [u8; 32]) -> Result<Vault, Error> {
    self.unlock(Zeroizing::new(key))
  }
}

pub(crate) struct Vault {
  header: [u8; HEADER_SIZE],
  key: Zeroizing<[u8; 32]>,
  pub(crate) records: Records,
}

impl Vault {
  pub(crate) fn create(records: Records, password: Option<&str>) -> Result<Self, Error> {
    Self::create_with(records, password, random()?, derive)
  }

  fn create_with(
    records: Records,
    password: Option<&str>,
    identity: [u8; 16],
    kdf: impl FnOnce(&str, &[u8]) -> Result<Zeroizing<[u8; 32]>, Error>,
  ) -> Result<Self, Error> {
    Self::create_with_ids(records, password, identity, random()?, kdf)
  }

  pub(crate) fn create_for_identity(
    records: Records,
    password: Option<&str>,
    identity: [u8; 16],
    generation: [u8; 16],
  ) -> Result<Self, Error> {
    Self::create_with_ids(records, password, identity, generation, derive)
  }

  fn create_with_ids(
    records: Records,
    password: Option<&str>,
    identity: [u8; 16],
    generation: [u8; 16],
    kdf: impl FnOnce(&str, &[u8]) -> Result<Zeroizing<[u8; 32]>, Error>,
  ) -> Result<Self, Error> {
    // Preflight records before expensive derivation or future external effects.
    records.encode()?;
    let mut header = [0; HEADER_SIZE];
    header[..8].copy_from_slice(MAGIC);
    header[8..10].copy_from_slice(&1u16.to_le_bytes());
    header[10] = if password.is_some() { 1 } else { 2 };
    header[11..27].copy_from_slice(&identity);
    header[27..43].copy_from_slice(&generation);
    let key = Zeroizing::new(random::<32>()?);
    if let Some(password) = password {
      if password.is_empty() {
        return Err(Error::EmptyPassword);
      }
      header[67..83].copy_from_slice(&random::<16>()?);
      header[83..107].copy_from_slice(&random::<24>()?);
      let wrapping_key = kdf(password, &header[67..83])?;
      let wrapped = XChaCha20Poly1305::new_from_slice(wrapping_key.as_ref())
        .unwrap()
        .encrypt(
          XNonce::from_slice(&header[83..107]),
          Payload {
            msg: key.as_ref(),
            aad: &aad(WRAP_CONTEXT, &header[..43]),
          },
        )
        .map_err(|_| Error::Authentication)?;
      header[107..155].copy_from_slice(&wrapped);
    }
    Ok(Self {
      header,
      key,
      records,
    })
  }

  pub(crate) fn identity(&self) -> ([u8; 16], [u8; 16]) {
    (
      self.header[11..27].try_into().unwrap(),
      self.header[27..43].try_into().unwrap(),
    )
  }

  /// Only Rust credential storage may access this; never expose it through IPC.
  pub(crate) fn credential_key(&self) -> &[u8; 32] {
    &self.key
  }

  pub(crate) fn restore_credential_candidate(
    records: Records,
    identity: [u8; 16],
    generation: [u8; 16],
    key: Zeroizing<[u8; 32]>,
  ) -> Result<Self, Error> {
    let mut vault = Self::create_for_identity(records, None, identity, generation)?;
    vault.key = key;
    Ok(vault)
  }

  pub(crate) fn protection(&self) -> Protection {
    if self.header[10] == 1 {
      Protection::Password
    } else {
      Protection::Credential
    }
  }

  pub(crate) fn seal(&self) -> Result<Vec<u8>, Error> {
    let plaintext = self.records.encode()?;
    let mut header = self.header;
    header[43..67].copy_from_slice(&random::<24>()?);
    header[155..163].copy_from_slice(&((plaintext.len() + 16) as u64).to_le_bytes());
    let ciphertext = XChaCha20Poly1305::new_from_slice(self.key.as_ref())
      .unwrap()
      .encrypt(
        XNonce::from_slice(&header[43..67]),
        Payload {
          msg: &plaintext,
          aad: &aad(PAYLOAD_CONTEXT, &header),
        },
      )
      .map_err(|_| Error::Authentication)?;
    Ok([header.as_slice(), ciphertext.as_slice()].concat())
  }

  pub(crate) fn rotate(&self, password: Option<&str>) -> Result<Self, Error> {
    self.rotate_with(password, derive)
  }

  fn rotate_with(
    &self,
    password: Option<&str>,
    kdf: impl FnOnce(&str, &[u8]) -> Result<Zeroizing<[u8; 32]>, Error>,
  ) -> Result<Self, Error> {
    let records = Records::decode(&self.records.encode()?)?;
    Self::create_with(records, password, self.identity().0, kdf)
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  // Test-only substitute, never selectable through a header or production API.
  fn fast_kdf(password: &str, salt: &[u8]) -> Result<Zeroizing<[u8; 32]>, Error> {
    let bytes = [password.as_bytes(), salt].concat();
    let hash = ring::digest::digest(&ring::digest::SHA256, &bytes);
    Ok(Zeroizing::new(hash.as_ref().try_into().unwrap()))
  }

  fn records() -> Records {
    let mut records = Records::default();
    records.insert(b"unknown-key".to_vec(), vec![0, 255, 1]);
    records.insert(b"empty".to_vec(), Vec::new());
    records
  }

  fn password_vault() -> Vault {
    Vault::create_with(records(), Some("x"), [7; 16], fast_kdf).unwrap()
  }

  #[test]
  fn production_argon2_round_trip_preserves_short_existing_passwords() {
    let vault = Vault::create(records(), Some("x")).unwrap();
    let bytes = vault.seal().unwrap();
    let reopened = Envelope::read(bytes.as_slice())
      .unwrap()
      .unlock_password("x")
      .unwrap();
    assert!(vault.records.0 == reopened.records.0);
  }

  #[test]
  fn password_round_trip_and_unknown_records_survive_repeated_saves() {
    let vault = password_vault();
    let bytes = vault.seal().unwrap();
    let reopened = Envelope::read(bytes.as_slice())
      .unwrap()
      .unlock_password_with("x", fast_kdf)
      .unwrap();
    assert!(vault.records.0 == reopened.records.0);
    assert_eq!(reopened.records.get(b"empty"), Some([].as_slice()));
    assert!(reopened.records.get(b"missing").is_none());
    let second = reopened.seal().unwrap();
    assert_ne!(&bytes[43..67], &second[43..67]);
    let final_vault = Envelope::read(second.as_slice())
      .unwrap()
      .unlock_password_with("x", fast_kdf)
      .unwrap();
    assert!(vault.records.0 == final_vault.records.0);
  }

  #[test]
  fn credential_round_trip_including_zero_records() {
    let vault = Vault::create(Records::default(), None).unwrap();
    let bytes = vault.seal().unwrap();
    assert_eq!(bytes.len(), HEADER_SIZE + 20);
    assert!(bytes[67..155].iter().all(|byte| *byte == 0));
    let opened = Envelope::read(bytes.as_slice())
      .unwrap()
      .unlock_credential(Some(*vault.credential_key()))
      .unwrap();
    assert!(opened.records.0.is_empty());
    assert!(matches!(
      Envelope::read(bytes.as_slice())
        .unwrap()
        .unlock_credential(None),
      Err(Error::CredentialMissing)
    ));
    assert!(matches!(
      Envelope::read(bytes.as_slice())
        .unwrap()
        .unlock_credential(Some([0; 32])),
      Err(Error::Authentication)
    ));
  }

  #[test]
  fn empty_password_is_never_a_password_protection_mode() {
    assert!(matches!(
      Vault::create(records(), Some("")),
      Err(Error::EmptyPassword)
    ));
    assert!(matches!(
      password_vault().rotate_with(Some(""), fast_kdf),
      Err(Error::EmptyPassword)
    ));
  }

  #[test]
  fn rotation_changes_key_and_generation_but_preserves_identity_and_records() {
    let original = password_vault();
    let changed = original.rotate_with(Some("new"), fast_kdf).unwrap();
    assert_eq!(original.identity().0, changed.identity().0);
    assert_ne!(original.identity().1, changed.identity().1);
    assert_ne!(original.credential_key(), changed.credential_key());
    assert!(original.records.0 == changed.records.0);
    assert_ne!(&original.header[67..83], &changed.header[67..83]);
    let bytes = changed.seal().unwrap();
    assert!(matches!(
      Envelope::read(bytes.as_slice())
        .unwrap()
        .unlock_password_with("x", fast_kdf),
      Err(Error::Authentication)
    ));
    let credential = changed.rotate_with(None, fast_kdf).unwrap();
    let bytes = credential.seal().unwrap();
    assert!(matches!(
      Envelope::read(bytes.as_slice())
        .unwrap()
        .unlock_credential(Some(*changed.credential_key())),
      Err(Error::Authentication)
    ));
    let reopened = Envelope::read(bytes.as_slice())
      .unwrap()
      .unlock_credential(Some(*credential.credential_key()))
      .unwrap();
    assert!(reopened.records.0 == original.records.0);
  }

  #[test]
  fn every_byte_is_either_rejected_or_authenticated() {
    let bytes = password_vault().seal().unwrap();
    for index in 0..bytes.len() {
      let mut altered = bytes.clone();
      altered[index] ^= 1;
      if let Ok(envelope) = Envelope::read(altered.as_slice()) {
        assert!(
          envelope.unlock_password_with("x", fast_kdf).is_err(),
          "byte {index}"
        );
      }
    }
  }

  #[test]
  fn truncation_trailing_bytes_and_hostile_lengths_are_rejected() {
    let bytes = password_vault().seal().unwrap();
    for end in 0..bytes.len() {
      assert!(Envelope::read(&bytes[..end]).is_err());
    }
    let mut trailing = bytes.clone();
    trailing.push(0);
    assert!(matches!(
      Envelope::read(trailing.as_slice()),
      Err(Error::Corrupt)
    ));
    let mut huge = bytes.clone();
    huge[155..163].copy_from_slice(&u64::MAX.to_le_bytes());
    assert!(matches!(
      Envelope::read(huge.as_slice()),
      Err(Error::TooLarge)
    ));
  }

  #[test]
  fn credential_mode_rejects_nonzero_wrap_metadata() {
    let mut bytes = Vault::create(records(), None).unwrap().seal().unwrap();
    bytes[67] = 1;
    assert!(matches!(
      Envelope::read(bytes.as_slice()),
      Err(Error::Corrupt)
    ));
  }

  #[test]
  fn record_decoder_rejects_duplicate_unsorted_oversized_and_trailing_records() {
    let one = {
      let mut records = Records::default();
      records.insert(vec![1], vec![2]);
      records.encode().unwrap()
    };
    let mut duplicate = 2u32.to_le_bytes().to_vec();
    duplicate.extend_from_slice(&one[4..]);
    duplicate.extend_from_slice(&one[4..]);
    assert!(matches!(Records::decode(&duplicate), Err(Error::Corrupt)));
    let mut unsorted = duplicate;
    unsorted[8] = 3;
    assert!(matches!(Records::decode(&unsorted), Err(Error::Corrupt)));
    assert!(matches!(
      Records::decode(&4097u32.to_le_bytes()),
      Err(Error::TooLarge)
    ));
    let mut trailing = one.to_vec();
    trailing.push(0);
    assert!(matches!(Records::decode(&trailing), Err(Error::Corrupt)));
    let mut invalid = Records::default();
    invalid.insert(vec![0; MAX_KEY + 1], Vec::new());
    assert!(invalid.encode().is_err());
  }

  #[test]
  fn undersized_ciphertext_is_corrupt_not_oversized() {
    let mut bytes = password_vault().seal().unwrap();
    bytes[155..163].copy_from_slice(&19u64.to_le_bytes());
    assert!(matches!(
      Envelope::read(bytes.as_slice()),
      Err(Error::Corrupt)
    ));
  }

  #[test]
  fn exact_record_count_and_key_size_limits_are_accepted() {
    let mut records = Records::default();
    for number in 0..MAX_RECORDS as u32 {
      records.insert(number.to_be_bytes().to_vec(), Vec::new());
    }
    let decoded = Records::decode(&records.encode().unwrap()).unwrap();
    assert!(records.same_as(&decoded));
    let mut maximum_key = Records::default();
    maximum_key.insert(vec![42; MAX_KEY], vec![7]);
    let decoded = Records::decode(&maximum_key.encode().unwrap()).unwrap();
    assert!(maximum_key.same_as(&decoded));
  }

  #[test]
  fn exact_plaintext_limit_round_trips_and_one_extra_byte_is_rejected() {
    let mut records = Records::default();
    // Count (4), key length (4), one-byte key, value length (8).
    records.insert(vec![1], vec![42; MAX_PLAINTEXT - 17]);
    let vault = Vault::create_with(records, Some("test"), [9; 16], fast_kdf).unwrap();
    let bytes = vault.seal().unwrap();
    assert_eq!(bytes.len(), HEADER_SIZE + MAX_PLAINTEXT + 16);
    let opened = Envelope::read(bytes.as_slice())
      .unwrap()
      .unlock_password_with("test", fast_kdf)
      .unwrap();
    assert!(opened.records.same_as(&vault.records));
    drop(opened);
    drop(bytes);
    let mut records = vault.records;
    records.0.get_mut(&vec![1]).unwrap().push(42);
    assert!(matches!(records.encode(), Err(Error::TooLarge)));
  }
}
