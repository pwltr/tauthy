use super::*;
use crate::{
  vault_file::{Records, Vault},
  vault_journal::Journal,
};
use std::io::{Cursor, Write};

fn write(directory: &Path, name: &str, bytes: &[u8]) {
  let mut file = File::create(directory.join(name)).unwrap();
  file.write_all(bytes).unwrap();
}

fn candidate(credential: bool) -> Vault {
  Vault::create_identity_for_tests(
    Records::default(),
    if credential { None } else { Some("test") },
    [1; 16],
    [2; 16],
  )
  .unwrap()
}

fn hint(vault: &Vault) -> Identity {
  let (vault_id, key_generation) = vault.identity();
  Identity {
    vault_id,
    key_generation,
    credential: vault.protection() == Protection::Credential,
  }
}

fn journal(directory: &Path, vault: &Vault, operation: Operation, phase: Phase) -> Journal {
  let journal = Journal {
    version: 1,
    transaction_id: [3; 16],
    operation,
    phase,
    source_fingerprint: if operation == Operation::Migrate {
      Some(vault_transaction::fingerprint(&directory.join("vault.stronghold")).unwrap())
    } else {
      None
    },
    source_identity: None,
    target: Some(hint(vault)),
    target_fingerprint: None,
    cleanup_identities: vec![],
  };
  save_journal(directory, &journal);
  journal
}

// Write fixtures directly: read-only metadata tests work on Windows too and
// do not pretend Windows journal persistence is already supported.
fn save_journal(directory: &Path, journal: &Journal) {
  journal.validate().unwrap();
  write(
    directory,
    "vault.transaction.json",
    &serde_json::to_vec(journal).unwrap(),
  );
}

#[test]
fn new_and_legacy_protection_is_unknown() {
  let dir = tempfile::tempdir().unwrap();
  assert_eq!(inspect(dir.path()).unwrap().lifecycle, Lifecycle::New);
  for (version, backend) in [(2, Backend::StrongholdV2), (3, Backend::StrongholdV3)] {
    write(
      dir.path(),
      "vault.stronghold",
      &[b'P', b'A', b'R', b'T', b'I', version, 0],
    );
    let metadata = inspect(dir.path()).unwrap();
    assert_eq!(metadata.lifecycle, Lifecycle::Legacy);
    assert_eq!(metadata.backend, Some(backend));
    assert_eq!(metadata.identity_hint, None);
  }
}

#[test]
fn active_is_a_prompt_hint_not_authentication() {
  for credential in [false, true] {
    let dir = tempfile::tempdir().unwrap();
    let vault = candidate(credential);
    let mut bytes = vault.seal().unwrap();
    *bytes.last_mut().unwrap() ^= 1; // Auth fails, but syntactic prompt inspection succeeds.
    write(dir.path(), "vault.tauthy", &bytes);
    journal(dir.path(), &vault, Operation::Create, Phase::Completed);
    let before = fs::read(dir.path().join("vault.transaction.json")).unwrap();
    let metadata = inspect(dir.path()).unwrap();
    assert_eq!(metadata.lifecycle, Lifecycle::Active);
    assert_eq!(metadata.identity_hint, Some(hint(&vault)));
    assert_eq!(fs::read(dir.path().join("vault.tauthy")).unwrap(), bytes);
    assert_eq!(
      fs::read(dir.path().join("vault.transaction.json")).unwrap(),
      before
    );
  }
}

#[test]
fn missing_completed_vault_never_falls_back_to_legacy() {
  let dir = tempfile::tempdir().unwrap();
  write(dir.path(), "vault.stronghold", b"PARTI\x03\x00");
  journal(
    dir.path(),
    &candidate(true),
    Operation::Migrate,
    Phase::Completed,
  );
  assert_eq!(inspect(dir.path()), Err(Error::MissingVault));
}

#[test]
fn deferred_candidate_does_not_claim_credential_failure() {
  let dir = tempfile::tempdir().unwrap();
  write(dir.path(), "vault.stronghold", b"PARTI\x02\x00");
  journal(
    dir.path(),
    &candidate(true),
    Operation::Migrate,
    Phase::CredentialStageIntent,
  );
  let metadata = inspect(dir.path()).unwrap();
  assert_eq!(metadata.lifecycle, Lifecycle::LegacyMigrationPending);
  assert_eq!(metadata.backend, Some(Backend::StrongholdV2));
  assert_eq!(metadata.identity_hint, None);
  write(dir.path(), "vault.stronghold", b"PARTI\x03\x00");
  assert_eq!(inspect(dir.path()), Err(Error::SourceChanged));
}

#[test]
fn install_intent_requires_an_existing_artifact() {
  let dir = tempfile::tempdir().unwrap();
  let vault = candidate(false);
  journal(dir.path(), &vault, Operation::Create, Phase::InstallIntent);
  assert_eq!(inspect(dir.path()), Err(Error::MissingVault));
  write(dir.path(), "vault.pending.tauthy", &vault.seal().unwrap());
  assert_eq!(
    inspect(dir.path()).unwrap().lifecycle,
    Lifecycle::TransactionPending
  );
}

#[test]
fn deletion_denies_access_without_parsing_surviving_files() {
  let dir = tempfile::tempdir().unwrap();
  write(dir.path(), "vault.tauthy", b"corrupt incumbent");
  let source = hint(&candidate(true));
  for (phase, lifecycle) in [
    (Phase::DeleteIntent, Lifecycle::Deleting),
    (Phase::Deleted, Lifecycle::Deleted),
  ] {
    save_journal(
      dir.path(),
      &Journal {
        version: 1,
        transaction_id: [3; 16],
        operation: Operation::Delete,
        phase,
        source_fingerprint: None,
        source_identity: Some(source.clone()),
        target: None,
        target_fingerprint: None,
        cleanup_identities: vec![],
      },
    );
    assert_eq!(inspect(dir.path()).unwrap().lifecycle, lifecycle);
  }
  assert_eq!(
    fs::read(dir.path().join("vault.tauthy")).unwrap(),
    b"corrupt incumbent"
  );
}

#[test]
fn no_journal_or_stray_artifacts_never_mean_new() {
  for name in [
    "vault.pending.tauthy",
    "vault.rollback.tauthy",
    "vault.stronghold.retired",
    "vault.stronghold.v2-backup",
  ] {
    let dir = tempfile::tempdir().unwrap();
    write(dir.path(), name, b"stray");
    assert_eq!(inspect(dir.path()), Err(Error::ReconciliationFailed));
  }
  let dir = tempfile::tempdir().unwrap();
  write(dir.path(), "vault.tauthy", &candidate(true).seal().unwrap());
  assert_eq!(inspect(dir.path()), Err(Error::ReconciliationFailed));
}

#[test]
fn foreign_identity_is_not_corruption() {
  let dir = tempfile::tempdir().unwrap();
  let vault = candidate(true);
  let mut bytes = vault.seal().unwrap();
  bytes[11] ^= 1;
  write(dir.path(), "vault.tauthy", &bytes);
  journal(dir.path(), &vault, Operation::Create, Phase::Completed);
  assert_eq!(inspect(dir.path()), Err(Error::IdentityMismatch));
}

#[test]
fn completed_stage_cleanup_is_not_active_corruption() {
  let dir = tempfile::tempdir().unwrap();
  let vault = candidate(true);
  write(dir.path(), "vault.tauthy", &vault.seal().unwrap());
  write(dir.path(), "vault.pending.tauthy", b"corrupt stray");
  journal(dir.path(), &vault, Operation::Create, Phase::Completed);
  assert_eq!(inspect(dir.path()).unwrap().lifecycle, Lifecycle::Active);
}

#[test]
fn rotation_prompts_for_source_not_target_protection() {
  let dir = tempfile::tempdir().unwrap();
  let source = candidate(false);
  let target =
    Vault::create_identity_for_tests(Records::default(), None, [1; 16], [4; 16]).unwrap();
  write(dir.path(), "vault.tauthy", &source.seal().unwrap());
  save_journal(
    dir.path(),
    &Journal {
      version: 1,
      transaction_id: [3; 16],
      operation: Operation::Rotate,
      phase: Phase::Prepared,
      source_fingerprint: Some(
        vault_transaction::fingerprint(&dir.path().join("vault.tauthy")).unwrap(),
      ),
      source_identity: Some(hint(&source)),
      target: Some(hint(&target)),
      target_fingerprint: None,
      cleanup_identities: vec![],
    },
  );
  assert_eq!(
    inspect(dir.path()).unwrap().identity_hint,
    Some(hint(&source))
  );
  write(dir.path(), "vault.tauthy", &source.seal().unwrap());
  assert_eq!(inspect(dir.path()), Err(Error::SourceChanged));
  fs::rename(
    dir.path().join("vault.tauthy"),
    dir.path().join("vault.rollback.tauthy"),
  )
  .unwrap();
  assert_eq!(inspect(dir.path()), Err(Error::MissingVault));
}

#[test]
fn prepared_creation_cannot_adopt_an_unexpected_active_file() {
  let dir = tempfile::tempdir().unwrap();
  let vault = candidate(true);
  journal(dir.path(), &vault, Operation::Create, Phase::Prepared);
  write(dir.path(), "vault.tauthy", &vault.seal().unwrap());
  assert_eq!(inspect(dir.path()), Err(Error::ReconciliationFailed));
}

#[test]
fn staged_identity_must_match_the_transaction() {
  let dir = tempfile::tempdir().unwrap();
  let vault = candidate(true);
  journal(dir.path(), &vault, Operation::Create, Phase::InstallIntent);
  let foreign =
    Vault::create_identity_for_tests(Records::default(), None, [7; 16], [8; 16]).unwrap();
  write(dir.path(), "vault.pending.tauthy", &foreign.seal().unwrap());
  assert_eq!(inspect(dir.path()), Err(Error::IdentityMismatch));
}

#[test]
fn unsupported_legacy_and_corrupt_journal_require_recovery() {
  let dir = tempfile::tempdir().unwrap();
  for (bytes, error) in [
    (b"PARTI\x01\x00".as_slice(), Error::UnsupportedLegacy),
    (b"PARTI\x03".as_slice(), Error::CorruptLegacy),
    (b"wrong!!".as_slice(), Error::CorruptLegacy),
  ] {
    write(dir.path(), "vault.stronghold", bytes);
    assert_eq!(inspect(dir.path()), Err(error));
  }
  write(dir.path(), "vault.transaction.json", b"{}");
  assert_eq!(
    inspect(dir.path()),
    Err(Error::Journal(vault_journal::Error::Corrupt))
  );
}

#[test]
fn fingerprint_failures_preserve_recovery_guidance() {
  assert_eq!(fingerprint_error(vault_transaction::Error::Io), Error::Io);
  assert_eq!(
    fingerprint_error(vault_transaction::Error::Conflict),
    Error::ReconciliationFailed
  );
  let dir = tempfile::tempdir().unwrap();
  let source = dir.path().join("source");
  assert_eq!(
    require_fingerprint(&source, Some([0; 32])),
    Err(Error::SourceChanged)
  );
  fs::create_dir(&source).unwrap();
  assert_eq!(
    require_fingerprint(&source, Some([0; 32])),
    Err(Error::ReconciliationFailed)
  );
  fs::remove_dir(&source).unwrap();
  write(dir.path(), "source", b"changed");
  assert_eq!(
    require_fingerprint(&source, Some([0; 32])),
    Err(Error::SourceChanged)
  );
}

#[test]
fn header_inspection_reads_only_163_bytes_and_shares_validation() {
  let vault = candidate(true);
  let bytes = vault.seal().unwrap();
  let mut reader = Cursor::new(&bytes);
  Envelope::inspect(&mut reader, bytes.len() as u64).unwrap();
  assert_eq!(reader.position(), 163);
  assert_eq!(
    Envelope::inspect(Cursor::new(&bytes), bytes.len() as u64 + 1),
    Err(vault_file::Error::Corrupt)
  );
  for offset in [0, 8, 10, 67, 154, 155, 162] {
    let mut changed = bytes.clone();
    changed[offset] ^= 0xff;
    assert!(Envelope::inspect(Cursor::new(&changed), changed.len() as u64).is_err());
    assert!(Envelope::read(Cursor::new(&changed)).is_err());
  }
}

#[cfg(unix)]
#[test]
fn symlinks_are_not_vaults() {
  let dir = tempfile::tempdir().unwrap();
  write(dir.path(), "target", b"PARTI\x03\x00");
  std::os::unix::fs::symlink(
    dir.path().join("target"),
    dir.path().join("vault.stronghold"),
  )
  .unwrap();
  assert_eq!(inspect(dir.path()), Err(Error::ReconciliationFailed));
}
