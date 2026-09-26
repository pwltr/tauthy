use super::*;
use std::{collections::HashMap, fs};

#[test]
fn unsupported_cleanup_is_not_a_reconciliation_failure() {
  assert_eq!(
    cleanup_error(std::io::ErrorKind::Unsupported.into()),
    TxError::Journal(vault_journal::Error::Unsupported)
  );
  for kind in [
    std::io::ErrorKind::InvalidData,
    std::io::ErrorKind::PermissionDenied,
  ] {
    assert_eq!(cleanup_error(kind.into()), TxError::ReconciliationFailed);
  }
}

#[derive(Default)]
struct Keys {
  entries: HashMap<String, Zeroizing<[u8; 32]>>,
  unavailable: bool,
  denied: bool,
}
impl Keys {
  fn check(&self) -> Result<(), TxError> {
    if self.unavailable {
      Err(TxError::CredentialUnavailable)
    } else if self.denied {
      Err(TxError::CredentialAccessDenied)
    } else {
      Ok(())
    }
  }
}
impl Credentials for Keys {
  fn get(&mut self, id: &Identity) -> Result<Option<Zeroizing<[u8; 32]>>, TxError> {
    self.check()?;
    Ok(
      self
        .entries
        .get(&id.credential_selector(true).unwrap().1)
        .map(|key| Zeroizing::new(**key)),
    )
  }
  fn set(&mut self, id: &Identity, key: &[u8; 32]) -> Result<(), TxError> {
    self.check()?;
    let selector = id.credential_selector(true).unwrap().1;
    if self.entries.contains_key(&selector) {
      return Err(TxError::Conflict);
    }
    self.entries.insert(selector, Zeroizing::new(*key));
    Ok(())
  }
  fn remove(&mut self, id: &Identity) -> Result<(), TxError> {
    self.check()?;
    self
      .entries
      .remove(&id.credential_selector(true).unwrap().1);
    Ok(())
  }
}

fn put(name: &[u8], value: &[u8]) -> Update {
  Update {
    name: name.to_vec(),
    value: Some(Zeroizing::new(value.to_vec())),
  }
}

fn open(runtime: &Runtime, keys: &mut Keys, password: Option<&str>) {
  runtime
    .unlock(password, None, keys, &mut no_source)
    .unwrap();
}

#[test]
fn locked_new_runtime_never_creates_or_exposes_records_implicitly() {
  let directory = tempfile::tempdir().unwrap();
  let runtime = Runtime::new(directory.path().into());
  let mut keys = Keys::default();
  assert!(runtime.status().unwrap().locked);
  assert_eq!(runtime.get(b"vault"), Err(Error::Locked));
  assert_eq!(runtime.save(vec![put(b"vault", b"[]")]), Err(Error::Locked));
  assert_eq!(
    runtime.unlock(None, None, &mut keys, &mut no_source),
    Err(Error::CreationRequired)
  );
  assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 0);
  assert!(keys.entries.is_empty());
}

#[test]
fn saves_rotate_nonce_but_keep_identity_wrapping_and_all_opaque_records() {
  let directory = tempfile::tempdir().unwrap();
  let runtime = Runtime::new(directory.path().into());
  let mut keys = Keys::default();
  let mut records = Records::default();
  records.insert(vec![255, 0, 13], vec![0, 255, 1]);
  records.insert(store_key_for(b"vault"), b"old".to_vec());
  let vault = Vault::create(records, None).unwrap();
  let mut hook = no_failure;
  let mut coordinator = Coordinator::new(directory.path(), &mut keys, &mut hook);
  coordinator.begin_create(&vault).unwrap();
  coordinator.resume(None, &mut no_source).unwrap();
  open(&runtime, &mut keys, None);
  let active = directory.path().join("vault.tauthy");
  let before = fs::read(&active).unwrap();
  let journal = fs::read(directory.path().join("vault.transaction.json")).unwrap();
  runtime
    .save(vec![
      put(b"vault", b"new"),
      put(b"sync-config-v1", &[0, 255]),
      put(b"empty", b""),
    ])
    .unwrap();
  let after = fs::read(&active).unwrap();
  assert_eq!(&before[..43], &after[..43]);
  assert_eq!(&before[67..155], &after[67..155]);
  assert_ne!(&before[43..67], &after[43..67]);
  assert_eq!(
    fs::read(directory.path().join("vault.transaction.json")).unwrap(),
    journal
  );
  let opened = Envelope::read(after.as_slice())
    .unwrap()
    .unlock_credential(Some(*vault.credential_key()))
    .unwrap();
  assert_eq!(
    opened.records.get(&[255, 0, 13]),
    Some([0, 255, 1].as_slice())
  );
  assert_eq!(runtime.get(b"sync-config-v1").unwrap(), Some(vec![0, 255]));
  assert_eq!(runtime.get(b"empty").unwrap(), Some(vec![]));
  assert_eq!(runtime.get(b"absent").unwrap(), None);
  runtime
    .save(vec![Update {
      name: b"empty".to_vec(),
      value: None,
    }])
    .unwrap();
  assert_eq!(runtime.get(b"empty").unwrap(), None);
  runtime.lock().unwrap();
  assert_eq!(runtime.get(b"vault"), Err(Error::Locked));
  open(&runtime, &mut keys, None);
  assert_eq!(runtime.get(b"vault").unwrap(), Some(b"new".to_vec()));
}

#[test]
fn password_saves_need_no_password_cache_and_wrong_unlock_changes_nothing() {
  let directory = tempfile::tempdir().unwrap();
  let runtime = Runtime::new(directory.path().into());
  let mut keys = Keys::default();
  runtime.create(Some("four"), &mut keys).unwrap();
  let before = fs::read(directory.path().join("vault.tauthy")).unwrap();
  runtime
    .save(vec![put(b"vault", b"password vault")])
    .unwrap();
  let after = fs::read(directory.path().join("vault.tauthy")).unwrap();
  assert_eq!(&before[..43], &after[..43]);
  assert_eq!(&before[67..155], &after[67..155]);
  assert!(keys.entries.is_empty());
  runtime.lock().unwrap();
  let journal = fs::read(directory.path().join("vault.transaction.json")).unwrap();
  assert_eq!(
    runtime.unlock(Some("wrong"), None, &mut keys, &mut no_source),
    Err(Error::Transaction(TxError::Envelope(
      crate::vault_file::Error::Authentication
    )))
  );
  assert_eq!(
    fs::read(directory.path().join("vault.tauthy")).unwrap(),
    after
  );
  assert_eq!(
    fs::read(directory.path().join("vault.transaction.json")).unwrap(),
    journal
  );
  assert_eq!(runtime.get(b"vault"), Err(Error::Locked));
  open(&runtime, &mut keys, Some("four"));
  assert_eq!(
    runtime.get(b"vault").unwrap(),
    Some(b"password vault".to_vec())
  );
}

#[test]
fn no_edits_or_stale_reads_during_a_transaction_or_after_external_replacement() {
  let directory = tempfile::tempdir().unwrap();
  let runtime = Runtime::new(directory.path().into());
  let mut keys = Keys::default();
  runtime.create(None, &mut keys).unwrap();
  let before = fs::read(directory.path().join("vault.tauthy")).unwrap();
  let mut journal = vault_journal::read(directory.path()).unwrap().unwrap();
  journal.phase = Phase::InstallIntent;
  vault_journal::persist(directory.path(), &journal).unwrap();
  assert_eq!(
    runtime.get(b"vault"),
    Err(Error::Transaction(TxError::ReconciliationFailed))
  );
  assert_eq!(
    runtime.save(vec![put(b"vault", b"must not save")]),
    Err(Error::Transaction(TxError::ReconciliationFailed))
  );
  assert_eq!(
    fs::read(directory.path().join("vault.tauthy")).unwrap(),
    before
  );
  journal.phase = Phase::Completed;
  vault_journal::persist(directory.path(), &journal).unwrap();
  open(&runtime, &mut keys, None);
  let key = keys.entries.values().next().unwrap();
  let mut external = Envelope::read(before.as_slice())
    .unwrap()
    .unlock_credential(Some(**key))
    .unwrap();
  external
    .records
    .insert(store_key_for(b"vault"), b"external edit".to_vec());
  let external_bytes = external.seal().unwrap();
  fs::write(directory.path().join("vault.tauthy"), &external_bytes).unwrap();
  assert_eq!(
    runtime.save(vec![put(b"vault", b"stale edit")]),
    Err(Error::Transaction(TxError::SourceChanged))
  );
  assert_eq!(
    fs::read(directory.path().join("vault.tauthy")).unwrap(),
    external_bytes
  );
  assert!(runtime.status().unwrap().locked);
}

#[test]
fn save_fault_matrix_reopens_only_complete_old_or_new_records() {
  let points = [
    "beforeSaveWrite",
    "afterSaveWrite",
    "beforeSaveFlush",
    "afterSaveFlush",
    "beforeSaveVerify",
    "afterSaveVerify",
    "beforeSaveReplace",
    "afterSaveReplace",
    "beforeSaveActiveVerify",
    "afterSaveActiveVerify",
  ];
  for fail_at in points {
    let directory = tempfile::tempdir().unwrap();
    let runtime = Runtime::new(directory.path().into());
    let mut keys = Keys::default();
    runtime.create(None, &mut keys).unwrap();
    runtime
      .save(vec![
        put(b"vault", b"old"),
        put(b"sync-config-v1", b"old sync"),
      ])
      .unwrap();
    let journal = fs::read(directory.path().join("vault.transaction.json")).unwrap();
    let mut hook = |point| {
      if point == fail_at {
        Err(TxError::Interrupted)
      } else {
        Ok(())
      }
    };
    assert_eq!(
      runtime.save_with(
        vec![put(b"vault", b"new"), put(b"sync-config-v1", b"new sync")],
        &mut hook
      ),
      Err(Error::Transaction(TxError::Interrupted))
    );
    assert!(runtime.status().unwrap().locked);
    assert_eq!(
      fs::read(directory.path().join("vault.transaction.json")).unwrap(),
      journal
    );
    let reopened = Runtime::new(directory.path().into());
    open(&reopened, &mut keys, None);
    match reopened.get(b"vault").unwrap().unwrap().as_slice() {
      b"old" => assert_eq!(
        reopened.get(b"sync-config-v1").unwrap(),
        Some(b"old sync".to_vec())
      ),
      b"new" => assert_eq!(
        reopened.get(b"sync-config-v1").unwrap(),
        Some(b"new sync".to_vec())
      ),
      _ => panic!("partial or corrupt save at {fail_at}"),
    }
    assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 2);
  }
}

#[test]
fn migration_deferral_is_a_runtime_result_not_a_phase_guess() {
  let directory = tempfile::tempdir().unwrap();
  fs::write(directory.path().join("vault.stronghold"), b"PARTI\x03\x00").unwrap();
  let runtime = Runtime::new(directory.path().into());
  let mut keys = Keys {
    unavailable: true,
    ..Keys::default()
  };
  let mut reader = |_: &Path, _: &str| Ok(Records::default());
  assert_eq!(
    runtime.migrate("", &mut keys, &mut reader),
    Err(Error::Transaction(TxError::CredentialUnavailable))
  );
  let status = runtime.status().unwrap();
  assert_eq!(status.metadata.lifecycle, Lifecycle::LegacyMigrationPending);
  assert_eq!(
    status.migration_deferred,
    Some(Deferred::CredentialUnavailable)
  );
  assert!(status.locked);
  assert_eq!(
    Runtime::new(directory.path().into())
      .status()
      .unwrap()
      .migration_deferred,
    None
  );
  keys.unavailable = false;
  keys.denied = true;
  assert_eq!(
    runtime.unlock(None, None, &mut keys, &mut reader),
    Err(Error::Transaction(TxError::CredentialAccessDenied))
  );
  assert_eq!(
    runtime.status().unwrap().migration_deferred,
    Some(Deferred::CredentialAccessDenied)
  );
  keys.denied = false;
  runtime.unlock(None, None, &mut keys, &mut reader).unwrap();
  assert_eq!(
    runtime.status().unwrap().metadata.lifecycle,
    Lifecycle::Active
  );
  assert_eq!(runtime.status().unwrap().migration_deferred, None);
  assert_eq!(
    fs::read(directory.path().join("vault.stronghold.retired")).unwrap(),
    b"PARTI\x03\x00"
  );
}

#[test]
fn confirmed_delete_revokes_session_and_only_explicit_creation_can_restart() {
  let directory = tempfile::tempdir().unwrap();
  let runtime = Runtime::new(directory.path().into());
  let mut keys = Keys::default();
  runtime.create(None, &mut keys).unwrap();
  runtime.save(vec![put(b"vault", b"old")]).unwrap();
  assert_eq!(
    runtime.delete(false, &mut keys),
    Err(Error::Transaction(TxError::ConfirmationRequired))
  );
  assert_eq!(runtime.get(b"vault").unwrap(), Some(b"old".to_vec()));
  runtime.delete(true, &mut keys).unwrap();
  assert_eq!(runtime.get(b"vault"), Err(Error::Locked));
  assert_eq!(
    runtime.status().unwrap().metadata.lifecycle,
    Lifecycle::Deleted
  );
  assert!(keys.entries.is_empty());
  assert!(runtime
    .unlock(None, None, &mut keys, &mut no_source)
    .is_err());
  runtime.create(None, &mut keys).unwrap();
  assert_eq!(runtime.get(b"vault").unwrap(), None);
}

#[test]
fn credential_missing_or_denied_never_uses_a_password_or_legacy_fallback() {
  let directory = tempfile::tempdir().unwrap();
  let runtime = Runtime::new(directory.path().into());
  let mut keys = Keys::default();
  runtime.create(None, &mut keys).unwrap();
  runtime.lock().unwrap();
  let before = fs::read(directory.path().join("vault.tauthy")).unwrap();
  keys.denied = true;
  assert_eq!(
    runtime.unlock(Some("anything"), None, &mut keys, &mut no_source),
    Err(Error::Transaction(TxError::CredentialAccessDenied))
  );
  keys.denied = false;
  keys.entries.clear();
  assert_eq!(
    runtime.unlock(Some("anything"), None, &mut keys, &mut no_source),
    Err(Error::Transaction(TxError::CredentialMissing))
  );
  assert_eq!(
    fs::read(directory.path().join("vault.tauthy")).unwrap(),
    before
  );
  assert_eq!(runtime.get(b"vault"), Err(Error::Locked));
}

#[test]
fn oversized_save_keeps_disk_unchanged_and_requires_reunlock() {
  let directory = tempfile::tempdir().unwrap();
  let runtime = Runtime::new(directory.path().into());
  let mut keys = Keys::default();
  runtime.create(None, &mut keys).unwrap();
  runtime.save(vec![put(b"vault", b"old")]).unwrap();
  let before = fs::read(directory.path().join("vault.tauthy")).unwrap();
  let update = Update {
    name: b"vault".to_vec(),
    value: Some(Zeroizing::new(vec![0; 64 * 1024 * 1024])),
  };
  assert_eq!(
    runtime.save(vec![update]),
    Err(Error::Transaction(TxError::Envelope(
      crate::vault_file::Error::TooLarge
    )))
  );
  assert_eq!(
    fs::read(directory.path().join("vault.tauthy")).unwrap(),
    before
  );
  assert!(runtime.status().unwrap().locked);
  open(&runtime, &mut keys, None);
  assert_eq!(runtime.get(b"vault").unwrap(), Some(b"old".to_vec()));
}

#[test]
fn rotation_recovery_requests_matching_passwords_then_opens_normally() {
  let directory = tempfile::tempdir().unwrap();
  let mut keys = Keys::default();
  let mut records = Records::default();
  records.insert(store_key_for(b"vault"), b"retained".to_vec());
  let source = Vault::create(records, Some("old")).unwrap();
  let target = source.rotate(Some("new")).unwrap();
  let mut hook = no_failure;
  {
    let mut coordinator = Coordinator::new(directory.path(), &mut keys, &mut hook);
    coordinator.begin_create(&source).unwrap();
    coordinator.resume(Some("old"), &mut no_source).unwrap();
  }
  let mut interrupt = |point| {
    if point == "afterStagePersist" {
      Err(TxError::Interrupted)
    } else {
      Ok(())
    }
  };
  assert_eq!(
    Coordinator::new(directory.path(), &mut keys, &mut interrupt).begin_rotation(&source, &target),
    Err(TxError::Interrupted)
  );
  let runtime = Runtime::new(directory.path().into());
  let before: Vec<_> = [
    "vault.tauthy",
    "vault.pending.tauthy",
    "vault.transaction.json",
  ]
  .into_iter()
  .map(|name| (name, fs::read(directory.path().join(name)).unwrap()))
  .collect();
  assert_eq!(
    runtime.unlock(None, Some("new"), &mut keys, &mut no_source),
    Err(Error::Transaction(TxError::PendingUnlock))
  );
  assert_eq!(
    runtime.unlock(Some("old"), Some("wrong"), &mut keys, &mut no_source),
    Err(Error::Transaction(TxError::Envelope(
      crate::vault_file::Error::Authentication
    )))
  );
  for (name, bytes) in before {
    assert_eq!(fs::read(directory.path().join(name)).unwrap(), bytes);
  }
  assert_eq!(runtime.get(b"vault"), Err(Error::Locked));
  runtime
    .unlock(Some("old"), Some("new"), &mut keys, &mut no_source)
    .unwrap();
  assert_eq!(runtime.get(b"vault").unwrap(), Some(b"retained".to_vec()));
  runtime.save(vec![put(b"vault", b"updated")]).unwrap();
  runtime.lock().unwrap();
  open(&runtime, &mut keys, Some("new"));
  assert_eq!(runtime.get(b"vault").unwrap(), Some(b"updated".to_vec()));
}

#[test]
fn unlocked_state_cannot_authorize_recreation_of_a_missing_active_vault() {
  let directory = tempfile::tempdir().unwrap();
  let runtime = Runtime::new(directory.path().into());
  let mut keys = Keys::default();
  runtime.create(None, &mut keys).unwrap();
  fs::remove_file(directory.path().join("vault.tauthy")).unwrap();
  assert_eq!(
    runtime.get(b"vault"),
    Err(Error::Metadata(vault_metadata::Error::MissingVault))
  );
  assert_eq!(
    runtime.save(vec![put(b"vault", b"must not recreate")]),
    Err(Error::Metadata(vault_metadata::Error::MissingVault))
  );
  assert!(!directory.path().join("vault.tauthy").exists());
  runtime.delete(true, &mut keys).unwrap();
  runtime.create(None, &mut keys).unwrap();
}

#[test]
fn simultaneous_batches_are_serialized_and_cannot_lose_each_other() {
  let directory = tempfile::tempdir().unwrap();
  let runtime = Runtime::new(directory.path().into());
  runtime.create(None, &mut Keys::default()).unwrap();
  std::thread::scope(|scope| {
    for name in [b"first".as_slice(), b"second".as_slice()] {
      let runtime = &runtime;
      scope.spawn(move || runtime.save(vec![put(name, name)]).unwrap());
    }
  });
  assert_eq!(runtime.get(b"first").unwrap(), Some(b"first".to_vec()));
  assert_eq!(runtime.get(b"second").unwrap(), Some(b"second".to_vec()));
}

#[test]
fn protection_entry_point_covers_all_modes_and_retains_records() {
  let directory = tempfile::tempdir().unwrap();
  let runtime = Runtime::new(directory.path().into());
  let mut keys = Keys::default();
  runtime.create(None, &mut keys).unwrap();
  runtime
    .save(vec![
      put(b"vault", b"accounts"),
      put(b"sync-config-v1", b"sync"),
    ])
    .unwrap();
  let original = vault_journal::read(directory.path())
    .unwrap()
    .unwrap()
    .target
    .unwrap();
  for (current, next) in [
    (None, Some("first")),
    (Some("first"), Some("second")),
    (Some("second"), None),
    (None, None),
  ] {
    let before = vault_journal::read(directory.path())
      .unwrap()
      .unwrap()
      .target
      .unwrap();
    runtime
      .change_password(current, next, true, &mut keys)
      .unwrap();
    let after = vault_journal::read(directory.path())
      .unwrap()
      .unwrap()
      .target
      .unwrap();
    assert_eq!(original.vault_id, after.vault_id);
    assert_ne!(before.key_generation, after.key_generation);
    assert_eq!(after.credential, next.is_none());
    assert_eq!(keys.entries.len(), usize::from(next.is_none()));
    runtime.lock().unwrap();
    runtime.unlock_current(next, None, &mut keys).unwrap();
    assert_eq!(runtime.get(b"vault").unwrap(), Some(b"accounts".to_vec()));
    assert_eq!(
      runtime.get(b"sync-config-v1").unwrap(),
      Some(b"sync".to_vec())
    );
  }
}

#[test]
fn changes_require_confirmation_and_reauthentication_before_any_effect() {
  let directory = tempfile::tempdir().unwrap();
  let runtime = Runtime::new(directory.path().into());
  let mut keys = Keys::default();
  runtime.create(Some("old"), &mut keys).unwrap();
  let active = fs::read(directory.path().join("vault.tauthy")).unwrap();
  let journal = fs::read(directory.path().join("vault.transaction.json")).unwrap();
  assert_eq!(
    runtime.change_password(Some("old"), None, false, &mut keys),
    Err(TxError::ConfirmationRequired.into())
  );
  assert!(!runtime.status().unwrap().locked);
  assert_eq!(
    runtime.change_password(Some("wrong"), None, true, &mut keys),
    Err(crate::vault_file::Error::Authentication.into())
  );
  assert!(runtime.status().unwrap().locked);
  runtime
    .unlock_current(Some("old"), None, &mut keys)
    .unwrap();
  assert_eq!(
    runtime.change_password(Some("old"), Some(""), true, &mut keys),
    Err(crate::vault_file::Error::EmptyPassword.into())
  );
  assert_eq!(
    fs::read(directory.path().join("vault.tauthy")).unwrap(),
    active
  );
  assert_eq!(
    fs::read(directory.path().join("vault.transaction.json")).unwrap(),
    journal
  );
  assert!(keys.entries.is_empty());
}

#[test]
fn password_removal_failure_preserves_source_and_can_be_resumed() {
  let directory = tempfile::tempdir().unwrap();
  let runtime = Runtime::new(directory.path().into());
  let mut keys = Keys::default();
  runtime.create(Some("old"), &mut keys).unwrap();
  runtime.save(vec![put(b"vault", b"accounts")]).unwrap();
  let active = fs::read(directory.path().join("vault.tauthy")).unwrap();
  keys.unavailable = true;
  assert_eq!(
    runtime.change_password(Some("old"), None, true, &mut keys),
    Err(TxError::CredentialUnavailable.into())
  );
  assert!(runtime.status().unwrap().locked);
  assert_eq!(
    fs::read(directory.path().join("vault.tauthy")).unwrap(),
    active
  );
  assert_eq!(runtime.get(b"vault"), Err(Error::Locked));
  keys.unavailable = false;
  runtime
    .unlock_current(Some("old"), None, &mut keys)
    .unwrap();
  runtime.lock().unwrap();
  runtime.unlock_current(None, None, &mut keys).unwrap();
  assert_eq!(runtime.get(b"vault").unwrap(), Some(b"accounts".to_vec()));
}

#[test]
fn foreign_replacement_is_confirmed_reauthenticated_and_locally_rekeyed() {
  let directory = tempfile::tempdir().unwrap();
  let runtime = Runtime::new(directory.path().into());
  let mut keys = Keys::default();
  runtime.create(None, &mut keys).unwrap();
  runtime.save(vec![put(b"vault", b"incumbent")]).unwrap();
  let incumbent = vault_journal::read(directory.path())
    .unwrap()
    .unwrap()
    .target
    .unwrap();
  let mut records = Records::default();
  records.insert(store_key_for(b"vault"), b"foreign".to_vec());
  records.insert(store_key_for(b"sync-config-v1"), b"foreign-sync".to_vec());
  records.insert(vec![255, 31], vec![11, 255]);
  let foreign = Vault::create(records, Some("foreign-password")).unwrap();
  assert_eq!(
    runtime.import_foreign(&foreign, None, Some("local"), false, &mut keys),
    Err(TxError::ConfirmationRequired.into())
  );
  assert_eq!(runtime.get(b"vault").unwrap(), Some(b"incumbent".to_vec()));
  keys.denied = true;
  assert_eq!(
    runtime.import_foreign(&foreign, None, Some("local"), true, &mut keys),
    Err(TxError::CredentialAccessDenied.into())
  );
  keys.denied = false;
  runtime.unlock_current(None, None, &mut keys).unwrap();
  runtime
    .import_foreign(&foreign, None, Some("local"), true, &mut keys)
    .unwrap();
  let local = vault_journal::read(directory.path())
    .unwrap()
    .unwrap()
    .target
    .unwrap();
  assert_ne!(local.vault_id, incumbent.vault_id);
  assert_ne!(local.vault_id, foreign.identity().0);
  assert!(keys.entries.is_empty());
  assert_eq!(runtime.get(b"vault").unwrap(), Some(b"foreign".to_vec()));
  assert_eq!(
    runtime.get(b"sync-config-v1").unwrap(),
    Some(b"foreign-sync".to_vec())
  );
  let opened = Envelope::read(File::open(directory.path().join("vault.tauthy")).unwrap())
    .unwrap()
    .unlock_password("local")
    .unwrap();
  assert!(opened.records.same_as(&foreign.records));
  assert_ne!(opened.credential_key(), foreign.credential_key());
  runtime.lock().unwrap();
  assert_eq!(
    runtime.unlock_current(Some("foreign-password"), None, &mut keys),
    Err(crate::vault_file::Error::Authentication.into())
  );
  runtime
    .unlock_current(Some("local"), None, &mut keys)
    .unwrap();
}

#[test]
fn startup_cleanup_discards_only_reserved_scratch_files_and_never_adopts_them() {
  let directory = tempfile::tempdir().unwrap();
  let runtime = Runtime::new(directory.path().into());
  let temporary = vault_fs::temporary(directory.path()).unwrap();
  let (handle, orphan) = temporary.keep().unwrap();
  drop(handle);
  for name in [
    ".tmp123",
    ".tauthy-write-short",
    ".tauthy-write-1234567890123456.extra",
    "notes.txt",
  ] {
    fs::write(directory.path().join(name), b"unrelated").unwrap();
  }
  runtime.cleanup_temporary_files().unwrap();
  assert!(!orphan.exists());
  assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 4);
  assert_eq!(runtime.status().unwrap().metadata.lifecycle, Lifecycle::New);
  assert!(runtime.status().unwrap().locked);
}

#[cfg(unix)]
#[test]
fn startup_cleanup_rejects_symlinks_before_deleting_any_matching_file() {
  let directory = tempfile::tempdir().unwrap();
  let outside = tempfile::NamedTempFile::new().unwrap();
  let temporary = vault_fs::temporary(directory.path()).unwrap();
  let (handle, orphan) = temporary.keep().unwrap();
  drop(handle);
  std::os::unix::fs::symlink(
    outside.path(),
    directory.path().join(".tauthy-write-1234567890123456"),
  )
  .unwrap();
  let runtime = Runtime::new(directory.path().into());
  assert_eq!(
    runtime.cleanup_temporary_files(),
    Err(TxError::ReconciliationFailed.into())
  );
  assert!(orphan.exists());
  assert!(outside.path().exists());
}

#[test]
fn interrupted_foreign_import_requires_explicit_resubmission_and_confirmation() {
  let directory = tempfile::tempdir().unwrap();
  let runtime = Runtime::new(directory.path().into());
  let mut keys = Keys::default();
  runtime.create(Some("old"), &mut keys).unwrap();
  runtime.save(vec![put(b"vault", b"incumbent")]).unwrap();
  runtime.lock().unwrap();
  let source = Envelope::read(File::open(directory.path().join("vault.tauthy")).unwrap())
    .unwrap()
    .unlock_password("old")
    .unwrap();
  let mut records = Records::default();
  records.insert(store_key_for(b"vault"), b"foreign".to_vec());
  let foreign = Vault::create(records, None).unwrap();
  let mut hook = |point| {
    if point == "afterJournal" {
      Err(TxError::Interrupted)
    } else {
      Ok(())
    }
  };
  let mut coordinator = Coordinator::new(directory.path(), &mut keys, &mut hook);
  assert_eq!(
    coordinator
      .begin_foreign_replacement(&source, &foreign, Some("new"), true)
      .err(),
    Some(TxError::Interrupted)
  );
  let active = fs::read(directory.path().join("vault.tauthy")).unwrap();
  let journal = fs::read(directory.path().join("vault.transaction.json")).unwrap();
  assert_eq!(
    runtime.unlock_current(Some("old"), Some("new"), &mut keys),
    Err(TxError::NeedsPreparation.into())
  );
  assert_eq!(
    runtime.resume_foreign_import(&foreign, Some("old"), Some("new"), false, &mut keys),
    Err(TxError::ConfirmationRequired.into())
  );
  assert_eq!(
    runtime.resume_foreign_import(&foreign, Some("wrong"), Some("new"), true, &mut keys),
    Err(crate::vault_file::Error::Authentication.into())
  );
  assert_eq!(
    fs::read(directory.path().join("vault.tauthy")).unwrap(),
    active
  );
  assert_eq!(
    fs::read(directory.path().join("vault.transaction.json")).unwrap(),
    journal
  );
  runtime
    .resume_foreign_import(&foreign, Some("old"), Some("new"), true, &mut keys)
    .unwrap();
  assert_eq!(runtime.get(b"vault").unwrap(), Some(b"foreign".to_vec()));
}

#[test]
fn deletion_cleans_fixed_working_copies_but_not_unrelated_files() {
  let directory = tempfile::tempdir().unwrap();
  let runtime = Runtime::new(directory.path().into());
  let mut keys = Keys::default();
  runtime.create(None, &mut keys).unwrap();
  for name in vault_fs::MIGRATION_COPY_FILES {
    fs::write(directory.path().join(name), b"inert").unwrap();
  }
  fs::write(directory.path().join("notes.txt"), b"unrelated").unwrap();
  runtime.delete(true, &mut keys).unwrap();
  for name in vault_fs::MIGRATION_COPY_FILES {
    assert!(!directory.path().join(name).exists());
  }
  assert!(directory.path().join("notes.txt").exists());
  runtime.create(None, &mut keys).unwrap();
}

#[test]
#[ignore = "subprocess-only helper for the abrupt-termination regression"]
fn scratch_crash_child() {
  let directory =
    std::env::var_os("TAUTHY_TEST_SCRATCH_CRASH_DIRECTORY").expect("subprocess fixture directory");
  let directory = PathBuf::from(directory);
  let mut temporary = vault_fs::temporary(&directory).unwrap();
  temporary
    .write_all(b"uncommitted encrypted fixture")
    .unwrap();
  temporary.as_file().sync_all().unwrap();
  fs::write(
    directory.join("ready.pending"),
    temporary.path().to_str().unwrap(),
  )
  .unwrap();
  fs::rename(directory.join("ready.pending"), directory.join("ready")).unwrap();
  // Parent kills this process; NamedTempFile's destructor must NOT run.
  loop {
    std::thread::park();
  }
}

#[test]
fn abrupt_process_termination_leaves_only_sweepable_scratch_not_a_vault() {
  let directory = tempfile::tempdir().unwrap();
  let mut child = std::process::Command::new(std::env::current_exe().unwrap())
    .args([
      "--exact",
      "vault_runtime::tests::scratch_crash_child",
      "--ignored",
      "--nocapture",
    ])
    .env("TAUTHY_TEST_SCRATCH_CRASH_DIRECTORY", directory.path())
    .stdin(std::process::Stdio::null())
    .stdout(std::process::Stdio::null())
    .stderr(std::process::Stdio::null())
    .spawn()
    .unwrap();
  let started = std::time::Instant::now();
  while !directory.path().join("ready").exists()
    && started.elapsed() < std::time::Duration::from_secs(10)
  {
    if child.try_wait().unwrap().is_some() {
      break;
    }
    std::thread::sleep(std::time::Duration::from_millis(10));
  }
  let ready = directory.path().join("ready").exists();
  // Always reap the fixture child, including a failed readiness handshake.
  let killed = child.kill();
  let status = child.wait().unwrap();
  assert!(ready, "scratch fixture child did not become ready");
  killed.unwrap();
  assert!(!status.success());
  let orphan = PathBuf::from(fs::read_to_string(directory.path().join("ready")).unwrap());
  assert_eq!(orphan.parent(), Some(directory.path()));
  assert!(orphan.exists());
  fs::remove_file(directory.path().join("ready")).unwrap();
  let runtime = Runtime::new(directory.path().into());
  runtime.cleanup_temporary_files().unwrap();
  assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 0);
  assert!(runtime.status().unwrap().locked);
  assert_eq!(runtime.status().unwrap().metadata.lifecycle, Lifecycle::New);
}
