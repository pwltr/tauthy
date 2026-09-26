use super::*;
use crate::vault_transaction::changes::ROLLBACK;

fn setup(path: &Path, password: Option<&str>, keys: &mut Keys) -> Vault {
  let vault = Vault::create_for_tests(records(), password).unwrap();
  let mut hook = no_failure;
  let mut coordinator = Coordinator::new(path, keys, &mut hook).with_test_kdf();
  coordinator.begin_create(&vault).unwrap();
  coordinator.resume(password, &mut source).unwrap();
  vault
}

fn assert_completed(path: &Path, vault: &Vault) {
  let journal = vault_journal::read(path).unwrap().unwrap();
  assert_eq!(journal.phase, Phase::Completed);
  assert_eq!(journal.target, Some(identity(vault)));
  assert!(!path.join(STAGED).exists());
  assert!(!path.join(ROLLBACK).exists());
}

#[test]
fn rotation_recovers_every_checkpoint_in_all_protection_combinations() {
  for old_password in [None, Some("old")] {
    for new_password in [None, Some("new")] {
      let baseline = tempfile::tempdir().unwrap();
      let mut keys = Keys::default();
      let old = setup(baseline.path(), old_password, &mut keys);
      let new = old.rotate_for_tests(new_password).unwrap();
      let mut points = Vec::new();
      let mut hook = |name| {
        points.push(name);
        Ok(())
      };
      let mut c = Coordinator::new(baseline.path(), &mut keys, &mut hook).with_test_kdf();
      c.begin_rotation(&old, &new).unwrap();
      c.resume_change(old_password, new_password).unwrap();
      drop(c);
      drop(hook);
      for fail_at in 0..points.len() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path();
        let mut keys = Keys::default();
        let old = setup(path, old_password, &mut keys);
        let new = old.rotate_for_tests(new_password).unwrap();
        let mut index = 0;
        let mut hook = |_| {
          let fail = index == fail_at;
          index += 1;
          if fail {
            Err(Error::Interrupted)
          } else {
            Ok(())
          }
        };
        let mut c = Coordinator::new(path, &mut keys, &mut hook).with_test_kdf();
        let result = c
          .begin_rotation(&old, &new)
          .and_then(|_| c.resume_change(old_password, new_password).map(|_| ()));
        assert!(
          matches!(result, Err(Error::Interrupted)),
          "{}",
          points[fail_at]
        );
        drop(c);
        let mut hook = no_failure;
        let mut c = Coordinator::new(path, &mut keys, &mut hook).with_test_kdf();
        if c.load().unwrap().operation == Operation::Create {
          c.begin_rotation(&old, &new).unwrap();
        }
        let recovered = c
          .resume_change(old_password, new_password)
          .unwrap_or_else(|error| panic!("{}: {:?}", points[fail_at], error));
        assert!(recovered.records.same_as(&old.records));
        assert_ne!(recovered.credential_key(), old.credential_key());
        assert_completed(path, &recovered);
        drop(c);
        if identity(&old).credential {
          assert!(keys.get(&identity(&old)).unwrap().is_none());
        }
        assert_eq!(keys.entries.len(), usize::from(new_password.is_none()));
        let bytes = fs::read(path.join(ACTIVE)).unwrap();
        assert!(Envelope::read(bytes.as_slice())
          .unwrap()
          .unlock_data_key(*old.credential_key())
          .is_err());
      }
    }
  }
}

#[test]
fn foreign_replacement_recovers_every_checkpoint_and_mints_local_identity() {
  for password in [None, Some("new")] {
    let baseline = tempfile::tempdir().unwrap();
    let mut keys = Keys::default();
    let old = setup(baseline.path(), None, &mut keys);
    let mut imported = records();
    imported.insert(
      b"sync-config-v1".to_vec(),
      b"opaque foreign content".to_vec(),
    );
    let foreign = Vault::create_for_tests(imported, None).unwrap();
    let mut points = Vec::new();
    let mut hook = |name| {
      points.push(name);
      Ok(())
    };
    let mut c = Coordinator::new(baseline.path(), &mut keys, &mut hook).with_test_kdf();
    c.begin_foreign_replacement(&old, &foreign, password, true)
      .unwrap();
    c.resume_change(None, password).unwrap();
    drop(c);
    drop(hook);
    for fail_at in 0..points.len() {
      let directory = tempfile::tempdir().unwrap();
      let path = directory.path();
      let mut keys = Keys::default();
      let old = setup(path, None, &mut keys);
      fs::write(path.join(RETIRED), b"incumbent retired snapshot").unwrap();
      let mut index = 0;
      let mut hook = |_| {
        let fail = index == fail_at;
        index += 1;
        if fail {
          Err(Error::Interrupted)
        } else {
          Ok(())
        }
      };
      let mut c = Coordinator::new(path, &mut keys, &mut hook).with_test_kdf();
      let result = c
        .begin_foreign_replacement(&old, &foreign, password, true)
        .and_then(|_| c.resume_change(None, password));
      assert!(
        matches!(result, Err(Error::Interrupted)),
        "{}",
        points[fail_at]
      );
      drop(c);
      let mut hook = no_failure;
      let mut c = Coordinator::new(path, &mut keys, &mut hook).with_test_kdf();
      if c.load().unwrap().operation == Operation::Create {
        c.begin_foreign_replacement(&old, &foreign, password, true)
          .unwrap();
      }
      let recovered = match c.resume_change(None, password) {
        Ok(vault) => vault,
        Err(Error::NeedsPreparation) => {
          c.prepare_foreign_replacement(&old, &foreign, password, true)
            .unwrap();
          c.resume_change(None, password).unwrap()
        }
        Err(error) => panic!("{}: {:?}", points[fail_at], error),
      };
      assert!(recovered.records.same_as(&foreign.records));
      assert_ne!(recovered.identity().0, old.identity().0);
      assert_ne!(recovered.identity().0, foreign.identity().0);
      assert_ne!(recovered.credential_key(), foreign.credential_key());
      assert_completed(path, &recovered);
      assert_eq!(
        fs::read(path.join(RETIRED)).unwrap(),
        b"incumbent retired snapshot"
      );
      drop(c);
      assert_eq!(keys.entries.len(), usize::from(password.is_none()));
    }
  }
}

#[test]
fn deletion_recovers_every_checkpoint_without_touching_exports_or_sync() {
  let baseline = tempfile::tempdir().unwrap();
  let mut keys = Keys::default();
  setup(baseline.path(), None, &mut keys);
  fs::write(baseline.path().join(RETIRED), b"retired").unwrap();
  let mut points = Vec::new();
  let mut hook = |name| {
    points.push(name);
    Ok(())
  };
  let mut c = Coordinator::new(baseline.path(), &mut keys, &mut hook);
  c.begin_delete(true).unwrap();
  drop(c);
  drop(hook);
  for fail_at in 0..points.len() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path();
    let mut keys = Keys::default();
    let old = setup(path, None, &mut keys);
    fs::write(path.join(RETIRED), b"retired").unwrap();
    fs::write(path.join("backup.json"), b"export").unwrap();
    fs::write(path.join("tauthy-sync"), b"sync").unwrap();
    let mut index = 0;
    let mut hook = |_| {
      let fail = index == fail_at;
      index += 1;
      if fail {
        Err(Error::Interrupted)
      } else {
        Ok(())
      }
    };
    let mut c = Coordinator::new(path, &mut keys, &mut hook);
    assert!(
      matches!(c.begin_delete(true), Err(Error::Interrupted)),
      "{}",
      points[fail_at]
    );
    drop(c);
    let mut hook = no_failure;
    let mut c = Coordinator::new(path, &mut keys, &mut hook);
    if c.load().unwrap().operation != Operation::Delete {
      c.begin_delete(true).unwrap();
    }
    c.resume_delete().unwrap();
    let journal = c.load().unwrap();
    assert_eq!(journal.phase, Phase::Deleted);
    assert_eq!(journal.source_identity, Some(identity(&old)));
    drop(c);
    assert!(keys.entries.is_empty());
    assert!(!path.join(ACTIVE).exists());
    assert!(!path.join(RETIRED).exists());
    assert_eq!(fs::read(path.join("backup.json")).unwrap(), b"export");
    assert_eq!(fs::read(path.join("tauthy-sync")).unwrap(), b"sync");
    let fresh = Vault::create_for_tests(records(), None).unwrap();
    let mut c = Coordinator::new(path, &mut keys, &mut hook).with_test_kdf();
    c.begin_create(&fresh).unwrap();
    c.resume(None, &mut source).unwrap();
  }
}

#[test]
fn wrong_passwords_and_unconfirmed_destructive_actions_do_not_mutate() {
  let directory = tempfile::tempdir().unwrap();
  let path = directory.path();
  let mut keys = Keys::default();
  let old = setup(path, Some("old"), &mut keys);
  let foreign = Vault::create_for_tests(records(), None).unwrap();
  let mut hook = no_failure;
  let mut c = Coordinator::new(path, &mut keys, &mut hook).with_test_kdf();
  assert!(matches!(
    c.begin_delete(false),
    Err(Error::ConfirmationRequired)
  ));
  assert!(matches!(
    c.begin_foreign_replacement(&old, &foreign, None, false),
    Err(Error::ConfirmationRequired)
  ));
  let new = old.rotate_for_tests(Some("new")).unwrap();
  c.begin_rotation(&old, &new).unwrap();
  let before: Vec<_> = [ACTIVE, STAGED, ROLLBACK, "vault.transaction.json"]
    .iter()
    .map(|name| fs::read(path.join(name)).unwrap())
    .collect();
  for (old_password, new_password) in [
    (Some("wrong"), Some("new")),
    (Some("old"), Some("wrong")),
    (None, Some("new")),
  ] {
    assert!(c.resume_change(old_password, new_password).is_err());
    let after: Vec<_> = [ACTIVE, STAGED, ROLLBACK, "vault.transaction.json"]
      .iter()
      .map(|name| fs::read(path.join(name)).unwrap())
      .collect();
    assert_eq!(before, after);
  }
}

#[test]
fn deletion_retries_denied_key_cleanup_after_files_are_gone() {
  let directory = tempfile::tempdir().unwrap();
  let mut keys = Keys::default();
  let old = setup(directory.path(), None, &mut keys);
  keys.denied = true;
  let mut hook = no_failure;
  let mut c = Coordinator::new(directory.path(), &mut keys, &mut hook);
  assert!(matches!(
    c.begin_delete(true),
    Err(Error::CredentialUnavailable)
  ));
  assert!(!directory.path().join(ACTIVE).exists());
  assert_eq!(c.load().unwrap().source_identity, Some(identity(&old)));
  assert_eq!(c.load().unwrap().phase, Phase::DeleteIntent);
  drop(c);
  keys.denied = false;
  Coordinator::new(directory.path(), &mut keys, &mut hook)
    .resume_delete()
    .unwrap();
  assert!(keys.entries.is_empty());
}

#[test]
fn deletion_of_interrupted_rotation_retains_both_credential_selectors() {
  let directory = tempfile::tempdir().unwrap();
  let path = directory.path();
  let mut keys = Keys::default();
  let old = setup(path, None, &mut keys);
  let new = old.rotate_for_tests(None).unwrap();
  let mut hook = no_failure;
  Coordinator::new(path, &mut keys, &mut hook)
    .begin_rotation(&old, &new)
    .unwrap();
  assert_eq!(keys.entries.len(), 2);
  keys.denied = true;
  let mut c = Coordinator::new(path, &mut keys, &mut hook);
  assert!(matches!(
    c.begin_delete(true),
    Err(Error::CredentialUnavailable)
  ));
  let journal = c.load().unwrap();
  assert!(journal.cleanup_identities.contains(&identity(&old)));
  assert!(journal.cleanup_identities.contains(&identity(&new)));
  assert!(!path.join(ACTIVE).exists());
  assert!(!path.join(STAGED).exists());
  assert!(!path.join(ROLLBACK).exists());
  drop(c);
  keys.denied = false;
  Coordinator::new(path, &mut keys, &mut hook)
    .resume_delete()
    .unwrap();
  assert!(keys.entries.is_empty());
}

#[test]
fn missing_active_never_rolls_back_but_explicit_deletion_is_available() {
  let directory = tempfile::tempdir().unwrap();
  let path = directory.path();
  let mut keys = Keys::default();
  let old = setup(path, None, &mut keys);
  let new = old.rotate_for_tests(None).unwrap();
  let mut hook = no_failure;
  let mut c = Coordinator::new(path, &mut keys, &mut hook);
  c.begin_rotation(&old, &new).unwrap();
  fs::remove_file(path.join(ACTIVE)).unwrap();
  assert!(matches!(
    c.resume_change(None, None),
    Err(Error::MissingVault)
  ));
  assert!(!path.join(ACTIVE).exists());
  c.begin_delete(true).unwrap();
  assert_eq!(c.load().unwrap().phase, Phase::Deleted);
  drop(c);
  assert!(keys.entries.is_empty());
}

#[test]
fn lost_replacement_stage_requires_recovery_not_reconstruction() {
  let directory = tempfile::tempdir().unwrap();
  let path = directory.path();
  let mut keys = Keys::default();
  let old = setup(path, None, &mut keys);
  let new = old.rotate_for_tests(None).unwrap();
  let mut hook = no_failure;
  let mut c = Coordinator::new(path, &mut keys, &mut hook);
  c.begin_rotation(&old, &new).unwrap();
  fs::remove_file(path.join(STAGED)).unwrap();
  let active = fs::read(path.join(ACTIVE)).unwrap();
  assert!(matches!(
    c.resume_change(None, None),
    Err(Error::MissingVault)
  ));
  assert_eq!(active, fs::read(path.join(ACTIVE)).unwrap());
  assert!(!path.join(STAGED).exists());
  assert_eq!(c.load().unwrap().phase, Phase::ReplaceIntent);
}

#[test]
fn conflicting_active_or_rollback_files_are_not_clobbered() {
  for name in [ACTIVE, ROLLBACK] {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path();
    let mut keys = Keys::default();
    let old = setup(path, None, &mut keys);
    let new = old.rotate_for_tests(None).unwrap();
    let mut hook = no_failure;
    let mut c = Coordinator::new(path, &mut keys, &mut hook);
    c.begin_rotation(&old, &new).unwrap();
    // The rollback is a hard link: unlink before substituting independent data.
    fs::remove_file(path.join(name)).unwrap();
    fs::write(path.join(name), b"unexpected file").unwrap();
    let result = c.resume_change(None, None);
    assert!(matches!(result, Err(Error::ReconciliationFailed)));
    assert_eq!(fs::read(path.join(name)).unwrap(), b"unexpected file");
    drop(c);
    assert!(keys.get(&identity(&old)).unwrap().is_some());
  }
}

#[test]
fn replacement_requires_intact_rollback_before_overwriting_source() {
  for replacement in [false, true] {
    for corrupt in [false, true] {
      let directory = tempfile::tempdir().unwrap();
      let path = directory.path();
      let mut keys = Keys::default();
      let old = setup(path, None, &mut keys);
      let mut hook = no_failure;
      let mut c = Coordinator::new(path, &mut keys, &mut hook);
      if replacement {
        let foreign = Vault::create_for_tests(records(), None).unwrap();
        c.begin_foreign_replacement(&old, &foreign, None, true)
          .unwrap();
      } else {
        let new = old.rotate_for_tests(None).unwrap();
        c.begin_rotation(&old, &new).unwrap();
      }
      // Unlink first: rollback and active share an inode before activation.
      fs::remove_file(path.join(ROLLBACK)).unwrap();
      if corrupt {
        fs::write(path.join(ROLLBACK), b"unrelated content").unwrap();
      }
      let active = fs::read(path.join(ACTIVE)).unwrap();
      let staged = fs::read(path.join(STAGED)).unwrap();
      let journal = c.load().unwrap();
      assert!(matches!(
        c.resume_change(None, None),
        Err(Error::ReconciliationFailed)
      ));
      assert_eq!(active, fs::read(path.join(ACTIVE)).unwrap());
      assert_eq!(staged, fs::read(path.join(STAGED)).unwrap());
      assert_eq!(journal, c.load().unwrap());
      assert_eq!(journal.phase, Phase::ReplaceIntent);
      drop(c);
      assert!(keys.get(&identity(&old)).unwrap().is_some());
      assert_eq!(keys.entries.len(), 2);
    }
  }
}

#[test]
fn preinstall_rotation_recovery_retries_credential_reads_and_refuses_lost_verified_key() {
  for checkpoint in ["beforeChangeCredentialGet", "afterChangeCredentialGet"] {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path();
    let mut keys = Keys::default();
    let old = setup(path, None, &mut keys);
    let new = old.rotate_for_tests(None).unwrap();
    let mut hook = |name| {
      if name == "afterCredentialVerify" {
        Err(Error::Interrupted)
      } else {
        Ok(())
      }
    };
    assert!(matches!(
      Coordinator::new(path, &mut keys, &mut hook).begin_rotation(&old, &new),
      Err(Error::Interrupted)
    ));
    let mut hook = |name| {
      if name == checkpoint {
        Err(Error::Interrupted)
      } else {
        Ok(())
      }
    };
    assert!(matches!(
      Coordinator::new(path, &mut keys, &mut hook).resume_change(None, None),
      Err(Error::Interrupted)
    ));
    let mut hook = no_failure;
    let vault = Coordinator::new(path, &mut keys, &mut hook)
      .resume_change(None, None)
      .unwrap();
    assert_completed(path, &vault);
  }
  let directory = tempfile::tempdir().unwrap();
  let mut keys = Keys::default();
  let old = setup(directory.path(), None, &mut keys);
  let new = old.rotate_for_tests(None).unwrap();
  let mut hook = |name| {
    if name == "beforeStageWrite" {
      Err(Error::Interrupted)
    } else {
      Ok(())
    }
  };
  assert!(matches!(
    Coordinator::new(directory.path(), &mut keys, &mut hook).begin_rotation(&old, &new),
    Err(Error::Interrupted)
  ));
  keys.remove(&identity(&new)).unwrap();
  let mut hook = no_failure;
  assert!(matches!(
    Coordinator::new(directory.path(), &mut keys, &mut hook).resume_change(None, None),
    Err(Error::CredentialMissing)
  ));
  assert_eq!(keys.entries.len(), 1);
}

#[test]
fn deleted_tombstone_creation_checks_entire_cleanup_inventory() {
  let directory = tempfile::tempdir().unwrap();
  let path = directory.path();
  let mut keys = Keys::default();
  let old = setup(path, None, &mut keys);
  let new = old.rotate_for_tests(None).unwrap();
  let mut hook = no_failure;
  let mut c = Coordinator::new(path, &mut keys, &mut hook);
  c.begin_rotation(&old, &new).unwrap();
  c.begin_delete(true).unwrap();
  drop(c);
  keys.set(&identity(&new), new.credential_key()).unwrap();
  let fresh = Vault::create_for_tests(records(), None).unwrap();
  assert!(matches!(
    Coordinator::new(path, &mut keys, &mut hook).begin_create(&fresh),
    Err(Error::Conflict)
  ));
  keys.remove(&identity(&new)).unwrap();
  Coordinator::new(path, &mut keys, &mut hook)
    .begin_create(&fresh)
    .unwrap();
}

#[test]
fn production_password_rotation_uses_fixed_argon2_parameters() {
  let directory = tempfile::tempdir().unwrap();
  let mut keys = Keys::default();
  let old = Vault::create(records(), Some("old")).unwrap();
  let new = old.rotate(Some("new")).unwrap();
  let mut hook = no_failure;
  let mut c = Coordinator::new(directory.path(), &mut keys, &mut hook);
  c.begin_create(&old).unwrap();
  c.resume(Some("old"), &mut source).unwrap();
  c.begin_rotation(&old, &new).unwrap();
  let opened = c.resume_change(Some("old"), Some("new")).unwrap();
  assert_completed(directory.path(), &opened);
  let bytes = fs::read(directory.path().join(ACTIVE)).unwrap();
  assert!(Envelope::read(bytes.as_slice())
    .unwrap()
    .unlock_password("old")
    .is_err());
  assert!(Envelope::read(bytes.as_slice())
    .unwrap()
    .unlock_password("new")
    .unwrap()
    .records
    .same_as(&old.records));
}

#[test]
fn interrupted_foreign_replacement_needs_explicit_content_resubmission() {
  let directory = tempfile::tempdir().unwrap();
  let path = directory.path();
  let mut keys = Keys::default();
  let old = setup(path, None, &mut keys);
  let foreign = Vault::create_for_tests(records(), None).unwrap();
  let mut hook = |name| {
    if name == "beforeStageWrite" {
      Err(Error::Interrupted)
    } else {
      Ok(())
    }
  };
  assert!(matches!(
    Coordinator::new(path, &mut keys, &mut hook)
      .begin_foreign_replacement(&old, &foreign, None, true),
    Err(Error::Interrupted)
  ));
  let before = fs::read(path.join(ACTIVE)).unwrap();
  let mut hook = no_failure;
  let mut c = Coordinator::new(path, &mut keys, &mut hook);
  assert!(matches!(
    c.resume_change(None, None),
    Err(Error::NeedsPreparation)
  ));
  assert_eq!(before, fs::read(path.join(ACTIVE)).unwrap());
  assert!(matches!(
    c.prepare_foreign_replacement(&old, &foreign, None, false),
    Err(Error::ConfirmationRequired)
  ));
  c.prepare_foreign_replacement(&old, &foreign, None, true)
    .unwrap();
  let vault = c.resume_change(None, None).unwrap();
  assert_completed(path, &vault);
}

#[test]
fn deleted_tombstone_creation_refuses_restored_local_artifacts() {
  for name in crate::vault_transaction::changes::LOCAL_ARTIFACTS
    .iter()
    .chain(crate::vault_fs::MIGRATION_COPY_FILES.iter())
  {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path();
    let mut keys = Keys::default();
    setup(path, None, &mut keys);
    let mut hook = no_failure;
    let mut c = Coordinator::new(path, &mut keys, &mut hook);
    c.begin_delete(true).unwrap();
    fs::write(path.join(name), b"restored stale data").unwrap();
    let vault = Vault::create_for_tests(records(), None).unwrap();
    assert!(
      matches!(c.begin_create(&vault), Err(Error::Conflict)),
      "{name}"
    );
    assert_eq!(fs::read(path.join(name)).unwrap(), b"restored stale data");
  }
}
