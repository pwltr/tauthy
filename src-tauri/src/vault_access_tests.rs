use super::*;
use crate::{
  vault_journal::Identity,
  vault_runtime::Error,
  vault_transaction::{Credentials, Error as TxError},
};
use std::fs;

struct NoNative;
impl Credentials for NoNative {
  fn get(&mut self, _: &Identity) -> Result<Option<Zeroizing<[u8; 32]>>, TxError> {
    panic!("password fixture requested native credential")
  }
  fn set(&mut self, _: &Identity, _: &[u8; 32]) -> Result<(), TxError> {
    panic!("password fixture wrote native credential")
  }
  fn remove(&mut self, _: &Identity) -> Result<(), TxError> {
    panic!("password fixture removed native credential")
  }
}
fn runtime(directory: &std::path::Path) -> Runtime {
  let runtime = Runtime::new(directory.into());
  runtime.create(Some("test"), &mut NoNative).unwrap();
  runtime
    .save(vec![Update {
      name: b"vault".to_vec(),
      value: Some(Zeroizing::new(b"old".to_vec())),
    }])
    .unwrap();
  runtime
}

#[test]
fn file_batch_reads_queued_updates_and_commits_all_records_together() {
  let directory = tempfile::tempdir().unwrap();
  let runtime = runtime(directory.path());
  let before = fs::read(directory.path().join("vault.tauthy")).unwrap();
  runtime
    .with_records(|vault| {
      vault.save_records(vec![
        (b"vault", Some(b"new".to_vec())),
        (b"sync-config-v1", Some(b"sync".to_vec())),
      ])?;
      assert_eq!(vault.get_record(b"vault")?, Some(b"new".to_vec()));
      assert_eq!(
        fs::read(directory.path().join("vault.tauthy")).unwrap(),
        before
      );
      vault.save_records(vec![(b"scratch", Some(Vec::new())), (b"scratch", None)])?;
      assert_eq!(vault.get_record(b"scratch")?, None);
      Ok(())
    })
    .unwrap();
  runtime.lock().unwrap();
  runtime
    .unlock_current(Some("test"), None, &mut NoNative)
    .unwrap();
  assert_eq!(runtime.get(b"vault").unwrap(), Some(b"new".to_vec()));
  assert_eq!(
    runtime.get(b"sync-config-v1").unwrap(),
    Some(b"sync".to_vec())
  );
  assert_eq!(runtime.get(b"scratch").unwrap(), None);
}

#[test]
fn failed_scope_discards_every_queued_write_without_changing_session_or_disk() {
  let directory = tempfile::tempdir().unwrap();
  let runtime = runtime(directory.path());
  let before = fs::read(directory.path().join("vault.tauthy")).unwrap();
  let result: Result<(), String> = runtime.with_records(|vault| {
    vault.save_records(vec![
      (b"vault", Some(b"new".to_vec())),
      (b"sync-config-v1", Some(b"sync".to_vec())),
    ])?;
    Err("syncConflict".into())
  });
  assert_eq!(result, Err("syncConflict".into()));
  assert_eq!(
    fs::read(directory.path().join("vault.tauthy")).unwrap(),
    before
  );
  assert!(!runtime.status().unwrap().locked);
  assert_eq!(runtime.get(b"vault").unwrap(), Some(b"old".to_vec()));
  assert_eq!(runtime.get(b"sync-config-v1").unwrap(), None);
}

#[test]
fn oversized_batch_locks_without_committing_just_one_record() {
  let directory = tempfile::tempdir().unwrap();
  let runtime = runtime(directory.path());
  let before = fs::read(directory.path().join("vault.tauthy")).unwrap();
  assert_eq!(
    runtime.with_records(|vault| vault.save_records(vec![
      (b"vault", Some(b"new".to_vec())),
      (b"sync-config-v1", Some(vec![0; 64 * 1024 * 1024])),
    ])),
    Err("vaultTooLarge".into())
  );
  assert!(runtime.status().unwrap().locked);
  assert_eq!(
    fs::read(directory.path().join("vault.tauthy")).unwrap(),
    before
  );
  runtime
    .unlock_current(Some("test"), None, &mut NoNative)
    .unwrap();
  assert_eq!(runtime.get(b"vault").unwrap(), Some(b"old".to_vec()));
  assert_eq!(runtime.get(b"sync-config-v1").unwrap(), None);
}

#[test]
fn read_only_scopes_are_noops_and_locked_tray_exposes_no_accounts() {
  let directory = tempfile::tempdir().unwrap();
  let runtime = runtime(directory.path());
  let before = fs::read(directory.path().join("vault.tauthy")).unwrap();
  assert_eq!(account_record(&runtime).unwrap(), Some("old".into()));
  assert_eq!(
    fs::read(directory.path().join("vault.tauthy")).unwrap(),
    before
  );
  runtime.lock().unwrap();
  assert_eq!(account_record(&runtime).unwrap(), None);
  assert_eq!(
    runtime.with_records(|_| Ok(())),
    Err("vault is locked".into())
  );
  assert_eq!(runtime.get(b"vault"), Err(Error::Locked));
}

#[test]
fn file_record_scope_serializes_remote_merge_with_local_edits() {
  let directory = tempfile::tempdir().unwrap();
  let runtime = runtime(directory.path());
  std::thread::scope(|scope| {
    let (start, ready) = std::sync::mpsc::channel();
    let runtime_ref = &runtime;
    let writer = scope.spawn(move || {
      ready.recv().unwrap();
      runtime_ref
        .save(vec![Update {
          name: b"unrelated".to_vec(),
          value: Some(Zeroizing::new(b"local edit".to_vec())),
        }])
        .unwrap();
    });
    runtime
      .with_records(|vault| {
        start.send(()).unwrap();
        assert_eq!(vault.get_record(b"vault")?, Some(b"old".to_vec()));
        vault.save_records(vec![
          (b"vault", Some(b"merged".to_vec())),
          (b"sync-config-v1", Some(b"remote".to_vec())),
        ])
      })
      .unwrap();
    writer.join().unwrap();
  });
  assert_eq!(runtime.get(b"vault").unwrap(), Some(b"merged".to_vec()));
  assert_eq!(
    runtime.get(b"sync-config-v1").unwrap(),
    Some(b"remote".to_vec())
  );
  assert_eq!(
    runtime.get(b"unrelated").unwrap(),
    Some(b"local edit".to_vec())
  );
}
