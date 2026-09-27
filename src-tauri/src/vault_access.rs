//! Backend-independent, serialized record scopes for sync and tray. File-vault
//! batches commit once after a successful scope; no partial accounts/config save.
use std::cell::RefCell;
use zeroize::Zeroizing;

use crate::{
  legacy_vault,
  vault_file::Records,
  vault_runtime::{Runtime, Update},
};

pub(crate) type RecordUpdate<'a> = (&'a [u8], Option<Vec<u8>>);

pub(crate) trait RecordAccess {
  fn get_record(&self, name: &[u8]) -> Result<Option<Vec<u8>>, String>;
  /// File-backed scopes queue these writes; durability is reported by the
  /// enclosing with_records result. Callers must not acknowledge inside a scope.
  fn save_records(&self, updates: Vec<RecordUpdate<'_>>) -> Result<(), String>;
}

pub(crate) trait VaultAccess {
  fn with_records<T>(
    &self,
    operation: impl FnOnce(&dyn RecordAccess) -> Result<T, String>,
  ) -> Result<T, String>;
}

impl RecordAccess for legacy_vault::UnlockedVault {
  fn get_record(&self, name: &[u8]) -> Result<Option<Vec<u8>>, String> {
    self.get_record(name)
  }
  fn save_records(&self, updates: Vec<RecordUpdate<'_>>) -> Result<(), String> {
    for (name, value) in updates {
      match value {
        Some(value) => self.put_record(name, value)?,
        None => self.delete_record(name)?,
      }
    }
    self.commit()
  }
}

impl VaultAccess for legacy_vault::VaultState {
  fn with_records<T>(
    &self,
    operation: impl FnOnce(&dyn RecordAccess) -> Result<T, String>,
  ) -> Result<T, String> {
    self.with_unlocked(|vault| operation(vault))
  }
}

#[cfg_attr(not(feature = "file-vault"), allow(dead_code))]
struct FileBatch<'a> {
  records: &'a Records,
  updates: RefCell<Vec<Update>>,
}
impl RecordAccess for FileBatch<'_> {
  fn get_record(&self, name: &[u8]) -> Result<Option<Vec<u8>>, String> {
    if let Some(update) = self
      .updates
      .borrow()
      .iter()
      .rev()
      .find(|update| update.name == name)
    {
      return Ok(update.value.as_ref().map(|value| value.to_vec()));
    }
    Ok(
      self
        .records
        .get(&legacy_vault::store_key_for(name))
        .map(|value| value.to_vec()),
    )
  }
  fn save_records(&self, updates: Vec<RecordUpdate<'_>>) -> Result<(), String> {
    self
      .updates
      .borrow_mut()
      .extend(updates.into_iter().map(|(name, value)| Update {
        name: name.to_vec(),
        value: value.map(Zeroizing::new),
      }));
    Ok(())
  }
}
impl VaultAccess for Runtime {
  fn with_records<T>(
    &self,
    operation: impl FnOnce(&dyn RecordAccess) -> Result<T, String>,
  ) -> Result<T, String> {
    self
      .with_record_batch(|records, updates| {
        let batch = FileBatch {
          records,
          updates: RefCell::new(Vec::new()),
        };
        let result = operation(&batch)?;
        updates.extend(batch.updates.into_inner());
        Ok(result)
      })
      .map_err(|error| match error {
        crate::vault_runtime::BatchError::Operation(error) => error,
        crate::vault_runtime::BatchError::Vault(crate::vault_runtime::Error::Locked) => {
          "vault is locked".into()
        }
        crate::vault_runtime::BatchError::Vault(error) => {
          crate::vault_commands::error_code(&error).into()
        }
      })
  }
}

#[cfg(feature = "file-vault")]
pub(crate) type ApplicationVault = crate::vault_commands::FileVaultState;
#[cfg(not(feature = "file-vault"))]
pub(crate) type ApplicationVault = legacy_vault::VaultState;

pub(crate) fn account_record(state: &impl VaultAccess) -> Result<Option<String>, String> {
  let result = state.with_records(|vault| {
    vault
      .get_record(b"vault")?
      .map(|bytes| String::from_utf8(bytes).map_err(|_| "vaultCorrupt".to_string()))
      .transpose()
  });
  match result {
    Err(error) if error == "vault is locked" => Ok(None),
    result => result,
  }
}

#[cfg(test)]
#[path = "vault_access_tests.rs"]
mod tests;
