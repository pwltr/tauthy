//! Persistent Secret Service only. No kernel keyring, plaintext or session fallback.
use super::*;
use dbus_secret_service::{EncryptionType, Item, SecretService};
use std::collections::HashMap;

pub(crate) struct NativeBackend;

fn service_error(error: dbus_secret_service::Error) -> BackendError {
  match error {
    dbus_secret_service::Error::Locked | dbus_secret_service::Error::Prompt => BackendError::Denied,
    _ => BackendError::Unavailable,
  }
}

fn connect() -> Result<SecretService, BackendError> {
  // Encrypt even local D-Bus traffic; bounded prompts, no indefinite UI waits.
  SecretService::connect_with_max_prompt_timeout(EncryptionType::Dh, 30).map_err(service_error)
}

fn attributes<'a>(service: &'a str, account: &'a str) -> HashMap<&'a str, &'a str> {
  HashMap::from([("service", service), ("username", account)])
}

fn item<'a>(
  store: &'a SecretService,
  service: &str,
  account: &str,
) -> Result<Item<'a>, BackendError> {
  let result = store
    .search_items(attributes(service, account))
    .map_err(service_error)?;
  let mut items = result.unlocked.into_iter().chain(result.locked);
  let item = items.next().ok_or(BackendError::Missing)?;
  if items.next().is_some() {
    return Err(BackendError::Conflict);
  }
  item.ensure_unlocked().map_err(service_error)?;
  Ok(item)
}

impl NativeBackend {
  pub(super) fn new() -> Result<Self, BackendError> {
    Ok(Self)
  }
}

impl Backend for NativeBackend {
  fn read(&mut self, service: &str, account: &str) -> Result<Zeroizing<Vec<u8>>, BackendError> {
    let store = connect()?;
    Ok(Zeroizing::new(
      item(&store, service, account)?
        .get_secret()
        .map_err(service_error)?,
    ))
  }
  fn write(&mut self, service: &str, account: &str, secret: &[u8]) -> Result<(), BackendError> {
    let store = connect()?;
    match item(&store, service, account) {
      Err(BackendError::Missing) => {}
      Err(error) => return Err(error),
      Ok(_) => return Err(BackendError::Conflict),
    }
    let collection = store.get_default_collection().map_err(service_error)?;
    collection.ensure_unlocked().map_err(service_error)?;
    collection
      .create_item(
        "Tauthy local vault key",
        attributes(service, account),
        secret,
        false,
        "text/plain",
      )
      .map_err(service_error)?;
    Ok(())
  }
  fn delete(&mut self, service: &str, account: &str) -> Result<(), BackendError> {
    let store = connect()?;
    item(&store, service, account)?
      .delete()
      .map_err(service_error)
  }
}
