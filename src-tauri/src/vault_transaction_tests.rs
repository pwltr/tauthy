use super::*;
use std::collections::BTreeMap;

#[path = "vault_change_tests.rs"]
mod changes;

#[derive(Default)]
struct Keys {
  entries: BTreeMap<String, Zeroizing<[u8; 32]>>,
  denied: bool,
}
impl Credentials for Keys {
  fn remove(&mut self, identity: &Identity) -> Result<(), Error> {
    if self.denied {
      return Err(Error::CredentialUnavailable);
    }
    self
      .entries
      .remove(&identity.credential_selector(true).unwrap().1);
    Ok(())
  }
  fn get(&mut self, identity: &Identity) -> Result<Option<Zeroizing<[u8; 32]>>, Error> {
    if self.denied {
      return Err(Error::CredentialUnavailable);
    }
    Ok(
      self
        .entries
        .get(&identity.credential_selector(true).unwrap().1)
        .map(|key| Zeroizing::new(**key)),
    )
  }
  fn set(&mut self, identity: &Identity, key: &[u8; 32]) -> Result<(), Error> {
    if self.denied {
      return Err(Error::CredentialUnavailable);
    }
    let selector = identity.credential_selector(true).unwrap().1;
    if self.entries.contains_key(&selector) {
      return Err(Error::Conflict);
    }
    self.entries.insert(selector, Zeroizing::new(*key));
    Ok(())
  }
}

fn records() -> Records {
  let mut records = Records::default();
  records.insert(vec![13, 37], vec![0, 255, 1]);
  records.insert(b"empty".to_vec(), vec![]);
  records
}
fn source(path: &Path, _password: &str) -> Result<Records, Error> {
  if fs::read(path).map_err(|_| Error::Io)? != b"source-snapshot" {
    return Err(Error::SourceChanged);
  }
  Ok(records())
}
fn no_failure(_: &'static str) -> Result<(), Error> {
  Ok(())
}

fn deferred_source(path: &Path, _: &str) -> Result<Records, Error> {
  let mut records = records();
  records.insert(b"current".to_vec(), fs::read(path).map_err(|_| Error::Io)?);
  Ok(records)
}

fn setup_deferred(directory: &Path, keys: &mut Keys) {
  fs::write(directory.join(LEGACY), b"old source").unwrap();
  keys.denied = true;
  let mut hook = no_failure;
  let mut coordinator = Coordinator::new(directory, keys, &mut hook);
  assert!(matches!(
    coordinator.begin_migration("", &mut deferred_source),
    Err(Error::CredentialUnavailable)
  ));
  coordinator.defer_migration().unwrap();
  fs::write(directory.join(LEGACY), b"latest edited source").unwrap();
}

#[test]
fn deferred_retry_fault_matrix_never_installs_old_records_or_loses_selectors() {
  let baseline = tempfile::tempdir().unwrap();
  let mut keys = Keys::default();
  setup_deferred(baseline.path(), &mut keys);
  keys.denied = false;
  let mut points = Vec::new();
  {
    let mut hook = |point| {
      points.push(point);
      Ok(())
    };
    let mut coordinator = Coordinator::new(baseline.path(), &mut keys, &mut hook);
    coordinator
      .retry_deferred_migration("", &mut deferred_source)
      .unwrap();
    coordinator.resume(None, &mut deferred_source).unwrap();
  }
  for failure in 0..points.len() {
    let directory = tempfile::tempdir().unwrap();
    let mut keys = Keys::default();
    setup_deferred(directory.path(), &mut keys);
    keys.denied = false;
    let selector = vault_journal::read(directory.path())
      .unwrap()
      .unwrap()
      .target
      .unwrap()
      .credential_selector(true)
      .unwrap()
      .1;
    let mut step = 0;
    {
      let mut hook = |_| {
        let at = step;
        step += 1;
        if at == failure {
          Err(Error::Interrupted)
        } else {
          Ok(())
        }
      };
      let mut coordinator = Coordinator::new(directory.path(), &mut keys, &mut hook);
      let result = coordinator
        .retry_deferred_migration("", &mut deferred_source)
        .and_then(|_| coordinator.resume(None, &mut deferred_source));
      assert!(
        matches!(result, Err(Error::Interrupted)),
        "{}",
        points[failure]
      );
    }
    let mut hook = no_failure;
    let mut coordinator = Coordinator::new(directory.path(), &mut keys, &mut hook);
    if vault_journal::read(directory.path())
      .unwrap()
      .unwrap()
      .phase
      == Phase::MigrationDeferred
    {
      coordinator
        .retry_deferred_migration("", &mut deferred_source)
        .unwrap();
    }
    let opened = coordinator.resume(None, &mut deferred_source).unwrap();
    assert_eq!(
      opened.records.get(b"current").unwrap(),
      b"latest edited source"
    );
    assert!(keys.entries.keys().all(|key| key == &selector));
    assert_eq!(
      fs::read(directory.path().join(RETIRED)).unwrap(),
      b"latest edited source"
    );
  }
}

#[test]
fn deferral_is_durable_before_edits_and_refuses_any_prepared_file() {
  for fail_at in 0..2 {
    let directory = tempfile::tempdir().unwrap();
    fs::write(directory.path().join(LEGACY), b"old source").unwrap();
    let mut keys = Keys {
      denied: true,
      ..Keys::default()
    };
    let mut hook = no_failure;
    Coordinator::new(directory.path(), &mut keys, &mut hook)
      .begin_migration("", &mut deferred_source)
      .err()
      .unwrap();
    let mut step = 0;
    let mut hook = |_| {
      let at = step;
      step += 1;
      if at == fail_at {
        Err(Error::Interrupted)
      } else {
        Ok(())
      }
    };
    assert_eq!(
      Coordinator::new(directory.path(), &mut keys, &mut hook).defer_migration(),
      Err(Error::Interrupted)
    );
    let phase = vault_journal::read(directory.path())
      .unwrap()
      .unwrap()
      .phase;
    assert_eq!(
      phase,
      if fail_at == 0 {
        Phase::CredentialStageIntent
      } else {
        Phase::MigrationDeferred
      }
    );
    assert_eq!(
      fs::read(directory.path().join(LEGACY)).unwrap(),
      b"old source"
    );
  }
  for name in [ACTIVE, STAGED, RETIRED, "vault.rollback.tauthy"] {
    let directory = tempfile::tempdir().unwrap();
    fs::write(directory.path().join(LEGACY), b"old source").unwrap();
    let mut keys = Keys {
      denied: true,
      ..Keys::default()
    };
    let mut hook = no_failure;
    let mut coordinator = Coordinator::new(directory.path(), &mut keys, &mut hook);
    coordinator
      .begin_migration("", &mut deferred_source)
      .err()
      .unwrap();
    fs::write(directory.path().join(name), b"unexpected artifact").unwrap();
    let before = fs::read(directory.path().join("vault.transaction.json")).unwrap();
    assert_eq!(
      coordinator.defer_migration(),
      Err(Error::ReconciliationFailed)
    );
    assert_eq!(
      fs::read(directory.path().join("vault.transaction.json")).unwrap(),
      before
    );
  }
}

#[test]
fn create_installs_verified_private_vault_and_keeps_terminal_journal() {
  let directory = tempfile::tempdir().unwrap();
  let vault = Vault::create(records(), Some("test")).unwrap();
  let mut keys = Keys::default();
  let mut hook = no_failure;
  let mut coordinator = Coordinator::new(directory.path(), &mut keys, &mut hook);
  coordinator.begin_create(&vault).unwrap();
  let opened = coordinator.resume(Some("test"), &mut source).unwrap();
  assert!(opened.records.same_as(&vault.records));
  assert!(!directory.path().join(STAGED).exists());
  assert_eq!(
    vault_journal::read(directory.path())
      .unwrap()
      .unwrap()
      .phase,
    Phase::Completed
  );
  #[cfg(unix)]
  {
    use std::os::unix::fs::PermissionsExt;
    assert_eq!(
      fs::metadata(directory.path().join(ACTIVE))
        .unwrap()
        .permissions()
        .mode()
        & 0o777,
      0o600
    );
  }
}

#[test]
fn migration_journals_identity_before_source_copy_and_preserves_retired_bytes() {
  let directory = tempfile::tempdir().unwrap();
  fs::write(directory.path().join(LEGACY), b"source-snapshot").unwrap();
  let mut reader = |path: &Path, password: &str| {
    let journal = vault_journal::read(directory.path()).unwrap().unwrap();
    assert!(journal.target.is_some());
    let copy = tempfile::NamedTempFile::new_in(directory.path()).unwrap();
    fs::copy(path, copy.path()).unwrap();
    source(copy.path(), password)
  };
  let mut keys = Keys::default();
  let mut hook = no_failure;
  let mut coordinator = Coordinator::new(directory.path(), &mut keys, &mut hook);
  let vault = coordinator.begin_migration("test", &mut reader).unwrap();
  let opened = coordinator.resume(Some("test"), &mut reader).unwrap();
  assert!(vault.records.same_as(&opened.records));
  assert!(!directory.path().join(LEGACY).exists());
  assert_eq!(
    fs::read(directory.path().join(RETIRED)).unwrap(),
    b"source-snapshot"
  );
}

#[test]
fn install_errors_distinguish_existing_files_from_io_failures() {
  assert_eq!(
    install_error(std::io::ErrorKind::AlreadyExists.into()),
    Error::Conflict
  );
  assert_eq!(
    install_error(std::io::ErrorKind::PermissionDenied.into()),
    Error::Io
  );
  assert_eq!(
    install_error(std::io::ErrorKind::Unsupported.into()),
    Error::Journal(vault_journal::Error::Unsupported)
  );
}

#[test]
fn retirement_refuses_source_or_backup_changes_before_removing_source() {
  for name in [LEGACY, RETIRED] {
    let directory = tempfile::tempdir().unwrap();
    fs::write(directory.path().join(LEGACY), b"source-snapshot").unwrap();
    let mut keys = Keys::default();
    let mut reader = source;
    let mut hook = no_failure;
    Coordinator::new(directory.path(), &mut keys, &mut hook)
      .with_test_kdf()
      .begin_migration("", &mut reader)
      .unwrap();
    let mut tamper = |point| {
      if point == "beforeRetireRemove" {
        fs::write(directory.path().join(name), b"changed externally").unwrap();
      }
      Ok(())
    };
    let result = Coordinator::new(directory.path(), &mut keys, &mut tamper)
      .with_test_kdf()
      .resume(None, &mut reader);
    assert!(matches!(
      result,
      Err(Error::SourceChanged | Error::Conflict)
    ));
    assert!(directory.path().join(LEGACY).is_file());
    assert_eq!(
      vault_journal::read(directory.path())
        .unwrap()
        .unwrap()
        .phase,
      Phase::RetireIntent
    );
  }
}

#[test]
fn create_fault_matrix_restarts_after_every_effect_in_both_modes() {
  for credential in [false, true] {
    let vault = Vault::create(records(), if credential { None } else { Some("test") }).unwrap();
    let baseline = tempfile::tempdir().unwrap();
    let mut keys = Keys::default();
    let mut points = Vec::new();
    {
      let mut hook = |point| {
        points.push(point);
        Ok(())
      };
      let mut coordinator = Coordinator::new(baseline.path(), &mut keys, &mut hook);
      coordinator.begin_create(&vault).unwrap();
      coordinator.resume(Some("test"), &mut source).unwrap();
    }
    for fail_at in 0..points.len() {
      let directory = tempfile::tempdir().unwrap();
      let mut keys = Keys::default();
      let mut step = 0;
      let mut hook = |_| {
        let current = step;
        step += 1;
        if current == fail_at {
          Err(Error::Interrupted)
        } else {
          Ok(())
        }
      };
      {
        let mut coordinator = Coordinator::new(directory.path(), &mut keys, &mut hook);
        let result = coordinator
          .begin_create(&vault)
          .and_then(|_| coordinator.resume(Some("test"), &mut source).map(|_| ()));
        assert_eq!(
          result,
          Err(Error::Interrupted),
          "mode {credential}, point {}",
          points[fail_at]
        );
      }
      let mut hook = no_failure;
      let mut coordinator = Coordinator::new(directory.path(), &mut keys, &mut hook);
      let journal = vault_journal::read(directory.path()).unwrap();
      if journal.is_none() {
        coordinator.begin_create(&vault).unwrap();
      } else if matches!(
        journal.unwrap().phase,
        Phase::Prepared
          | Phase::CredentialStageIntent
          | Phase::CredentialVerified
          | Phase::FilePrepareIntent
      ) {
        coordinator.prepare(&vault).unwrap();
      }
      let reopened = coordinator
        .resume(Some("test"), &mut source)
        .unwrap_or_else(|error| panic!("mode {credential}, point {}: {error:?}", points[fail_at]));
      assert!(reopened.records.same_as(&vault.records));
      assert!(!directory.path().join(STAGED).exists());
      assert_eq!(
        vault_journal::read(directory.path())
          .unwrap()
          .unwrap()
          .phase,
        Phase::Completed
      );
    }
  }
}

#[test]
fn migration_fault_matrix_resumes_every_checkpoint_without_losing_source() {
  for password in ["", "test"] {
    let baseline = tempfile::tempdir().unwrap();
    fs::write(baseline.path().join(LEGACY), b"source-snapshot").unwrap();
    let mut keys = Keys::default();
    let mut points = Vec::new();
    {
      let mut hook = |point| {
        points.push(point);
        Ok(())
      };
      let mut coordinator = Coordinator::new(baseline.path(), &mut keys, &mut hook);
      coordinator.begin_migration(password, &mut source).unwrap();
      coordinator.resume(Some(password), &mut source).unwrap();
    }
    for fail_at in 0..points.len() {
      let directory = tempfile::tempdir().unwrap();
      fs::write(directory.path().join(LEGACY), b"source-snapshot").unwrap();
      let mut keys = Keys::default();
      let mut step = 0;
      let mut hook = |_| {
        let current = step;
        step += 1;
        if current == fail_at {
          Err(Error::Interrupted)
        } else {
          Ok(())
        }
      };
      {
        let mut coordinator = Coordinator::new(directory.path(), &mut keys, &mut hook);
        let result = coordinator
          .begin_migration(password, &mut source)
          .and_then(|_| coordinator.resume(Some(password), &mut source));
        assert!(
          matches!(result, Err(Error::Interrupted)),
          "point {}",
          points[fail_at]
        );
      }
      let original = directory.path().join(LEGACY);
      let retired = directory.path().join(RETIRED);
      let source_path = if original.exists() {
        &original
      } else {
        &retired
      };
      assert_eq!(fs::read(source_path).unwrap(), b"source-snapshot");
      let mut hook = no_failure;
      let mut coordinator = Coordinator::new(directory.path(), &mut keys, &mut hook);
      if vault_journal::read(directory.path()).unwrap().is_none() {
        coordinator.begin_migration(password, &mut source).unwrap();
      }
      match coordinator.resume(Some(password), &mut source) {
        Ok(opened) => {
          assert!(opened.records.same_as(&records()));
          assert_eq!(fs::read(retired).unwrap(), b"source-snapshot");
        }
        other => panic!("point {}: {:?}", points[fail_at], other.err()),
      }
      let journal = vault_journal::read(directory.path()).unwrap().unwrap();
      for selector in keys.entries.keys() {
        assert_eq!(
          selector,
          &journal
            .target
            .as_ref()
            .unwrap()
            .credential_selector(true)
            .unwrap()
            .1
        );
      }
    }
  }
}

#[test]
fn explicit_creation_supersedes_deleted_but_not_unfinished_or_unclean_deletion() {
  let directory = tempfile::tempdir().unwrap();
  let old = Vault::create(records(), None).unwrap();
  let source_identity = identity(&old);
  let mut journal = Journal {
    version: 1,
    transaction_id: [1; 16],
    operation: Operation::Delete,
    phase: Phase::DeleteIntent,
    source_fingerprint: None,
    source_identity: Some(source_identity.clone()),
    target: None,
    target_fingerprint: None,
    cleanup_identities: Vec::new(),
  };
  vault_journal::persist(directory.path(), &journal).unwrap();
  let new = Vault::create(Records::default(), None).unwrap();
  let mut keys = Keys::default();
  let mut hook = no_failure;
  assert_eq!(
    Coordinator::new(directory.path(), &mut keys, &mut hook).begin_create(&new),
    Err(Error::Conflict)
  );
  journal.phase = Phase::Deleted;
  vault_journal::persist(directory.path(), &journal).unwrap();
  keys.set(&source_identity, old.credential_key()).unwrap();
  assert_eq!(
    Coordinator::new(directory.path(), &mut keys, &mut hook).begin_create(&new),
    Err(Error::Conflict)
  );
  keys.entries.clear();
  let mut coordinator = Coordinator::new(directory.path(), &mut keys, &mut hook);
  coordinator.begin_create(&new).unwrap();
  let opened = coordinator.resume(None, &mut source).unwrap();
  assert!(opened.records.same_as(&new.records));
}

#[test]
fn completed_path_retries_cleanup_and_missing_active_never_opens_stage() {
  let directory = tempfile::tempdir().unwrap();
  let vault = Vault::create(records(), None).unwrap();
  let mut keys = Keys::default();
  let mut hook = |point| {
    if point == "beforeStageCleanup" {
      Err(Error::Interrupted)
    } else {
      Ok(())
    }
  };
  {
    let mut coordinator = Coordinator::new(directory.path(), &mut keys, &mut hook);
    coordinator.begin_create(&vault).unwrap();
    assert!(matches!(
      coordinator.resume(None, &mut source),
      Err(Error::Interrupted)
    ));
  }
  assert_eq!(
    vault_journal::read(directory.path())
      .unwrap()
      .unwrap()
      .phase,
    Phase::Completed
  );
  assert!(directory.path().join(STAGED).exists());
  let mut hook = no_failure;
  Coordinator::new(directory.path(), &mut keys, &mut hook)
    .resume(None, &mut source)
    .unwrap();
  assert!(!directory.path().join(STAGED).exists());
  fs::hard_link(directory.path().join(ACTIVE), directory.path().join(STAGED)).unwrap();
  fs::remove_file(directory.path().join(ACTIVE)).unwrap();
  assert!(matches!(
    Coordinator::new(directory.path(), &mut keys, &mut hook).resume(None, &mut source),
    Err(Error::MissingVault)
  ));
  assert!(directory.path().join(STAGED).exists());
}

#[test]
fn unexpected_stage_phase_and_foreign_active_are_reconciliation_errors() {
  let directory = tempfile::tempdir().unwrap();
  let vault = Vault::create(records(), None).unwrap();
  let mut keys = Keys::default();
  let mut hook = no_failure;
  Coordinator::new(directory.path(), &mut keys, &mut hook)
    .begin_create(&vault)
    .unwrap();
  let mut journal = vault_journal::read(directory.path()).unwrap().unwrap();
  journal.phase = Phase::CredentialVerified;
  vault_journal::persist(directory.path(), &journal).unwrap();
  assert!(matches!(
    Coordinator::new(directory.path(), &mut keys, &mut hook).resume(None, &mut source),
    Err(Error::ReconciliationFailed)
  ));
  journal.phase = Phase::InstallIntent;
  vault_journal::persist(directory.path(), &journal).unwrap();
  let foreign = Vault::create(records(), None).unwrap().seal().unwrap();
  fs::write(directory.path().join(ACTIVE), &foreign).unwrap();
  assert!(matches!(
    Coordinator::new(directory.path(), &mut keys, &mut hook).resume(None, &mut source),
    Err(Error::IdentityMismatch)
  ));
  assert_eq!(fs::read(directory.path().join(ACTIVE)).unwrap(), foreign);
}

#[test]
fn wrong_password_and_pending_unlock_leave_transaction_byte_identical() {
  let directory = tempfile::tempdir().unwrap();
  fs::write(directory.path().join(LEGACY), b"source-snapshot").unwrap();
  let mut keys = Keys::default();
  let mut hook = no_failure;
  let mut coordinator = Coordinator::new(directory.path(), &mut keys, &mut hook);
  coordinator.begin_migration("correct", &mut source).unwrap();
  let names = ["vault.transaction.json", LEGACY, STAGED];
  let before: Vec<_> = names
    .iter()
    .map(|name| fs::read(directory.path().join(name)).unwrap())
    .collect();
  let mut never_read = |_: &Path, _: &str| -> Result<Records, Error> {
    panic!("source read before target authentication")
  };
  assert!(matches!(
    coordinator.resume(None, &mut never_read),
    Err(Error::PendingUnlock)
  ));
  assert!(matches!(
    coordinator.resume(Some("wrong"), &mut never_read),
    Err(Error::Envelope(vault_file::Error::Authentication))
  ));
  for (name, bytes) in names.iter().zip(before) {
    assert_eq!(fs::read(directory.path().join(name)).unwrap(), bytes);
  }
}

#[test]
fn lost_install_artifacts_and_changed_source_fail_closed() {
  let directory = tempfile::tempdir().unwrap();
  fs::write(directory.path().join(LEGACY), b"source-snapshot").unwrap();
  let mut keys = Keys::default();
  let mut hook = no_failure;
  let mut coordinator = Coordinator::new(directory.path(), &mut keys, &mut hook);
  coordinator.begin_migration("", &mut source).unwrap();
  fs::write(directory.path().join(LEGACY), b"changed").unwrap();
  assert!(matches!(
    coordinator.resume(None, &mut source),
    Err(Error::SourceChanged)
  ));
  fs::write(directory.path().join(LEGACY), b"source-snapshot").unwrap();
  fs::remove_file(directory.path().join(STAGED)).unwrap();
  assert!(matches!(
    coordinator.resume(None, &mut source),
    Err(Error::MissingVault)
  ));
  assert!(!directory.path().join(ACTIVE).exists());
}

#[test]
fn credential_denial_never_installs_or_loses_journaled_selector() {
  let directory = tempfile::tempdir().unwrap();
  let vault = Vault::create(records(), None).unwrap();
  let mut keys = Keys {
    denied: true,
    ..Keys::default()
  };
  let mut hook = no_failure;
  let mut coordinator = Coordinator::new(directory.path(), &mut keys, &mut hook);
  assert_eq!(
    coordinator.begin_create(&vault),
    Err(Error::CredentialUnavailable)
  );
  assert_eq!(
    vault_journal::read(directory.path())
      .unwrap()
      .unwrap()
      .phase,
    Phase::CredentialStageIntent
  );
  assert!(!directory.path().join(ACTIVE).exists());
  assert!(!directory.path().join(STAGED).exists());
}

#[test]
fn reconstructing_staged_credential_resumes_after_lookup_interruptions() {
  for fail_point in [
    "beforeReconstructCredentialGet",
    "afterReconstructCredentialGet",
  ] {
    let directory = tempfile::tempdir().unwrap();
    fs::write(directory.path().join(LEGACY), b"source-snapshot").unwrap();
    let mut keys = Keys::default();
    let mut hook = |point| {
      if point == "afterCredentialSet" {
        Err(Error::Interrupted)
      } else {
        Ok(())
      }
    };
    assert!(matches!(
      Coordinator::new(directory.path(), &mut keys, &mut hook).begin_migration("", &mut source),
      Err(Error::Interrupted)
    ));
    assert_eq!(keys.entries.len(), 1);
    let before = fs::read(directory.path().join("vault.transaction.json")).unwrap();
    let mut hook = |point| {
      if point == fail_point {
        Err(Error::Interrupted)
      } else {
        Ok(())
      }
    };
    assert!(matches!(
      Coordinator::new(directory.path(), &mut keys, &mut hook).resume(None, &mut source),
      Err(Error::Interrupted)
    ));
    assert_eq!(
      fs::read(directory.path().join("vault.transaction.json")).unwrap(),
      before
    );
    let mut hook = no_failure;
    let opened = Coordinator::new(directory.path(), &mut keys, &mut hook)
      .resume(None, &mut source)
      .unwrap();
    assert!(opened.records.same_as(&records()));
    assert_eq!(keys.entries.len(), 1);
  }
}

#[test]
fn pre_install_password_failure_never_advances_or_aborts_prepared_migration() {
  let directory = tempfile::tempdir().unwrap();
  fs::write(directory.path().join(LEGACY), b"source-snapshot").unwrap();
  let mut keys = Keys::default();
  let mut hook = |point| {
    if point == "afterJournal" {
      Err(Error::Interrupted)
    } else {
      Ok(())
    }
  };
  assert!(matches!(
    Coordinator::new(directory.path(), &mut keys, &mut hook)
      .begin_migration("correct", &mut source),
    Err(Error::Interrupted)
  ));
  let before = fs::read(directory.path().join("vault.transaction.json")).unwrap();
  let mut reader = |path: &Path, password: &str| {
    if password != "correct" {
      return Err(Error::Envelope(vault_file::Error::Authentication));
    }
    source(path, password)
  };
  let mut hook = no_failure;
  let mut coordinator = Coordinator::new(directory.path(), &mut keys, &mut hook);
  assert!(matches!(
    coordinator.resume(None, &mut reader),
    Err(Error::PendingUnlock)
  ));
  assert!(matches!(
    coordinator.resume(Some("wrong"), &mut reader),
    Err(Error::Envelope(vault_file::Error::Authentication))
  ));
  assert_eq!(
    fs::read(directory.path().join("vault.transaction.json")).unwrap(),
    before
  );
  assert_eq!(
    fs::read(directory.path().join(LEGACY)).unwrap(),
    b"source-snapshot"
  );
  assert!(!directory.path().join(STAGED).exists());
  coordinator.resume(Some("correct"), &mut reader).unwrap();
}

#[test]
fn completed_cleanup_errors_identify_stage_not_authenticated_active_vault() {
  for foreign in [false, true] {
    let directory = tempfile::tempdir().unwrap();
    let vault = Vault::create(records(), None).unwrap();
    let mut keys = Keys::default();
    let mut hook = |point| {
      if point == "beforeStageCleanup" {
        Err(Error::Interrupted)
      } else {
        Ok(())
      }
    };
    {
      let mut coordinator = Coordinator::new(directory.path(), &mut keys, &mut hook);
      coordinator.begin_create(&vault).unwrap();
      assert!(matches!(
        coordinator.resume(None, &mut source),
        Err(Error::Interrupted)
      ));
    }
    let active_before = fs::read(directory.path().join(ACTIVE)).unwrap();
    let junk = if foreign {
      Vault::create(records(), None).unwrap().seal().unwrap()
    } else {
      vec![1, 2, 3]
    };
    // Replace the directory entry, rather than mutate the shared hard-link inode.
    let mut replacement = tempfile::NamedTempFile::new_in(directory.path()).unwrap();
    replacement.write_all(&junk).unwrap();
    replacement.persist(directory.path().join(STAGED)).unwrap();
    let mut hook = no_failure;
    assert!(matches!(
      Coordinator::new(directory.path(), &mut keys, &mut hook).resume(None, &mut source),
      Err(Error::StagedCleanupFailed(_))
    ));
    assert_eq!(
      fs::read(directory.path().join(ACTIVE)).unwrap(),
      active_before
    );
    assert_eq!(fs::read(directory.path().join(STAGED)).unwrap(), junk);
    let active = Envelope::read(active_before.as_slice())
      .unwrap()
      .unlock_credential(Some(*vault.credential_key()))
      .unwrap();
    assert!(active.records.same_as(&vault.records));
    // Explicit artifact recovery permits opening; no active reset/reimport.
    fs::remove_file(directory.path().join(STAGED)).unwrap();
    Coordinator::new(directory.path(), &mut keys, &mut hook)
      .resume(None, &mut source)
      .unwrap();
  }
}

#[test]
fn cleanup_failure_during_completion_is_also_scoped_to_stage() {
  let directory = tempfile::tempdir().unwrap();
  let vault = Vault::create(records(), None).unwrap();
  let mut keys = Keys::default();
  let mut hook = no_failure;
  Coordinator::new(directory.path(), &mut keys, &mut hook)
    .begin_create(&vault)
    .unwrap();
  let mut hook = |point| {
    if point == "afterJournal"
      && vault_journal::read(directory.path())
        .unwrap()
        .unwrap()
        .phase
        == Phase::Completed
    {
      let mut replacement = tempfile::NamedTempFile::new_in(directory.path()).unwrap();
      replacement.write_all(b"truncated").unwrap();
      replacement.persist(directory.path().join(STAGED)).unwrap();
    }
    Ok(())
  };
  assert!(
    matches!(Coordinator::new(directory.path(), &mut keys, &mut hook)
    .resume(None, &mut source),
    Err(Error::StagedCleanupFailed(cause)) if *cause == Error::Envelope(vault_file::Error::Corrupt))
  );
  assert_eq!(
    vault_journal::read(directory.path())
      .unwrap()
      .unwrap()
      .phase,
    Phase::Completed
  );
  let active = Envelope::read(File::open(directory.path().join(ACTIVE)).unwrap())
    .unwrap()
    .unlock_credential(Some(*vault.credential_key()))
    .unwrap();
  assert!(active.records.same_as(&vault.records));
}
