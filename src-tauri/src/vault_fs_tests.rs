//! Windows tests require TEMP/TMP on a fixed local NTFS volume. ReFS/Dev Drive,
//! network and removable temporary directories intentionally return Unsupported.
use super::*;
use std::io::{Read, Write};

fn stage(directory: &Path, bytes: &[u8]) -> NamedTempFile {
  let mut temporary = temporary(directory).unwrap();
  temporary.write_all(bytes).unwrap();
  temporary
}

#[test]
fn persist_reopens_and_no_clobber_preserves_both_files() {
  let directory = tempfile::tempdir().unwrap();
  let target = directory.path().join("vault.pending.tauthy");
  persist(stage(directory.path(), b"original"), &target, false).unwrap();
  assert_eq!(fs::read(&target).unwrap(), b"original");
  let temporary = stage(directory.path(), b"replacement");
  assert!(persist(temporary, &target, false).is_err());
  assert_eq!(fs::read(&target).unwrap(), b"original");
  persist(stage(directory.path(), b"replacement"), &target, true).unwrap();
  assert_eq!(fs::read(&target).unwrap(), b"replacement");
}

#[test]
fn snapshot_and_install_do_not_clobber_an_incumbent() {
  let directory = tempfile::tempdir().unwrap();
  let source = directory.path().join("vault.pending.tauthy");
  let target = directory.path().join("vault.tauthy");
  persist(stage(directory.path(), b"candidate"), &source, false).unwrap();
  persist(stage(directory.path(), b"incumbent"), &target, false).unwrap();
  assert!(snapshot(&source, &target).is_err());
  assert!(install(&source, &target).is_err());
  assert_eq!(fs::read(&source).unwrap(), b"candidate");
  assert_eq!(fs::read(&target).unwrap(), b"incumbent");
  remove(&target).unwrap();
  install(&source, &target).unwrap();
  assert_eq!(fs::read(&source).unwrap(), b"candidate");
  assert_eq!(fs::read(&target).unwrap(), b"candidate");
}

#[test]
fn snapshot_preserves_source_and_replace_keeps_rollback() {
  let directory = tempfile::tempdir().unwrap();
  let active = directory.path().join("vault.tauthy");
  let rollback = directory.path().join("vault.rollback.tauthy");
  let staged = directory.path().join("vault.pending.tauthy");
  persist(stage(directory.path(), b"old"), &active, false).unwrap();
  snapshot(&active, &rollback).unwrap();
  assert_eq!(fs::read(&active).unwrap(), b"old");
  persist(stage(directory.path(), b"new"), &staged, false).unwrap();
  replace(&staged, &active).unwrap();
  assert_eq!(fs::read(&active).unwrap(), b"new");
  assert_eq!(fs::read(&rollback).unwrap(), b"old");
  assert!(!staged.exists());
}

#[test]
fn deletion_unlinks_even_with_a_surviving_read_handle() {
  let directory = tempfile::tempdir().unwrap();
  let target = directory.path().join("vault.tauthy");
  persist(stage(directory.path(), b"data"), &target, false).unwrap();
  let mut surviving = File::open(&target).unwrap();
  remove(&target).unwrap();
  assert!(!target.exists());
  let mut bytes = vec![];
  surviving.read_to_end(&mut bytes).unwrap();
  assert_eq!(bytes, b"data");
}

#[test]
fn cross_directory_moves_are_rejected_before_any_mutation() {
  let source_dir = tempfile::tempdir().unwrap();
  let target_dir = tempfile::tempdir().unwrap();
  let source = source_dir.path().join("vault.pending.tauthy");
  let target = target_dir.path().join("vault.tauthy");
  persist(stage(source_dir.path(), b"source"), &source, false).unwrap();
  for operation in [snapshot, install, replace] {
    assert_eq!(
      operation(&source, &target).unwrap_err().kind(),
      io::ErrorKind::InvalidInput
    );
    assert_eq!(fs::read(&source).unwrap(), b"source");
    assert!(!target.exists());
  }
}

#[test]
fn unicode_paths_are_supported() {
  let directory = tempfile::tempdir().unwrap();
  let nested = directory.path().join("Tauthy 测试 é");
  fs::create_dir(&nested).unwrap();
  let target = nested.join("vault.tauthy");
  persist(stage(&nested, b"test"), &target, false).unwrap();
  sync_file(&target).unwrap();
  remove(&target).unwrap();
  assert!(!target.exists());
}

#[cfg(windows)]
#[test]
fn production_guard_refuses_before_even_probing_the_directory() {
  let directory = tempfile::tempdir().unwrap();
  assert_eq!(
    windows::require_candidate(directory.path(), false)
      .unwrap_err()
      .kind(),
    io::ErrorKind::Unsupported
  );
  assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 0);
}

#[cfg(windows)]
#[test]
fn packaged_windows_effects_require_the_isolated_test_feature() {
  assert_eq!(
    windows_effects_enabled(false),
    cfg!(feature = "migration-test")
  );
  assert!(windows_effects_enabled(true));
}
