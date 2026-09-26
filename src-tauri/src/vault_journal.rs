//! Durable transaction metadata only. Does not perform migration or key lookup.
use std::{
  fs::{self, File},
  io::Read,
  path::Path,
};

use serde::{Deserialize, Serialize};
#[cfg(unix)]
use std::io::Write;

const MAX_JOURNAL: u64 = 16 * 1024;
const JOURNAL_NAME: &str = "vault.transaction.json";

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Error {
  Unsupported,
  Corrupt,
  Io,
  IdentityMismatch,
  ReconciliationFailed,
  MissingVault,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum Operation {
  Migrate,
  Create,
  Rotate,
  Replace,
  Delete,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum Phase {
  Prepared,
  CredentialStageIntent,
  CredentialVerified,
  FilePrepareIntent,
  InstallIntent,
  InstalledVerified,
  RetireIntent,
  Retired,
  ReplaceIntent,
  Activated,
  CleanupIntent,
  Completed,
  DeleteIntent,
  Deleted,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Identity {
  pub(crate) vault_id: [u8; 16],
  pub(crate) key_generation: [u8; 16],
  pub(crate) credential: bool,
}

impl Identity {
  /// No journal-supplied service names or paths; only fixed-size hex identifiers.
  pub(crate) fn credential_selector(&self, development: bool) -> Option<(&'static str, String)> {
    if !self.credential {
      return None;
    }
    let service = if development {
      "tauthy-dev.local-vault.v1"
    } else {
      "tauthy.local-vault.v1"
    };
    let account = format!(
      "{}:{}",
      data_encoding::HEXLOWER.encode(&self.vault_id),
      data_encoding::HEXLOWER.encode(&self.key_generation)
    );
    Some((service, account))
  }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Journal {
  pub(crate) version: u8,
  pub(crate) transaction_id: [u8; 16],
  pub(crate) operation: Operation,
  pub(crate) phase: Phase,
  pub(crate) source_fingerprint: Option<[u8; 32]>,
  pub(crate) source_identity: Option<Identity>,
  pub(crate) target: Option<Identity>,
  #[serde(default)]
  pub(crate) target_fingerprint: Option<[u8; 32]>,
  #[serde(default)]
  pub(crate) cleanup_identities: Vec<Identity>,
}

impl Journal {
  /// Enforces ordering only; the coordinator must also verify each effect.
  /// Authentication and durable-effect evidence are not journal assertions.
  pub(crate) fn advance(&mut self, next: Phase) -> Result<(), Error> {
    self.validate()?;
    let expected = match self.phase {
      Phase::Prepared if self.target.as_ref().is_some_and(|id| id.credential) => {
        Phase::CredentialStageIntent
      }
      Phase::Prepared | Phase::CredentialVerified => Phase::FilePrepareIntent,
      Phase::CredentialStageIntent => Phase::CredentialVerified,
      Phase::FilePrepareIntent => match self.operation {
        Operation::Migrate | Operation::Create => Phase::InstallIntent,
        Operation::Rotate | Operation::Replace => Phase::ReplaceIntent,
        Operation::Delete => return Err(Error::ReconciliationFailed),
      },
      Phase::InstallIntent => Phase::InstalledVerified,
      Phase::InstalledVerified if self.operation == Operation::Migrate => Phase::RetireIntent,
      Phase::InstalledVerified | Phase::Retired | Phase::CleanupIntent => Phase::Completed,
      Phase::RetireIntent => Phase::Retired,
      Phase::ReplaceIntent => Phase::Activated,
      Phase::Activated => Phase::CleanupIntent,
      Phase::DeleteIntent => Phase::Deleted,
      Phase::Completed | Phase::Deleted => return Err(Error::ReconciliationFailed),
    };
    if next != expected {
      return Err(Error::ReconciliationFailed);
    }
    let mut candidate = self.clone();
    candidate.phase = next;
    candidate.validate()?;
    *self = candidate;
    Ok(())
  }

  pub(crate) fn validate(&self) -> Result<(), Error> {
    if self.version != 1 {
      return Err(Error::Unsupported);
    }
    if self.cleanup_identities.len() > 8
      || self
        .cleanup_identities
        .iter()
        .any(|identity| !identity.credential)
      || (self.operation != Operation::Delete && !self.cleanup_identities.is_empty())
    {
      return Err(Error::Corrupt);
    }
    for (index, identity) in self.cleanup_identities.iter().enumerate() {
      if self.cleanup_identities[..index].contains(identity) {
        return Err(Error::Corrupt);
      }
    }
    if matches!(self.operation, Operation::Rotate | Operation::Replace)
      && matches!(
        self.phase,
        Phase::ReplaceIntent | Phase::Activated | Phase::CleanupIntent | Phase::Completed
      )
      && self.target_fingerprint.is_none()
    {
      return Err(Error::Corrupt);
    }
    match self.operation {
      Operation::Migrate if self.source_fingerprint.is_none() || self.source_identity.is_some() => {
        return Err(Error::Corrupt)
      }
      Operation::Create if self.source_fingerprint.is_some() || self.source_identity.is_some() => {
        return Err(Error::Corrupt)
      }
      Operation::Rotate | Operation::Replace
        if self.source_fingerprint.is_none() || self.source_identity.is_none() =>
      {
        return Err(Error::Corrupt)
      }
      Operation::Delete if self.source_identity.is_none() => return Err(Error::Corrupt),
      _ => {}
    }
    if self.operation != Operation::Delete && self.target.is_none() {
      return Err(Error::Corrupt);
    }
    if self.operation == Operation::Delete && self.target.is_some() {
      return Err(Error::Corrupt);
    }
    if self.operation == Operation::Rotate {
      let source = self.source_identity.as_ref().ok_or(Error::Corrupt)?;
      let target = self.target.as_ref().ok_or(Error::Corrupt)?;
      if source.vault_id != target.vault_id || source.key_generation == target.key_generation {
        return Err(Error::Corrupt);
      }
    }
    if self.operation == Operation::Replace {
      let source = self.source_identity.as_ref().ok_or(Error::Corrupt)?;
      let target = self.target.as_ref().ok_or(Error::Corrupt)?;
      if source.vault_id == target.vault_id || source.key_generation == target.key_generation {
        return Err(Error::Corrupt);
      }
    }
    if !matches!(self.operation, Operation::Rotate | Operation::Replace)
      && self.target_fingerprint.is_some()
    {
      return Err(Error::Corrupt);
    }
    let valid = match self.operation {
      Operation::Delete => matches!(self.phase, Phase::DeleteIntent | Phase::Deleted),
      Operation::Create => matches!(
        self.phase,
        Phase::Prepared
          | Phase::CredentialStageIntent
          | Phase::CredentialVerified
          | Phase::FilePrepareIntent
          | Phase::InstallIntent
          | Phase::InstalledVerified
          | Phase::Completed
      ),
      Operation::Migrate => matches!(
        self.phase,
        Phase::Prepared
          | Phase::CredentialStageIntent
          | Phase::CredentialVerified
          | Phase::FilePrepareIntent
          | Phase::InstallIntent
          | Phase::InstalledVerified
          | Phase::RetireIntent
          | Phase::Retired
          | Phase::Completed
      ),
      Operation::Rotate | Operation::Replace => matches!(
        self.phase,
        Phase::Prepared
          | Phase::CredentialStageIntent
          | Phase::CredentialVerified
          | Phase::FilePrepareIntent
          | Phase::ReplaceIntent
          | Phase::Activated
          | Phase::CleanupIntent
          | Phase::Completed
      ),
    };
    if !valid {
      return Err(Error::Corrupt);
    }
    if matches!(
      self.phase,
      Phase::CredentialStageIntent | Phase::CredentialVerified
    ) && !self.target.as_ref().is_some_and(|id| id.credential)
    {
      return Err(Error::Corrupt);
    }
    Ok(())
  }

  /// Non-authenticating gate only: this never advances phases or opens a vault.
  /// The coordinator must inspect temporary artifacts at InstallIntent: if
  /// both active and staged files are absent, require explicit recovery rather
  /// than rebuilding from legacy data. A returned unlock gate is not permission
  /// to recreate files or skip authenticated reconciliation.
  pub(crate) fn startup_gate(&self, active: Option<&Identity>) -> Result<Gate, Error> {
    self.validate()?;
    if matches!(self.phase, Phase::DeleteIntent | Phase::Deleted) {
      return Ok(Gate::Deletion);
    }
    if let Some(active) = active {
      let target_match = Some(active) == self.target.as_ref();
      let source_match = Some(active) == self.source_identity.as_ref();
      let replacement_pending = matches!(self.operation, Operation::Rotate | Operation::Replace)
        && !matches!(
          self.phase,
          Phase::Activated | Phase::CleanupIntent | Phase::Completed
        );
      if !target_match && !(source_match && replacement_pending) {
        return Err(Error::IdentityMismatch);
      }
    } else if matches!(
      self.phase,
      Phase::InstalledVerified
        | Phase::RetireIntent
        | Phase::Retired
        | Phase::Activated
        | Phase::CleanupIntent
        | Phase::Completed
    ) {
      return Err(Error::MissingVault);
    } else if self.phase == Phase::ReplaceIntent {
      return Err(Error::ReconciliationFailed);
    }
    Ok(if self.target.as_ref().is_some_and(|id| id.credential) {
      Gate::CredentialUnlock
    } else {
      Gate::PendingUnlock
    })
  }
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Gate {
  PendingUnlock,
  CredentialUnlock,
  Deletion,
}

pub(crate) fn read(directory: &Path) -> Result<Option<Journal>, Error> {
  let path = directory.join(JOURNAL_NAME);
  let metadata = match fs::symlink_metadata(&path) {
    Ok(metadata) => metadata,
    Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
    Err(_) => return Err(Error::Io),
  };
  if !metadata.is_file() || metadata.len() > MAX_JOURNAL {
    return Err(Error::Corrupt);
  }
  let mut bytes = Vec::new();
  File::open(path)
    .map_err(|_| Error::Io)?
    .take(MAX_JOURNAL + 1)
    .read_to_end(&mut bytes)
    .map_err(|_| Error::Io)?;
  if bytes.len() as u64 > MAX_JOURNAL {
    return Err(Error::Corrupt);
  }
  let journal: Journal = serde_json::from_slice(&bytes).map_err(|_| Error::Corrupt)?;
  journal.validate()?;
  Ok(Some(journal))
}

#[cfg(unix)]
pub(crate) fn persist(directory: &Path, journal: &Journal) -> Result<(), Error> {
  journal.validate()?;
  let bytes = serde_json::to_vec(journal).map_err(|_| Error::Corrupt)?;
  if bytes.len() as u64 > MAX_JOURNAL {
    return Err(Error::Corrupt);
  }
  let mut temporary = tempfile::NamedTempFile::new_in(directory).map_err(|_| Error::Io)?;
  temporary.write_all(&bytes).map_err(|_| Error::Io)?;
  temporary.as_file().sync_all().map_err(|_| Error::Io)?;
  temporary
    .persist(directory.join(JOURNAL_NAME))
    .map_err(|_| Error::Io)?;
  sync_directory(directory)
}

#[cfg(unix)]
pub(crate) fn sync_directory(directory: &Path) -> Result<(), Error> {
  File::open(directory)
    .and_then(|file| file.sync_all())
    .map_err(|_| Error::Io)
}

// Fail before writing anything until the Windows durability implementation is
// available. Directory FlushFileBuffers is not a portable Unix-fsync analogue.
#[cfg(not(unix))]
pub(crate) fn persist(_directory: &Path, _journal: &Journal) -> Result<(), Error> {
  Err(Error::Unsupported)
}

#[cfg(not(unix))]
pub(crate) fn sync_directory(_directory: &Path) -> Result<(), Error> {
  Err(Error::Unsupported)
}

#[cfg(test)]
mod tests {
  use super::*;

  fn journal(credential: bool) -> Journal {
    Journal {
      version: 1,
      transaction_id: [1; 16],
      operation: Operation::Migrate,
      phase: Phase::Prepared,
      source_fingerprint: Some([2; 32]),
      source_identity: None,
      target: Some(Identity {
        vault_id: [3; 16],
        key_generation: [4; 16],
        credential,
      }),
      target_fingerprint: None,
      cleanup_identities: Vec::new(),
    }
  }

  #[test]
  #[cfg(unix)]
  fn journal_round_trip_replacement_and_terminal_marker() {
    let directory = tempfile::tempdir().unwrap();
    let mut journal = journal(false);
    assert_eq!(read(directory.path()).unwrap(), None);
    persist(directory.path(), &journal).unwrap();
    assert_eq!(read(directory.path()).unwrap(), Some(journal.clone()));
    journal.phase = Phase::Completed;
    persist(directory.path(), &journal).unwrap();
    assert_eq!(read(directory.path()).unwrap(), Some(journal));
    assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 1);
    #[cfg(unix)]
    {
      use std::os::unix::fs::PermissionsExt;
      assert_eq!(
        fs::metadata(directory.path().join(JOURNAL_NAME))
          .unwrap()
          .permissions()
          .mode()
          & 0o777,
        0o600
      );
    }
  }

  #[test]
  #[cfg(unix)]
  fn password_startup_is_read_only_and_pending_not_failed() {
    let directory = tempfile::tempdir().unwrap();
    let mut journal = journal(false);
    journal.phase = Phase::InstallIntent;
    persist(directory.path(), &journal).unwrap();
    let before = fs::read(directory.path().join(JOURNAL_NAME)).unwrap();
    assert_eq!(
      journal.startup_gate(journal.target.as_ref()).unwrap(),
      Gate::PendingUnlock
    );
    assert_eq!(
      fs::read(directory.path().join(JOURNAL_NAME)).unwrap(),
      before
    );
  }

  #[test]
  fn completed_missing_and_foreign_files_never_fall_back() {
    let mut journal = journal(false);
    journal.phase = Phase::Completed;
    assert_eq!(journal.startup_gate(None), Err(Error::MissingVault));
    let foreign = Identity {
      vault_id: [99; 16],
      key_generation: [4; 16],
      credential: false,
    };
    assert_eq!(
      journal.startup_gate(Some(&foreign)),
      Err(Error::IdentityMismatch)
    );
  }

  #[test]
  fn deletion_denies_access_even_with_surviving_file() {
    let mut journal = journal(false);
    let identity = journal.target.take().unwrap();
    journal.source_identity = Some(identity.clone());
    journal.operation = Operation::Delete;
    journal.phase = Phase::DeleteIntent;
    assert_eq!(
      journal.startup_gate(Some(&identity)).unwrap(),
      Gate::Deletion
    );
    journal.phase = Phase::Deleted;
    assert_eq!(journal.startup_gate(None).unwrap(), Gate::Deletion);
  }

  #[test]
  fn credential_selectors_are_build_and_generation_specific() {
    let journal = journal(true);
    let identity = journal.target.unwrap();
    let prod = identity.credential_selector(false).unwrap();
    let dev = identity.credential_selector(true).unwrap();
    assert_ne!(prod.0, dev.0);
    let mut rotated = identity.clone();
    rotated.key_generation = [5; 16];
    assert_ne!(prod.1, rotated.credential_selector(false).unwrap().1);
    assert_eq!(prod.1.len(), 65);
  }

  #[test]
  #[cfg(unix)]
  fn invalid_journal_is_never_installed_and_hostile_input_is_bounded() {
    let directory = tempfile::tempdir().unwrap();
    let good = journal(false);
    persist(directory.path(), &good).unwrap();
    let mut bad = good.clone();
    bad.phase = Phase::CredentialVerified;
    assert_eq!(persist(directory.path(), &bad), Err(Error::Corrupt));
    assert_eq!(read(directory.path()).unwrap(), Some(good));
    fs::write(
      directory.path().join(JOURNAL_NAME),
      vec![0; MAX_JOURNAL as usize + 1],
    )
    .unwrap();
    assert_eq!(read(directory.path()), Err(Error::Corrupt));
  }

  #[test]
  fn migration_transition_order_is_enforced_without_mutation_on_failure() {
    for credential in [false, true] {
      let mut journal = journal(credential);
      let before = journal.clone();
      assert_eq!(
        journal.advance(Phase::Completed),
        Err(Error::ReconciliationFailed)
      );
      assert_eq!(journal, before);
      if credential {
        journal.advance(Phase::CredentialStageIntent).unwrap();
        journal.advance(Phase::CredentialVerified).unwrap();
      }
      for phase in [
        Phase::FilePrepareIntent,
        Phase::InstallIntent,
        Phase::InstalledVerified,
        Phase::RetireIntent,
        Phase::Retired,
        Phase::Completed,
      ] {
        journal.advance(phase).unwrap();
      }
      let completed = journal.clone();
      assert_eq!(
        journal.advance(Phase::Prepared),
        Err(Error::ReconciliationFailed)
      );
      assert_eq!(journal, completed);
    }
  }

  #[test]
  fn rotation_and_deletion_have_separate_legal_transitions() {
    let mut journal = journal(false);
    journal.operation = Operation::Rotate;
    let mut source = journal.target.clone().unwrap();
    source.key_generation = [8; 16];
    journal.source_identity = Some(source);
    for phase in [
      Phase::FilePrepareIntent,
      Phase::ReplaceIntent,
      Phase::Activated,
      Phase::CleanupIntent,
      Phase::Completed,
    ] {
      if phase == Phase::ReplaceIntent {
        journal.target_fingerprint = Some([9; 32]);
      }
      journal.advance(phase).unwrap();
    }
    journal.operation = Operation::Delete;
    journal.target = None;
    journal.target_fingerprint = None;
    journal.phase = Phase::DeleteIntent;
    journal.advance(Phase::Deleted).unwrap();
  }

  #[test]
  fn deletion_retains_credential_selector_after_active_file_is_gone() {
    let mut journal = journal(true);
    let incumbent = journal.target.take().unwrap();
    let selector = incumbent.credential_selector(false).unwrap();
    journal.operation = Operation::Delete;
    journal.phase = Phase::DeleteIntent;
    assert_eq!(journal.validate(), Err(Error::Corrupt));
    journal.source_identity = Some(incumbent);
    journal.validate().unwrap();

    // Simulate a restart with only serialized journal metadata available.
    let bytes = serde_json::to_vec(&journal).unwrap();
    let restored: Journal = serde_json::from_slice(&bytes).unwrap();
    restored.validate().unwrap();
    assert_eq!(restored.startup_gate(None).unwrap(), Gate::Deletion);
    assert_eq!(
      restored
        .source_identity
        .unwrap()
        .credential_selector(false)
        .unwrap(),
      selector
    );
  }

  #[test]
  fn replacement_fingerprints_and_deletion_inventory_are_validated() {
    let mut change = journal(false);
    change.operation = Operation::Replace;
    change.source_identity = change.target.clone();
    assert_eq!(change.validate(), Err(Error::Corrupt));
    change.source_identity.as_mut().unwrap().vault_id = [8; 16];
    change.source_identity.as_mut().unwrap().key_generation = [9; 16];
    change.validate().unwrap();
    change.phase = Phase::ReplaceIntent;
    assert_eq!(change.validate(), Err(Error::Corrupt));
    change.target_fingerprint = Some([3; 32]);
    change.validate().unwrap();
    let mut deletion = journal(true);
    deletion.source_identity = deletion.target.take();
    deletion.operation = Operation::Delete;
    deletion.phase = Phase::DeleteIntent;
    let id = deletion.source_identity.clone().unwrap();
    deletion.cleanup_identities = vec![id.clone(), id];
    assert_eq!(deletion.validate(), Err(Error::Corrupt));
    deletion.cleanup_identities.pop();
    deletion.validate().unwrap();
    deletion.cleanup_identities[0].credential = false;
    assert_eq!(deletion.validate(), Err(Error::Corrupt));
    deletion.cleanup_identities = (0..9)
      .map(|index| Identity {
        vault_id: [index; 16],
        key_generation: [0; 16],
        credential: true,
      })
      .collect();
    assert_eq!(deletion.validate(), Err(Error::Corrupt));
  }
}
