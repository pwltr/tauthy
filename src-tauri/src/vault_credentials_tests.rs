use super::*;
use std::collections::BTreeMap;

#[derive(Default)]
struct FakeBackend {
  entries: BTreeMap<(String, String), Zeroizing<Vec<u8>>>,
  failure: Option<BackendError>,
  corrupt_write: bool,
  discard_write: bool,
  writes: usize,
}
impl Backend for FakeBackend {
  fn read(&mut self, service: &str, account: &str) -> Result<Zeroizing<Vec<u8>>, BackendError> {
    if let Some(error) = self.failure.as_ref() {
      return Err(match error {
        BackendError::Denied => BackendError::Denied,
        BackendError::Unavailable => BackendError::Unavailable,
        BackendError::Conflict => BackendError::Conflict,
        _ => BackendError::Malformed,
      });
    }
    self
      .entries
      .get(&(service.to_owned(), account.to_owned()))
      .map(|bytes| Zeroizing::new(bytes.to_vec()))
      .ok_or(BackendError::Missing)
  }
  fn write(&mut self, service: &str, account: &str, secret: &[u8]) -> Result<(), BackendError> {
    self.writes += 1;
    if !self.discard_write {
      let bytes = if self.corrupt_write {
        BASE64.encode(&[7; 32]).into_bytes()
      } else {
        secret.to_vec()
      };
      self.entries.insert(
        (service.to_owned(), account.to_owned()),
        Zeroizing::new(bytes),
      );
    }
    Ok(())
  }
  fn delete(&mut self, service: &str, account: &str) -> Result<(), BackendError> {
    if self.failure.is_some() {
      self.read(service, account)?;
    }
    self
      .entries
      .remove(&(service.to_owned(), account.to_owned()))
      .map(|_| ())
      .ok_or(BackendError::Missing)
  }
}

fn identity() -> Identity {
  Identity {
    vault_id: [1; 16],
    key_generation: [2; 16],
    credential: true,
  }
}
fn adapter() -> PlatformCredentials<FakeBackend> {
  PlatformCredentials {
    backend: FakeBackend::default(),
    development: true,
  }
}

#[test]
fn adapter_round_trips_all_key_bytes_and_deletes_idempotently() {
  let mut keys = adapter();
  let id = identity();
  assert!(keys.get(&id).unwrap().is_none());
  let mut key = [0; 32];
  for (index, byte) in key.iter_mut().enumerate() {
    *byte = (index * 8) as u8;
  }
  keys.set(&id, &key).unwrap();
  assert_eq!(*keys.get(&id).unwrap().unwrap(), key);
  let encoded = keys.backend.entries.values().next().unwrap();
  assert_eq!(encoded.len(), 44);
  assert!(std::str::from_utf8(encoded).is_ok());
  keys.set(&id, &key).unwrap();
  assert_eq!(keys.backend.writes, 1);
  assert!(matches!(keys.set(&id, &[255; 32]), Err(Error::Conflict)));
  assert_eq!(*keys.get(&id).unwrap().unwrap(), key);
  keys.remove(&id).unwrap();
  keys.remove(&id).unwrap();
  assert!(keys.get(&id).unwrap().is_none());
}

#[test]
fn missing_denied_unavailable_and_ambiguous_are_distinct_without_fallback() {
  let mut keys = adapter();
  let id = identity();
  assert!(keys.get(&id).unwrap().is_none());
  for (failure, expected) in [
    (BackendError::Denied, Error::CredentialAccessDenied),
    (BackendError::Unavailable, Error::CredentialUnavailable),
    (BackendError::Conflict, Error::Conflict),
  ] {
    keys.backend.failure = Some(failure);
    assert_eq!(keys.get(&id).err(), Some(expected));
    assert!(keys.set(&id, &[3; 32]).is_err());
    assert!(keys.remove(&id).is_err());
    assert_eq!(keys.backend.writes, 0);
    assert!(keys.backend.entries.is_empty());
  }
}

#[test]
fn malformed_entries_never_become_missing_or_get_overwritten() {
  for bytes in [
    vec![],
    vec![b'A'; 43],
    vec![b'!'; 44],
    BASE64.encode(&[0; 31]).into_bytes(),
    BASE64.encode(&[0; 33]).into_bytes(),
    vec![b'A'; 1000],
  ] {
    let mut keys = adapter();
    let id = identity();
    let (service, account) = keys.selector(&id).unwrap();
    keys
      .backend
      .entries
      .insert((service.to_owned(), account), Zeroizing::new(bytes));
    assert_eq!(keys.get(&id).err(), Some(Error::CredentialMalformed));
    assert_eq!(keys.set(&id, &[0; 32]), Err(Error::CredentialMalformed));
    assert_eq!(keys.backend.writes, 0);
    keys.remove(&id).unwrap();
  }
}

#[test]
fn writes_require_exact_readback() {
  for discard in [false, true] {
    let mut keys = adapter();
    keys.backend.corrupt_write = !discard;
    keys.backend.discard_write = discard;
    assert_eq!(
      keys.set(&identity(), &[0; 32]),
      Err(Error::CredentialMalformed)
    );
  }
}

#[test]
fn selectors_isolate_build_vault_and_key_generation() {
  let mut keys = adapter();
  let id = identity();
  keys.set(&id, &[3; 32]).unwrap();
  let mut other = id.clone();
  other.key_generation = [4; 16];
  assert!(keys.get(&other).unwrap().is_none());
  other.vault_id = [5; 16];
  assert!(keys.get(&other).unwrap().is_none());
  keys.development = false;
  assert!(keys.get(&id).unwrap().is_none());
  let mut password = id;
  password.credential = false;
  assert_eq!(keys.get(&password).err(), Some(Error::IdentityMismatch));
  assert_eq!(keys.remove(&password), Err(Error::IdentityMismatch));
  assert_eq!(keys.backend.entries.len(), 1);
}

#[test]
fn windows_policy_pins_local_not_enterprise_persistence() {
  assert_eq!(windows_modifiers().get("persistence"), Some(&"Local"));
}

#[cfg(windows)]
#[test]
fn windows_native_entry_accepts_the_explicit_local_modifier() {
  let backend = NativeBackend::new().unwrap();
  backend
    .entry("tauthy-dev.local-vault.v1", "test-account")
    .unwrap();
  // Cred is private in this dependency. Do not downcast through its internals.
  // The pure policy test pins Local; the opt-in native round trip exercises
  // read()'s persistence attribute check on the actual saved credential.
}

#[test]
#[cfg(unix)]
fn coordinator_uses_adapter_for_creation_rotation_and_deletion() {
  use crate::vault_file::{Records, Vault};
  use crate::vault_transaction::Coordinator;
  let directory = tempfile::tempdir().unwrap();
  let mut records = Records::default();
  records.insert(b"unknown".to_vec(), vec![1, 2, 3]);
  let vault = Vault::create(records, None).unwrap();
  let rotated = vault.rotate(None).unwrap();
  let mut keys = adapter();
  let mut hook = |_| Ok(());
  let mut source = |_: &std::path::Path, _: &str| Ok(Records::default());
  let mut c = Coordinator::new(directory.path(), &mut keys, &mut hook);
  c.begin_create(&vault).unwrap();
  let opened = c.resume(None, &mut source).unwrap();
  assert!(opened.records.same_as(&vault.records));
  c.begin_rotation(&opened, &rotated).unwrap();
  let opened = c.resume_change(None, None).unwrap();
  assert!(opened.records.same_as(&vault.records));
  c.begin_delete(true).unwrap();
  drop(c);
  assert!(keys.backend.entries.is_empty());
  assert_eq!(keys.backend.writes, 2);
}

#[cfg(target_os = "macos")]
#[test]
fn macos_backend_is_explicit_login_keychain_and_maps_authorization_errors() {
  let backend = NativeBackend::new().unwrap();
  let entry = backend.entry("test-service", "test-account").unwrap();
  let credential = entry
    .as_any()
    .downcast_ref::<apple_native_keyring_store::keychain::Cred>()
    .unwrap();
  assert_eq!(
    credential.domain,
    apple_native_keyring_store::keychain::MacKeychainDomain::User
  );
  for code in [-128, -61, -25293, -25308, -25244, -25292] {
    let error = keyring_core::Error::PlatformFailure(Box::new(
      security_framework::base::Error::from_code(code),
    ));
    assert_eq!(keyring_error(error), BackendError::Denied);
  }
  let error = keyring_core::Error::NoStorageAccess(Box::new(
    security_framework::base::Error::from_code(-25291),
  ));
  assert_eq!(keyring_error(error), BackendError::Unavailable);
  assert_eq!(
    keyring_error(keyring_core::Error::NoEntry),
    BackendError::Missing
  );
}

// Opt-in: creates/removes only fresh random IDs in the DEVELOPMENT namespace.
// Ordinary unit tests never touch an OS keychain or show authorization prompts.
#[test]
#[ignore = "requires an unlocked native credential store"]
fn native_backend_round_trip_and_reopen() {
  use ring::rand::{SecureRandom, SystemRandom};
  let mut id = identity();
  SystemRandom::new().fill(&mut id.vault_id).unwrap();
  SystemRandom::new().fill(&mut id.key_generation).unwrap();
  let mut keys = PlatformCredentials {
    backend: NativeBackend::new().unwrap(),
    development: true,
  };
  assert!(keys.get(&id).unwrap().is_none());
  struct Cleanup(Identity);
  impl Drop for Cleanup {
    fn drop(&mut self) {
      if let Ok(backend) = NativeBackend::new() {
        let _ = PlatformCredentials {
          backend,
          development: true,
        }
        .remove(&self.0);
      }
    }
  }
  let _cleanup = Cleanup(id.clone());
  keys.set(&id, &[37; 32]).unwrap();
  drop(keys);
  let mut keys = PlatformCredentials {
    backend: NativeBackend::new().unwrap(),
    development: true,
  };
  assert_eq!(*keys.get(&id).unwrap().unwrap(), [37; 32]);
  assert_eq!(keys.set(&id, &[38; 32]), Err(Error::Conflict));
  keys.remove(&id).unwrap();
  assert!(keys.get(&id).unwrap().is_none());
}
