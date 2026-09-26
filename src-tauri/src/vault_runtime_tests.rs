use super::*;
use std::{collections::HashMap, fs};

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
