//! Protection rotation, authenticated foreign replacement and explicit deletion.
use super::*;

pub(super) const ROLLBACK: &str = "vault.rollback.tauthy";
pub(super) const LOCAL_ARTIFACTS: &[&str] = &[
  ACTIVE,
  STAGED,
  ROLLBACK,
  LEGACY,
  RETIRED,
  "vault.stronghold.backup",
  "vault.stronghold.v2-backup",
  "vault.stronghold.migrating",
  "vault.stronghold.password-migrating",
];

impl Coordinator<'_> {
  fn committed_source(&self, source: &Vault) -> Result<Journal, Error> {
    let journal = self.load()?;
    if journal.phase != Phase::Completed || journal.target.as_ref() != Some(&identity(source)) {
      return Err(Error::ReconciliationFailed);
    }
    let active = self.directory.join(ACTIVE);
    let before = fingerprint(&active)?;
    let opened = self.open_using_key(&active, source)?;
    if identity(&opened) != identity(source) || !opened.records.same_as(&source.records) {
      return Err(Error::RecordsChanged);
    }
    if fingerprint(&active)? != before {
      return Err(Error::SourceChanged);
    }
    Ok(journal)
  }

  /// Candidates must be authenticated: rotate() preserves identity and changes
  /// the key; foreign content is resealed under a fresh local identity/key.
  fn begin_change(
    &mut self,
    source: &Vault,
    target: &Vault,
    replacement: bool,
    confirmed: bool,
  ) -> Result<(), Error> {
    require_supported_durability(self.directory)?;
    if replacement && !confirmed {
      return Err(Error::ConfirmationRequired);
    }
    self.committed_source(source)?;
    if source.credential_key() == target.credential_key()
      || identity(source).key_generation == identity(target).key_generation
      || (!replacement
        && (identity(source).vault_id != identity(target).vault_id
          || !source.records.same_as(&target.records)))
      || (replacement && identity(source).vault_id == identity(target).vault_id)
    {
      return Err(Error::IdentityMismatch);
    }
    for name in [STAGED, ROLLBACK, LEGACY] {
      if regular_file(&self.directory.join(name))? {
        return Err(Error::Conflict);
      }
    }
    let mut journal = self.new_journal(identity(target), None)?;
    journal.operation = if replacement {
      Operation::Replace
    } else {
      Operation::Rotate
    };
    journal.source_fingerprint = Some(fingerprint(&self.directory.join(ACTIVE))?);
    journal.source_identity = Some(identity(source));
    self.persist(&journal)?;
    self.prepare_change(source, target)
  }

  pub(crate) fn begin_rotation(&mut self, source: &Vault, target: &Vault) -> Result<(), Error> {
    self.begin_change(source, target, false, true)
  }

  pub(crate) fn begin_foreign_replacement(
    &mut self,
    source: &Vault,
    foreign: &Vault,
    password: Option<&str>,
    confirmed: bool,
  ) -> Result<Vault, Error> {
    if !confirmed {
      return Err(Error::ConfirmationRequired);
    }
    let mut ids = [0; 32];
    SystemRandom::new().fill(&mut ids).map_err(|_| Error::Io)?;
    let target = (self.candidate_create)(
      foreign.records.copy()?,
      password,
      ids[..16].try_into().unwrap(),
      ids[16..].try_into().unwrap(),
    )?;
    self.begin_change(source, &target, true, true)?;
    Ok(target)
  }

  // Explicit resubmission of authenticated foreign content after a pre-install
  // crash. Never reconstruct replacement content from the incumbent vault.
  pub(crate) fn prepare_foreign_replacement(
    &mut self,
    source: &Vault,
    foreign: &Vault,
    password: Option<&str>,
    confirmed: bool,
  ) -> Result<(), Error> {
    if !confirmed {
      return Err(Error::ConfirmationRequired);
    }
    let journal = self.load()?;
    if journal.operation != Operation::Replace {
      return Err(Error::ReconciliationFailed);
    }
    let target = if regular_file(&self.directory.join(STAGED))? {
      let target = self.unlock(
        &self.directory.join(STAGED),
        journal.target.as_ref().unwrap(),
        password,
      )?;
      if !target.records.same_as(&foreign.records) {
        return Err(Error::RecordsChanged);
      }
      target
    } else {
      self.rebuild_change_candidate(&journal, foreign.records.copy()?, password)?
    };
    self.prepare_change(source, &target)
  }

  fn rebuild_change_candidate(
    &mut self,
    journal: &Journal,
    records: Records,
    password: Option<&str>,
  ) -> Result<Vault, Error> {
    let target = journal.target.as_ref().unwrap();
    if target.credential {
      self.point("beforeChangeCredentialGet")?;
      let key = self.credentials.get(target)?;
      self.point("afterChangeCredentialGet")?;
      match key {
        Some(key) => Ok(Vault::restore_credential_candidate(
          records,
          target.vault_id,
          target.key_generation,
          key,
        )?),
        None
          if matches!(
            journal.phase,
            Phase::Prepared | Phase::CredentialStageIntent
          ) =>
        {
          Ok((self.candidate_create)(
            records,
            None,
            target.vault_id,
            target.key_generation,
          )?)
        }
        None => Err(Error::CredentialMissing),
      }
    } else {
      Ok((self.candidate_create)(
        records,
        Some(password.ok_or(Error::PendingUnlock)?),
        target.vault_id,
        target.key_generation,
      )?)
    }
  }

  pub(crate) fn prepare_change(&mut self, source: &Vault, target: &Vault) -> Result<(), Error> {
    require_supported_durability(self.directory)?;
    let mut journal = self.load()?;
    if !matches!(journal.operation, Operation::Rotate | Operation::Replace)
      || journal.source_identity.as_ref() != Some(&identity(source))
      || journal.target.as_ref() != Some(&identity(target))
    {
      return Err(Error::IdentityMismatch);
    }
    if matches!(
      journal.phase,
      Phase::ReplaceIntent | Phase::Activated | Phase::CleanupIntent | Phase::Completed
    ) {
      return Err(Error::ReconciliationFailed);
    }
    let active = self.directory.join(ACTIVE);
    if Some(fingerprint(&active)?) != journal.source_fingerprint {
      return Err(Error::SourceChanged);
    }
    let opened = self.open_using_key(&active, source)?;
    if !opened.records.same_as(&source.records) {
      return Err(Error::RecordsChanged);
    }
    if journal.operation == Operation::Rotate && !source.records.same_as(&target.records) {
      return Err(Error::RecordsChanged);
    }
    if source.credential_key() == target.credential_key() {
      return Err(Error::IdentityMismatch);
    }
    if regular_file(&self.directory.join(STAGED))? {
      if journal.phase != Phase::FilePrepareIntent {
        return Err(Error::ReconciliationFailed);
      }
      let staged = self.open_using_key(&self.directory.join(STAGED), target)?;
      if !staged.records.same_as(&target.records) {
        return Err(Error::RecordsChanged);
      }
    } else {
      self.stage_credentials(&mut journal, target)?;
      self.write_stage(target)?;
    }
    // Rollback is durable before ReplaceIntent authorizes replacement.
    let rollback = self.directory.join(ROLLBACK);
    self.point("beforeRollbackLink")?;
    if !regular_file(&rollback)? {
      vault_fs::snapshot(&active, &rollback).map_err(install_error)?;
    }
    if Some(fingerprint(&rollback)?) != journal.source_fingerprint {
      return Err(Error::SourceChanged);
    }
    self.point("afterRollbackLink")?;
    self.point("beforeRollbackSync")?;
    vault_fs::sync_file(&rollback).map_err(|_| Error::Io)?;
    self.point("afterRollbackSync")?;
    self.sync()?;
    journal.target_fingerprint = Some(fingerprint(&self.directory.join(STAGED))?);
    self.advance(&mut journal, Phase::ReplaceIntent)
  }

  /// Both passwords may be needed before activation. After durable Activated,
  /// only target authentication is required; old credentials may already be gone.
  pub(crate) fn resume_change(
    &mut self,
    source_password: Option<&str>,
    target_password: Option<&str>,
  ) -> Result<Vault, Error> {
    require_supported_durability(self.directory)?;
    let mut journal = self.load()?;
    if !matches!(journal.operation, Operation::Rotate | Operation::Replace) {
      return Err(Error::ReconciliationFailed);
    }
    let source = journal.source_identity.as_ref().unwrap().clone();
    let target = journal.target.as_ref().unwrap().clone();
    let active = self.directory.join(ACTIVE);
    let staged = self.directory.join(STAGED);
    let rollback = self.directory.join(ROLLBACK);
    if !regular_file(&active)? {
      return Err(Error::MissingVault);
    }
    if journal.phase == Phase::Completed {
      let vault = self.unlock(&active, &target, target_password)?;
      self.cleanup_stage(&vault)?;
      return Ok(vault);
    }
    if matches!(
      journal.phase,
      Phase::Prepared
        | Phase::CredentialStageIntent
        | Phase::CredentialVerified
        | Phase::FilePrepareIntent
    ) {
      if Some(fingerprint(&active)?) != journal.source_fingerprint {
        return Err(Error::SourceChanged);
      }
      let old = self.unlock(&active, &source, source_password)?;
      let candidate = if regular_file(&staged)? {
        if journal.phase != Phase::FilePrepareIntent {
          return Err(Error::ReconciliationFailed);
        }
        self.unlock(&staged, &target, target_password)?
      } else if journal.operation == Operation::Rotate {
        self.rebuild_change_candidate(&journal, old.records.copy()?, target_password)?
      } else {
        return Err(Error::NeedsPreparation);
      };
      self.prepare_change(&old, &candidate)?;
      return self.resume_change(source_password, target_password);
    }
    if journal.phase == Phase::ReplaceIntent {
      let current = fingerprint(&active)?;
      let is_source = Some(current) == journal.source_fingerprint;
      let is_target = Some(current) == journal.target_fingerprint;
      if !is_source && !is_target {
        return Err(Error::ReconciliationFailed);
      }
      let source_path = if is_source { &active } else { &rollback };
      if !regular_file(source_path)? {
        return Err(Error::MissingVault);
      }
      if Some(fingerprint(source_path)?) != journal.source_fingerprint {
        return Err(Error::ReconciliationFailed);
      }
      // Authenticate both artifacts before writes/cleanup, including on retry.
      let old = self.unlock(source_path, &source, source_password)?;
      let target_path = if is_target { &active } else { &staged };
      if !regular_file(target_path)? {
        return Err(Error::MissingVault);
      }
      if Some(fingerprint(target_path)?) != journal.target_fingerprint {
        return Err(Error::ReconciliationFailed);
      }
      let new = self.unlock(target_path, &target, target_password)?;
      if journal.operation == Operation::Rotate && !old.records.same_as(&new.records) {
        return Err(Error::RecordsChanged);
      }
      if is_source {
        // ReplaceIntent promised a durable safety copy. Recheck it before
        // destroying the active source, even if external cleanup interfered.
        if !regular_file(&rollback)? || Some(fingerprint(&rollback)?) != journal.source_fingerprint
        {
          return Err(Error::ReconciliationFailed);
        }
        // Same-directory rename atomically replaces, keeping rollback intact.
        self.point("beforeReplace")?;
        vault_fs::replace(&staged, &active).map_err(|_| Error::Io)?;
        self.point("afterReplace")?;
      }
      self.sync()?;
      self.point("beforeReplacementVerify")?;
      let installed = self.unlock(&active, &target, target_password)?;
      if !installed.records.same_as(&new.records) {
        return Err(Error::RecordsChanged);
      }
      self.point("afterReplacementVerify")?;
      self.advance(&mut journal, Phase::Activated)?;
    }
    if !matches!(journal.phase, Phase::Activated | Phase::CleanupIntent) {
      return Err(Error::NeedsPreparation);
    }
    if Some(fingerprint(&active)?) != journal.target_fingerprint {
      return Err(Error::ReconciliationFailed);
    }
    let vault = self.unlock(&active, &target, target_password)?;
    if journal.phase == Phase::Activated {
      self.advance(&mut journal, Phase::CleanupIntent)?;
    }
    let rollback_exists = regular_file(&rollback)?;
    if rollback_exists && Some(fingerprint(&rollback)?) != journal.source_fingerprint {
      return Err(Error::ReconciliationFailed);
    }
    if source.credential {
      self.point("beforeOldCredentialRemove")?;
      self.credentials.remove(&source)?;
      self.point("afterOldCredentialRemove")?;
    }
    if rollback_exists {
      self.point("beforeRollbackCleanup")?;
      vault_fs::remove(&rollback).map_err(|_| Error::Io)?;
      self.point("afterRollbackCleanup")?;
    }
    self.sync()?;
    self.cleanup_stage(&vault)?;
    self.advance(&mut journal, Phase::Completed)?;
    // Retired Stronghold stays in its non-migrating filename, including foreign
    // replacement. It is an incumbent recovery snapshot, never a new source.
    Ok(vault)
  }

  /// Explicit destructive action, including recovery from missing active data.
  /// Fixed local artifacts only; never touches cloud sync or user backup files.
  pub(crate) fn begin_delete(&mut self, confirmed: bool) -> Result<(), Error> {
    require_supported_durability(self.directory)?;
    if !confirmed {
      return Err(Error::ConfirmationRequired);
    }
    let previous = self.load()?;
    if previous.operation == Operation::Delete {
      return self.resume_delete();
    }
    // Also permits explicit abandonment of an interrupted transaction. Capture
    // both selectors before replacing its journal, even if one file is missing.
    let incumbent = previous
      .source_identity
      .clone()
      .or(previous.target.clone())
      .ok_or(Error::ReconciliationFailed)?;
    let mut credentials = Vec::new();
    for id in previous
      .source_identity
      .iter()
      .chain(previous.target.iter())
      .chain(previous.cleanup_identities.iter())
    {
      if id.credential && !credentials.contains(id) {
        credentials.push(id.clone());
      }
    }
    let mut journal = previous;
    SystemRandom::new()
      .fill(&mut journal.transaction_id)
      .map_err(|_| Error::Io)?;
    journal.operation = Operation::Delete;
    journal.phase = Phase::DeleteIntent;
    journal.source_identity = Some(incumbent);
    journal.source_fingerprint = None;
    journal.target = None;
    journal.target_fingerprint = None;
    journal.cleanup_identities = credentials;
    self.persist(&journal)?;
    self.resume_delete()
  }

  pub(crate) fn resume_delete(&mut self) -> Result<(), Error> {
    require_supported_durability(self.directory)?;
    let mut journal = self.load()?;
    if journal.operation != Operation::Delete {
      return Err(Error::ReconciliationFailed);
    }
    if journal.phase == Phase::Deleted {
      return Ok(());
    }
    if journal.phase != Phase::DeleteIntent {
      return Err(Error::ReconciliationFailed);
    }
    // Mandatory source_identity survives even when active/staged headers are gone.
    let mut identities = journal.cleanup_identities.clone();
    let incumbent = journal.source_identity.as_ref().unwrap();
    if incumbent.credential && !identities.contains(incumbent) {
      identities.push(incumbent.clone());
    }
    for name in LOCAL_ARTIFACTS
      .iter()
      .chain(vault_fs::MIGRATION_COPY_FILES.iter())
    {
      let path = self.directory.join(name);
      if regular_file(&path)? {
        self.point("beforeDeleteFile")?;
        vault_fs::remove(&path).map_err(|_| Error::Io)?;
        self.point("afterDeleteFile")?;
      }
    }
    self.sync()?;
    for identity in identities {
      self.point("beforeDeleteCredential")?;
      self.credentials.remove(&identity)?;
      self.point("afterDeleteCredential")?;
    }
    self.advance(&mut journal, Phase::Deleted)
  }
}
