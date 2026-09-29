//! Bounded, local troubleshooting events. Values are fixed identifiers only:
//! never accept account data, paths, recovery codes, or raw error messages.
use std::{
  collections::VecDeque,
  fs,
  io::{self, Read, Write},
  path::{Path, PathBuf},
  sync::Mutex,
  time::{SystemTime, UNIX_EPOCH},
};

use tauri::State;

const MAX_ENTRIES: usize = 128;
const MAX_FILE_BYTES: u64 = 32 * 1024;
const LOG_NAME: &str = "diagnostics.log";

fn valid_stage(stage: &str) -> bool {
  matches!(
    stage,
    "app.start"
      | "vault.init.start"
      | "vault.init.ok"
      | "vault.init.error"
      | "sync.now.start"
      | "sync.now.ok"
      | "sync.now.error"
      | "sync.connect.start"
      | "sync.connect.ok"
      | "sync.connect.error"
      | "pubky.approval.start"
      | "pubky.approval.ok"
      | "pubky.approval.error"
      | "pubky.create.start"
      | "pubky.create.ok"
      | "pubky.create.error"
      | "pubky.join.start"
      | "pubky.join.ok"
      | "pubky.join.error"
      | "pubky.read.error"
      | "pubky.merge.error"
      | "pubky.publish.error"
      | "import.start"
      | "import.ok"
      | "import.error"
  )
}

fn valid_code(code: &str) -> bool {
  matches!(
    code,
    "other"
      | "vaultAuthenticationFailed"
      | "vaultCorrupt"
      | "vaultCredentialAccessDenied"
      | "vaultCredentialMalformed"
      | "vaultCredentialMissing"
      | "vaultCredentialUnavailable"
      | "vaultIdentityMismatch"
      | "vaultIo"
      | "vaultLegacyCorrupt"
      | "vaultLegacyUnsupported"
      | "vaultMissing"
      | "vaultNeedsPreparation"
      | "vaultPendingUnlock"
      | "vaultReconciliationFailed"
      | "vaultSourceChanged"
      | "vaultStagedCleanupFailed"
      | "vaultUnsupportedDurability"
      | "syncAuthenticationFailed"
      | "syncConflict"
      | "syncCorrupt"
      | "syncDeviceFileLimit"
      | "syncFileExists"
      | "syncLocalConflict"
      | "syncMultipleFiles"
      | "syncNotConfigured"
      | "syncUnavailable"
      | "syncUnsupported"
      | "importEncryptedAuthenticationFailed"
      | "importEncryptedCorrupt"
      | "importEncryptedNoPasswordKey"
      | "importEncryptedUnsupported"
      | "importEncryptedWrongPassword"
      | "importFailed"
      | "importIdConflict"
      | "importOtpAuthTooLarge"
      | "importOtpAuthTooMany"
      | "importTauthyDuplicateIds"
      | "importTauthyIdConflict"
      | "importTauthyNewerVersion"
      | "importUnsupportedOtp"
  )
}

fn valid_entry(line: &str) -> bool {
  let mut parts = line.split(' ');
  let Some(timestamp) = parts.next() else {
    return false;
  };
  let Some(stage) = parts.next() else {
    return false;
  };
  let Some(code) = parts.next() else {
    return false;
  };
  parts.next().is_none()
    && timestamp.len() <= 13
    && timestamp.parse::<u64>().is_ok()
    && valid_stage(stage)
    && (code == "-" || valid_code(code))
}

pub(crate) struct Diagnostics {
  path: Option<PathBuf>,
  entries: Mutex<VecDeque<String>>,
}

impl Diagnostics {
  pub(crate) fn memory_only() -> Self {
    Self {
      path: None,
      entries: Mutex::new(VecDeque::new()),
    }
  }

  pub(crate) fn new(directory: &Path) -> io::Result<Self> {
    fs::create_dir_all(directory)?;
    let path = directory.join(LOG_NAME);
    let mut entries = VecDeque::new();
    match fs::symlink_metadata(&path) {
      Ok(metadata) if !metadata.file_type().is_file() => {
        return Err(io::Error::other("diagnostic log is not a regular file"));
      }
      Ok(metadata) if metadata.len() <= MAX_FILE_BYTES => {
        let mut contents = String::new();
        fs::File::open(&path)?
          .take(MAX_FILE_BYTES + 1)
          .read_to_string(&mut contents)?;
        if contents.len() as u64 > MAX_FILE_BYTES {
          contents.clear();
        }
        for line in contents.lines().filter(|line| valid_entry(line)) {
          entries.push_back(line.to_owned());
          if entries.len() > MAX_ENTRIES {
            entries.pop_front();
          }
        }
      }
      Ok(_) => {} // Oversized or damaged diagnostics are never exported.
      Err(error) if error.kind() == io::ErrorKind::NotFound => {}
      Err(error) => return Err(error),
    }
    Ok(Self {
      path: Some(path),
      entries: Mutex::new(entries),
    })
  }

  fn persist(&self, entries: &VecDeque<String>) -> io::Result<()> {
    let Some(path) = &self.path else {
      return Ok(());
    };
    let directory = path
      .parent()
      .ok_or_else(|| io::Error::other("missing log directory"))?;
    let mut temporary = tempfile::NamedTempFile::new_in(directory)?;
    for entry in entries {
      writeln!(temporary, "{entry}")?;
    }
    temporary.flush()?;
    temporary.persist(path).map_err(|error| error.error)?;
    Ok(())
  }

  pub(crate) fn record(&self, stage: &str, code: Option<&str>) -> Result<(), &'static str> {
    if !valid_stage(stage) || code.is_some_and(|code| !valid_code(code)) {
      return Err("Unsupported diagnostic event");
    }
    let timestamp = SystemTime::now()
      .duration_since(UNIX_EPOCH)
      .map_err(|_| "Clock unavailable")?
      .as_millis();
    let mut entries = self
      .entries
      .lock()
      .map_err(|_| "Diagnostic log unavailable")?;
    let event = format!("{stage} {}", code.unwrap_or("-"));
    if entries.back().is_some_and(|last| {
      last
        .split_once(' ')
        .is_some_and(|(_, prior)| prior == event)
    }) {
      entries.pop_back();
    }
    entries.push_back(format!("{timestamp} {event}"));
    if entries.len() > MAX_ENTRIES {
      entries.pop_front();
    }
    self
      .persist(&entries)
      .map_err(|_| "Diagnostic log unavailable")
  }

  // Backend errors can contain untrusted details. Keep only the fixed code.
  pub(crate) fn record_error(&self, stage: &str, error: &str) {
    let code = if valid_code(error) { error } else { "other" };
    let _ = self.record(stage, Some(code));
  }

  pub(crate) fn export(&self) -> Result<String, &'static str> {
    let entries = self
      .entries
      .lock()
      .map_err(|_| "Diagnostic log unavailable")?;
    let mut output = format!(
      "Tauthy logs v1\nApp version: {}\nOS: {}\nEvents: oldest first; timestamps are Unix milliseconds\n\n",
      env!("CARGO_PKG_VERSION"),
      std::env::consts::OS
    );
    for entry in entries.iter() {
      output.push_str(entry);
      output.push('\n');
    }
    Ok(output)
  }
}

#[tauri::command]
pub(crate) fn diagnostics_record(
  stage: String,
  code: Option<String>,
  state: State<'_, Diagnostics>,
) -> Result<(), &'static str> {
  state.record(&stage, code.as_deref())
}

#[tauri::command]
pub(crate) fn diagnostics_export(state: State<'_, Diagnostics>) -> Result<String, &'static str> {
  state.export()
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn only_fixed_events_and_codes_can_be_recorded_or_reloaded() {
    let directory = tempfile::tempdir().unwrap();
    let diagnostics = Diagnostics::new(directory.path()).unwrap();
    diagnostics.record("sync.now.start", None).unwrap();
    diagnostics
      .record("sync.now.error", Some("syncUnavailable"))
      .unwrap();
    assert!(diagnostics.record("secret-value", None).is_err());
    assert!(diagnostics
      .record("sync.now.error", Some("syncUnavailable: /private/path"))
      .is_err());
    diagnostics.record_error("pubky.read.error", "syncLocalConflict");
    diagnostics.record_error("pubky.publish.error", "syncUnavailable: /private/path");
    fs::write(
      directory.path().join(LOG_NAME),
      format!(
        "{}\n123 sync.now.error secret-value\n",
        diagnostics.entries.lock().unwrap()[0]
      ),
    )
    .unwrap();
    let reopened = Diagnostics::new(directory.path()).unwrap();
    assert!(reopened.export().unwrap().contains("sync.now.start"));
    assert!(!reopened.export().unwrap().contains("secret-value"));
    assert!(diagnostics
      .export()
      .unwrap()
      .contains("pubky.read.error syncLocalConflict"));
    assert!(diagnostics
      .export()
      .unwrap()
      .contains("pubky.publish.error other"));
    assert!(!diagnostics.export().unwrap().contains("/private/path"));
  }

  #[test]
  fn retains_only_the_latest_events() {
    let directory = tempfile::tempdir().unwrap();
    let diagnostics = Diagnostics::new(directory.path()).unwrap();
    for index in 0..MAX_ENTRIES + 2 {
      diagnostics
        .record(
          if index % 2 == 0 {
            "sync.now.ok"
          } else {
            "sync.now.error"
          },
          None,
        )
        .unwrap();
    }
    assert_eq!(diagnostics.entries.lock().unwrap().len(), MAX_ENTRIES);
    assert_eq!(
      Diagnostics::new(directory.path())
        .unwrap()
        .entries
        .lock()
        .unwrap()
        .len(),
      MAX_ENTRIES
    );
  }

  #[test]
  fn repeated_background_failure_does_not_fill_the_history() {
    let directory = tempfile::tempdir().unwrap();
    let diagnostics = Diagnostics::new(directory.path()).unwrap();
    for _ in 0..MAX_ENTRIES + 2 {
      diagnostics
        .record("sync.now.error", Some("syncUnavailable"))
        .unwrap();
    }
    assert_eq!(diagnostics.entries.lock().unwrap().len(), 1);
  }
}
