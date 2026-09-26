//! Read-only startup classification, deliberately not connected to IPC yet.
//! No credentials, KDF, decryption, file writes, or automatic reconciliation.
//! Header/journal identity is untrusted: these results guide prompts only.
//! The coordinator must authenticate and complete a transaction before edits.
use std::{
  fs::{self, File},
  io::Read,
  path::Path,
};

use crate::{
  vault_file::{self, Envelope, Protection},
  vault_journal::{self, Identity, Operation, Phase},
  vault_transaction,
};

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Error {
  Io,
  Envelope(vault_file::Error),
  Journal(vault_journal::Error),
  IdentityMismatch,
  ReconciliationFailed,
  MissingVault,
  SourceChanged,
  CorruptLegacy,
  UnsupportedLegacy,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Backend {
  StrongholdV2,
  StrongholdV3,
  FileV1,
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Lifecycle {
  /// Only explicit creation may proceed. Never inferred from missing active data.
  New,
  Legacy,
  /// The source remains authoritative; this is not fallback after activation.
  LegacyMigrationPending,
  TransactionPending,
  Active,
  Deleting,
  Deleted,
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) struct Metadata {
  pub(crate) lifecycle: Lifecycle,
  pub(crate) backend: Option<Backend>,
  /// None for legacy: only an unlock can discover legacy protection. Never use
  /// the old frontend isPasswordSet preference as backend truth.
  pub(crate) identity_hint: Option<Identity>,
  pub(crate) operation: Option<Operation>,
  pub(crate) phase: Option<Phase>,
}

// No "unlocked" or "credential unavailable" inference here: those facts belong
// to the authenticated runtime/credential adapter, not filesystem inspection.
// In particular CredentialStageIntent alone does not prove a deferred migration.
impl Metadata {
  fn new(lifecycle: Lifecycle, backend: Option<Backend>, identity_hint: Option<Identity>) -> Self {
    Self {
      lifecycle,
      backend,
      identity_hint,
      operation: None,
      phase: None,
    }
  }
}

fn open_regular(path: &Path) -> Result<Option<File>, Error> {
  match fs::symlink_metadata(path) {
    Ok(metadata) if metadata.is_file() => {}
    Ok(_) => return Err(Error::ReconciliationFailed),
    Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
    Err(_) => return Err(Error::Io),
  }
  // The vault mutex serializes app writes; local filesystem replacement races
  // are not an authentication boundary. Authenticated open rechecks identity.
  File::open(path).map(Some).map_err(|_| Error::Io)
}

fn identity_hint(path: &Path) -> Result<Option<Identity>, Error> {
  let Some(mut file) = open_regular(path)? else {
    return Ok(None);
  };
  let length = file.metadata().map_err(|_| Error::Io)?.len();
  let (protection, vault_id, key_generation) =
    Envelope::inspect(&mut file, length).map_err(Error::Envelope)?;
  Ok(Some(Identity {
    vault_id,
    key_generation,
    credential: protection == Protection::Credential,
  }))
}

fn legacy_backend(path: &Path) -> Result<Option<Backend>, Error> {
  let Some(mut file) = open_regular(path)? else {
    return Ok(None);
  };
  let mut header = [0; 7];
  file.read_exact(&mut header).map_err(|error| {
    if error.kind() == std::io::ErrorKind::UnexpectedEof {
      Error::CorruptLegacy
    } else {
      Error::Io
    }
  })?;
  if &header[..5] != b"PARTI" {
    return Err(Error::CorruptLegacy);
  }
  match &header {
    b"PARTI\x02\x00" => Ok(Some(Backend::StrongholdV2)),
    b"PARTI\x03\x00" => Ok(Some(Backend::StrongholdV3)),
    _ => Err(Error::UnsupportedLegacy),
  }
}

fn require_fingerprint(path: &Path, expected: Option<[u8; 32]>) -> Result<(), Error> {
  let expected = expected.ok_or(Error::ReconciliationFailed)?;
  if vault_transaction::fingerprint(path).map_err(fingerprint_error)? != expected {
    return Err(Error::SourceChanged);
  }
  Ok(())
}

fn fingerprint_error(error: vault_transaction::Error) -> Error {
  match error {
    vault_transaction::Error::SourceChanged => Error::SourceChanged,
    vault_transaction::Error::Io => Error::Io,
    // A directory/symlink is an inconsistent artifact, not changed contents.
    _ => Error::ReconciliationFailed,
  }
}

pub(crate) fn inspect(directory: &Path) -> Result<Metadata, Error> {
  let journal = vault_journal::read(directory).map_err(Error::Journal)?;
  // Deletion denies access even if old files are corrupt or still present.
  // Deleted does not certify cleanup; explicit create checks residual files/keys.
  if let Some(journal) = journal
    .as_ref()
    .filter(|j| j.operation == Operation::Delete)
  {
    return Ok(Metadata {
      lifecycle: if journal.phase == Phase::Deleted {
        Lifecycle::Deleted
      } else {
        Lifecycle::Deleting
      },
      backend: None,
      identity_hint: None,
      operation: Some(journal.operation),
      phase: Some(journal.phase),
    });
  }
  let active = identity_hint(&directory.join("vault.tauthy"))?;
  let Some(journal) = journal else {
    // A valid file with no local identity record is not a new vault. Do not
    // auto-adopt it or import it implicitly; explicit recovery is required.
    if active.is_some() {
      return Err(Error::ReconciliationFailed);
    }
    for name in [
      "vault.pending.tauthy",
      "vault.rollback.tauthy",
      "vault.stronghold.retired",
    ]
    .iter()
    .chain(crate::vault_fs::MIGRATION_COPY_FILES.iter())
    {
      if open_regular(&directory.join(name))?.is_some() {
        return Err(Error::ReconciliationFailed);
      }
    }
    let backend = legacy_backend(&directory.join("vault.stronghold"))?;
    if backend.is_none() {
      for name in [
        "vault.stronghold.backup",
        "vault.stronghold.v2-backup",
        "vault.stronghold.migrating",
        "vault.stronghold.password-migrating",
      ] {
        if open_regular(&directory.join(name))?.is_some() {
          return Err(Error::ReconciliationFailed);
        }
      }
    }
    return Ok(Metadata::new(
      if backend.is_some() {
        Lifecycle::Legacy
      } else {
        Lifecycle::New
      },
      backend,
      None,
    ));
  };
  journal
    .startup_gate(active.as_ref())
    .map_err(|error| match error {
      vault_journal::Error::IdentityMismatch => Error::IdentityMismatch,
      vault_journal::Error::MissingVault => Error::MissingVault,
      vault_journal::Error::ReconciliationFailed => Error::ReconciliationFailed,
      other => Error::Journal(other),
    })?;
  // A change always starts from an incumbent active file. A rollback copy is
  // recovery material, not an alternate active vault, even in early phases.
  if active.is_none() && matches!(journal.operation, Operation::Rotate | Operation::Replace) {
    return Err(Error::MissingVault);
  }
  if matches!(journal.operation, Operation::Rotate | Operation::Replace)
    && matches!(
      journal.phase,
      Phase::Prepared
        | Phase::CredentialStageIntent
        | Phase::CredentialVerified
        | Phase::FilePrepareIntent
    )
  {
    require_fingerprint(&directory.join("vault.tauthy"), journal.source_fingerprint)?;
  }
  if active.is_some()
    && matches!(journal.operation, Operation::Create | Operation::Migrate)
    && matches!(
      journal.phase,
      Phase::Prepared
        | Phase::CredentialStageIntent
        | Phase::CredentialVerified
        | Phase::FilePrepareIntent
    )
  {
    return Err(Error::ReconciliationFailed);
  }

  let staged = if journal.phase == Phase::Completed {
    // Cleanup of a damaged stray staged file belongs to the coordinator's
    // StagedCleanupFailed recovery, never active-vault corruption at startup.
    None
  } else {
    identity_hint(&directory.join("vault.pending.tauthy"))?
  };
  if staged
    .as_ref()
    .is_some_and(|id| Some(id) != journal.target.as_ref())
  {
    return Err(Error::IdentityMismatch);
  }
  if journal.phase == Phase::InstallIntent && active.is_none() && staged.is_none() {
    return Err(Error::MissingVault);
  }
  let source_authoritative = journal.operation == Operation::Migrate && active.is_none();
  let (lifecycle, backend, hint) = if source_authoritative {
    require_fingerprint(
      &directory.join("vault.stronghold"),
      journal.source_fingerprint,
    )?;
    (
      Lifecycle::LegacyMigrationPending,
      legacy_backend(&directory.join("vault.stronghold"))?,
      None,
    )
  } else if journal.phase == Phase::Completed {
    (Lifecycle::Active, Some(Backend::FileV1), active)
  } else {
    // During rotation the active source's protection wins over the target's:
    // ask for the password needed for the artifact actually present.
    (
      Lifecycle::TransactionPending,
      active.as_ref().or(staged.as_ref()).map(|_| Backend::FileV1),
      active.or(staged).or(journal.target.clone()),
    )
  };
  Ok(Metadata {
    lifecycle,
    backend,
    identity_hint: hint,
    operation: Some(journal.operation),
    phase: Some(journal.phase),
  })
}

#[cfg(test)]
#[path = "vault_metadata_tests.rs"]
mod tests;
