//! Explicit device-local credential storage; not yet connected to app commands.
//! Calls must run off the UI thread, serialized by the vault mutex. Native APIs
//! may update an existing entry, so the checked set is not an OS-level CAS.
//! No process-global default store, enumeration, key cache or fallback backend.
use data_encoding::BASE64;
#[cfg(any(target_os = "macos", windows))]
use zeroize::Zeroize;
use zeroize::Zeroizing;

use crate::{
  vault_journal::Identity,
  vault_transaction::{Credentials, Error},
};

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum BackendError {
  Missing,
  Denied,
  Unavailable,
  Malformed,
  Conflict,
}

pub(crate) trait Backend {
  fn read(&mut self, service: &str, account: &str) -> Result<Zeroizing<Vec<u8>>, BackendError>;
  fn write(&mut self, service: &str, account: &str, secret: &[u8]) -> Result<(), BackendError>;
  fn delete(&mut self, service: &str, account: &str) -> Result<(), BackendError>;
}

fn map_error(error: BackendError) -> Error {
  match error {
    BackendError::Missing => Error::CredentialMissing,
    BackendError::Denied => Error::CredentialAccessDenied,
    BackendError::Unavailable => Error::CredentialUnavailable,
    BackendError::Malformed => Error::CredentialMalformed,
    BackendError::Conflict => Error::Conflict,
  }
}

pub(crate) struct PlatformCredentials<B = NativeBackend> {
  backend: B,
  development: bool,
}

impl PlatformCredentials<NativeBackend> {
  pub(crate) fn new() -> Result<Self, Error> {
    Ok(Self {
      backend: NativeBackend::new().map_err(map_error)?,
      development: cfg!(debug_assertions),
    })
  }
}

impl<B: Backend> PlatformCredentials<B> {
  fn selector(&self, identity: &Identity) -> Result<(&'static str, String), Error> {
    identity
      .credential_selector(self.development)
      .ok_or(Error::IdentityMismatch)
  }
}

impl<B: Backend> Credentials for PlatformCredentials<B> {
  fn get(&mut self, identity: &Identity) -> Result<Option<Zeroizing<[u8; 32]>>, Error> {
    let (service, account) = self.selector(identity)?;
    let secret = match self.backend.read(service, &account) {
      Ok(secret) => secret,
      Err(BackendError::Missing) => return Ok(None),
      Err(error) => return Err(map_error(error)),
    };
    // Canonical padded base64 supports KWallet's text-only Secret Service path.
    // Do not interpret malformed entries as missing or try another generation.
    if secret.len() != 44 {
      return Err(Error::CredentialMalformed);
    }
    let bytes = Zeroizing::new(
      BASE64
        .decode(&secret)
        .map_err(|_| Error::CredentialMalformed)?,
    );
    if bytes.len() != 32 {
      return Err(Error::CredentialMalformed);
    }
    let mut key = Zeroizing::new([0; 32]);
    key.copy_from_slice(&bytes);
    let canonical = Zeroizing::new(BASE64.encode(key.as_ref()));
    if canonical.as_bytes() != secret.as_slice() {
      return Err(Error::CredentialMalformed);
    }
    Ok(Some(key))
  }

  fn set(&mut self, identity: &Identity, key: &[u8; 32]) -> Result<(), Error> {
    if let Some(existing) = self.get(identity)? {
      return if existing.as_ref() == key {
        Ok(())
      } else {
        Err(Error::Conflict)
      };
    }
    let (service, account) = self.selector(identity)?;
    let secret = Zeroizing::new(BASE64.encode(key));
    self
      .backend
      .write(service, &account, secret.as_bytes())
      .map_err(map_error)?;
    if self.get(identity)?.as_deref() != Some(key) {
      return Err(Error::CredentialMalformed);
    }
    Ok(())
  }

  fn remove(&mut self, identity: &Identity) -> Result<(), Error> {
    let (service, account) = self.selector(identity)?;
    match self.backend.delete(service, &account) {
      Ok(()) | Err(BackendError::Missing) => Ok(()),
      Err(error) => Err(map_error(error)),
    }
  }
}

// Kept explicit (including in tests), rather than relying on roaming defaults.
fn windows_modifiers() -> std::collections::HashMap<&'static str, &'static str> {
  std::collections::HashMap::from([("persistence", "Local")])
}

#[cfg(any(target_os = "macos", windows))]
pub(crate) struct NativeBackend {
  store: std::sync::Arc<keyring_core::CredentialStore>,
}

#[cfg(any(target_os = "macos", windows))]
fn keyring_error(mut error: keyring_core::Error) -> BackendError {
  // Native adapters sometimes classify authorization failures as generic errors.
  #[cfg(target_os = "macos")]
  if let keyring_core::Error::PlatformFailure(ref error)
  | keyring_core::Error::NoStorageAccess(ref error) = error
  {
    if let Some(status) = error.downcast_ref::<security_framework::base::Error>() {
      return match status.code() {
        -128 | -61 | -25293 | -25308 | -25244 | -25292 => BackendError::Denied,
        _ => BackendError::Unavailable,
      };
    }
  }
  match &mut error {
    keyring_core::Error::NoEntry => BackendError::Missing,
    keyring_core::Error::NoStorageAccess(_) => BackendError::Denied,
    keyring_core::Error::Ambiguous(_) => BackendError::Conflict,
    keyring_core::Error::BadEncoding(bytes) | keyring_core::Error::BadDataFormat(bytes, _) => {
      bytes.zeroize();
      BackendError::Malformed
    }
    _ => BackendError::Unavailable,
  }
}

#[cfg(any(target_os = "macos", windows))]
impl NativeBackend {
  fn new() -> Result<Self, BackendError> {
    #[cfg(target_os = "macos")]
    let store = apple_native_keyring_store::keychain::Store::new_with_configuration(
      &std::collections::HashMap::from([("keychain", "User")]),
    )
    .map_err(keyring_error)?;
    #[cfg(windows)]
    let store = windows_native_keyring_store::Store::new().map_err(keyring_error)?;
    Ok(Self { store })
  }

  fn entry(&self, service: &str, account: &str) -> Result<keyring_core::Entry, BackendError> {
    #[cfg(windows)]
    let modifiers = Some(windows_modifiers());
    #[cfg(target_os = "macos")]
    let modifiers = None;
    self
      .store
      .build(service, account, modifiers.as_ref())
      .map_err(keyring_error)
  }
}

#[cfg(any(target_os = "macos", windows))]
impl Backend for NativeBackend {
  fn read(&mut self, service: &str, account: &str) -> Result<Zeroizing<Vec<u8>>, BackendError> {
    let entry = self.entry(service, account)?;
    let secret = Zeroizing::new(entry.get_secret().map_err(keyring_error)?);
    #[cfg(windows)]
    if entry
      .get_attributes()
      .map_err(keyring_error)?
      .get("persistence")
      .map(String::as_str)
      != Some("Local")
    {
      return Err(BackendError::Conflict);
    }
    Ok(secret)
  }
  fn write(&mut self, service: &str, account: &str, secret: &[u8]) -> Result<(), BackendError> {
    self
      .entry(service, account)?
      .set_secret(secret)
      .map_err(keyring_error)
  }
  fn delete(&mut self, service: &str, account: &str) -> Result<(), BackendError> {
    self
      .entry(service, account)?
      .delete_credential()
      .map_err(keyring_error)
  }
}

#[cfg(target_os = "linux")]
#[path = "vault_credentials_linux.rs"]
mod linux;
#[cfg(target_os = "linux")]
pub(crate) use linux::NativeBackend;

#[cfg(not(any(target_os = "macos", windows, target_os = "linux")))]
pub(crate) struct NativeBackend;
#[cfg(not(any(target_os = "macos", windows, target_os = "linux")))]
impl NativeBackend {
  fn new() -> Result<Self, BackendError> {
    Err(BackendError::Unavailable)
  }
}
#[cfg(not(any(target_os = "macos", windows, target_os = "linux")))]
impl Backend for NativeBackend {
  fn read(&mut self, _: &str, _: &str) -> Result<Zeroizing<Vec<u8>>, BackendError> {
    Err(BackendError::Unavailable)
  }
  fn write(&mut self, _: &str, _: &str, _: &[u8]) -> Result<(), BackendError> {
    Err(BackendError::Unavailable)
  }
  fn delete(&mut self, _: &str, _: &str) -> Result<(), BackendError> {
    Err(BackendError::Unavailable)
  }
}

#[cfg(test)]
#[path = "vault_credentials_tests.rs"]
mod tests;
