use super::*;
use crate::{
  vault_file::{Records, Vault},
  vault_runtime::Error as RuntimeError,
  vault_transaction::Error as TxError,
};
use std::fs;

#[test]
fn typed_errors_do_not_confuse_authentication_foreign_identity_or_cleanup() {
  let cases = [
    (RuntimeError::Locked, "vaultLocked"),
    (RuntimeError::CreationRequired, "vaultCreationRequired"),
    (RuntimeError::MigrationRequired, "vaultMigrationRequired"),
    (
      RuntimeError::Transaction(TxError::Envelope(vault_file::Error::Authentication)),
      "vaultAuthenticationFailed",
    ),
    (
      RuntimeError::Metadata(vault_metadata::Error::IdentityMismatch),
      "vaultIdentityMismatch",
    ),
    (
      RuntimeError::Transaction(TxError::StagedCleanupFailed(Box::new(TxError::Envelope(
        vault_file::Error::Corrupt,
      )))),
      "vaultStagedCleanupFailed",
    ),
    (
      RuntimeError::Transaction(TxError::LegacyCopyCleanupFailed),
      "vaultLegacyCopyCleanupFailed",
    ),
    (
      RuntimeError::Transaction(TxError::Journal(vault_journal::Error::Unsupported)),
      "vaultUnsupportedDurability",
    ),
    (
      RuntimeError::Transaction(TxError::CredentialAccessDenied),
      "vaultCredentialAccessDenied",
    ),
    (
      RuntimeError::Transaction(TxError::CredentialUnavailable),
      "vaultCredentialUnavailable",
    ),
    (
      RuntimeError::Transaction(TxError::NeedsPreparation),
      "vaultNeedsPreparation",
    ),
  ];
  for (error, code) in cases {
    assert_eq!(
      serde_json::to_value(CommandError::from(error)).unwrap(),
      serde_json::json!({"code":code})
    );
  }
}

#[test]
fn password_flow_never_initializes_the_native_credential_adapter() {
  let directory = tempfile::tempdir().unwrap();
  let runtime = Runtime::new(directory.path().into());
  let mut credentials = LazyCredentials::default();
  runtime.create(Some("old"), &mut credentials).unwrap();
  runtime
    .save(vec![Update {
      name: b"vault".to_vec(),
      value: Some(Zeroizing::new(b"[]".to_vec())),
    }])
    .unwrap();
  runtime.lock().unwrap();
  runtime
    .unlock_current(Some("old"), None, &mut credentials)
    .unwrap();
  runtime
    .change_password(Some("old"), Some("new"), true, &mut credentials)
    .unwrap();
  runtime.delete(true, &mut credentials).unwrap();
  assert!(credentials.0.is_none());
}

#[test]
fn status_is_read_only_and_exposes_only_prompt_hints_and_runtime_lock_state() {
  let directory = tempfile::tempdir().unwrap();
  let runtime = Runtime::new(directory.path().into());
  let fresh = serde_json::to_value(status_at(&runtime).unwrap()).unwrap();
  assert_eq!(fresh["lifecycle"], "new");
  assert_eq!(fresh["status"], "locked");
  assert_eq!(fresh["protectionHint"], serde_json::Value::Null);
  assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 0);
  runtime
    .create(Some("password"), &mut LazyCredentials::default())
    .unwrap();
  let before = fs::read(directory.path().join("vault.tauthy")).unwrap();
  let unlocked = serde_json::to_value(status_at(&runtime).unwrap()).unwrap();
  assert_eq!(unlocked["status"], "unlocked");
  assert_eq!(unlocked["backend"], "fileV1");
  assert_eq!(unlocked["protectionHint"], "password");
  assert_eq!(unlocked["migrationDeferred"], serde_json::Value::Null);
  assert!(!unlocked.as_object().unwrap().contains_key("identityHint"));
  assert!(!unlocked.as_object().unwrap().contains_key("key"));
  runtime.lock().unwrap();
  let restarted = Runtime::new(directory.path().into());
  let locked = serde_json::to_value(status_at(&restarted).unwrap()).unwrap();
  assert_eq!(locked["status"], "locked");
  assert_eq!(
    fs::read(directory.path().join("vault.tauthy")).unwrap(),
    before
  );
}

#[test]
fn foreign_reader_authenticates_without_mutating_source_or_guessing_credentials() {
  let directory = tempfile::tempdir().unwrap();
  let path = directory.path().join("foreign.tauthy");
  let mut records = Records::default();
  records.insert(vec![255, 0], vec![11, 255]);
  let foreign = Vault::create(records, Some("password")).unwrap();
  let bytes = foreign.seal().unwrap();
  fs::write(&path, &bytes).unwrap();
  assert_eq!(
    read_foreign(&path, "wrong").err(),
    Some(CommandError {
      code: "vaultAuthenticationFailed"
    })
  );
  assert!(read_foreign(&path, "password")
    .unwrap()
    .records
    .same_as(&foreign.records));
  assert_eq!(fs::read(&path).unwrap(), bytes);
  let credential = Vault::create(Records::default(), None).unwrap();
  fs::write(&path, credential.seal().unwrap()).unwrap();
  assert_eq!(
    read_foreign(&path, "").err(),
    Some(CommandError {
      code: "vaultForeignCredentialRequired"
    })
  );
  assert_eq!(
    read_foreign(directory.path(), "password").err(),
    Some(CommandError {
      code: "vaultReconciliationFailed"
    })
  );
}

#[cfg(unix)]
#[test]
fn foreign_reader_rejects_symlinks_before_opening_target() {
  let directory = tempfile::tempdir().unwrap();
  let source = directory.path().join("source.tauthy");
  let link = directory.path().join("link.tauthy");
  fs::write(
    &source,
    Vault::create(Records::default(), Some("password"))
      .unwrap()
      .seal()
      .unwrap(),
  )
  .unwrap();
  std::os::unix::fs::symlink(&source, &link).unwrap();
  assert_eq!(
    read_foreign(&link, "password").err(),
    Some(CommandError {
      code: "vaultReconciliationFailed"
    })
  );
}
