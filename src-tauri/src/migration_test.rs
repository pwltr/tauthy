//! Compile-time disposable test harness. No path override in normal builds.
//! Each fresh run is seeded once. Reopening never recreates deleted/migrated data.
use std::{
  fs, io,
  io::Write,
  path::{Path, PathBuf},
  sync::Mutex,
  time::{Instant, SystemTime, UNIX_EPOCH},
};

pub(crate) struct ImportDiagnostics {
  file: Mutex<fs::File>,
  started: Instant,
}

impl ImportDiagnostics {
  pub(crate) fn new(directory: &Path) -> io::Result<Self> {
    let timestamp = SystemTime::now()
      .duration_since(UNIX_EPOCH)
      .map_err(io::Error::other)?
      .as_millis();
    let path = directory.join(format!(
      "import-diagnostics-{timestamp}-{}.log",
      std::process::id()
    ));
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
      use std::os::unix::fs::OpenOptionsExt;
      options.mode(0o600);
    }
    let mut file = options.open(path)?;
    writeln!(
      file,
      "Import diagnostics: stage names only; no account or file data"
    )?;
    Ok(Self {
      file: Mutex::new(file),
      started: Instant::now(),
    })
  }

  fn record(&self, stage: &str) -> Result<(), &'static str> {
    // Do not let IPC callers turn this into an arbitrary data logger.
    if !matches!(
      stage,
      "frontendReady"
        | "frontendError"
        | "unhandledRejection"
        | "pickerOpening"
        | "pickerReturned"
        | "fileSelected"
        | "noFileSelected"
        | "formatMissing"
        | "importErrorShown"
        | "passwordPrompt"
        | "passwordRequired"
        | "fileReadStarted"
        | "fileReadFinished"
        | "jsonParseStarted"
        | "jsonParseFinished"
        | "fileReadOrParseFailed"
        | "decryptStarted"
        | "decryptFinished"
        | "entriesParseStarted"
        | "entriesParseFinished"
        | "vaultReadStarted"
        | "vaultReadFinished"
        | "mergePlanStarted"
        | "previewReady"
        | "reviewNavigation"
        | "reviewMounted"
        | "reviewMissingPreview"
    ) {
      return Err("Unsupported diagnostic stage");
    }
    let mut file = self.file.lock().map_err(|_| "Diagnostic lock failed")?;
    writeln!(file, "{}ms {stage}", self.started.elapsed().as_millis())
      .map_err(|_| "Diagnostic write failed")?;
    file.flush().map_err(|_| "Diagnostic flush failed")
  }
}

#[tauri::command]
pub(crate) fn import_diagnostic(
  stage: String,
  state: tauri::State<'_, ImportDiagnostics>,
) -> Result<(), &'static str> {
  state.record(&stage)
}

const ROOT: &str = "tauthy-migration-test";
const ACCOUNTS: &str = r#"[{"uuid":"migration-dropbox","name":"Dropbox","issuer":"Dropbox","secret":"JBSWY3DPEHPK3PXP"},{"uuid":"migration-github","name":"GitHub","issuer":"GitHub","secret":"GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"}]"#;

fn invalid(message: &str) -> io::Error {
  io::Error::new(io::ErrorKind::InvalidInput, message)
}

fn selection(args: &[String]) -> io::Result<(&str, &str)> {
  let value = |flag: &str| -> io::Result<Option<&str>> {
    let mut matches = args
      .iter()
      .enumerate()
      .filter(|(_, arg)| arg.as_str() == flag);
    let Some((index, _)) = matches.next() else {
      return Ok(None);
    };
    if matches.next().is_some() {
      return Err(invalid("Duplicate migration-test argument"));
    }
    args
      .get(index + 1)
      .map(|s| Some(s.as_str()))
      .ok_or_else(|| invalid("Missing migration-test argument"))
  };
  let case = value("--migration-fixture")?.unwrap_or("passwordless");
  if !matches!(case, "passwordless" | "password" | "short-password") {
    return Err(invalid("Unknown migration fixture"));
  }
  let run = value("--migration-run")?.unwrap_or("default");
  if run.is_empty()
    || run.len() > 64
    || !run.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-')
  {
    return Err(invalid("Invalid migration run identifier"));
  }
  Ok((case, run))
}

fn directory(path: &Path) -> io::Result<()> {
  match fs::create_dir(path) {
    Ok(()) => Ok(()),
    Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
      let metadata = fs::symlink_metadata(path)?;
      if metadata.is_dir() && !metadata.file_type().is_symlink() {
        Ok(())
      } else {
        Err(invalid("Test path is not a plain directory"))
      }
    }
    Err(error) => Err(error),
  }
}

fn prepare(data: &Path, args: &[String]) -> io::Result<PathBuf> {
  let (case, run) = selection(args)?;
  let root = data.join(ROOT);
  directory(&root)?;
  let parent = root.join(case);
  directory(&parent)?;
  let target = parent.join(run);
  match fs::create_dir(&target) {
    Ok(()) => {}
    Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
      directory(&target)?;
      return Ok(target); // Never seed over an existing run, even after deletion.
    }
    Err(error) => return Err(error),
  }
  let password = match case {
    "password" => "test-password",
    "short-password" => "test",
    _ => "",
  };
  let legacy = crate::legacy_vault::VaultState::default();
  crate::legacy_vault::vault_load_at(&legacy, target.join("vault.stronghold"), password.into())
    .map_err(io::Error::other)?;
  crate::legacy_vault::vault_save_at(&legacy, ACCOUNTS.into()).map_err(io::Error::other)?;
  Ok(target)
}

pub(crate) fn prepare_directory(data: &Path) -> io::Result<PathBuf> {
  prepare(data, &std::env::args().collect::<Vec<_>>())
}

pub(crate) fn deny_credentials() -> bool {
  std::env::args().any(|arg| arg == "--deny-test-credentials")
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn import_diagnostics_only_accept_fixed_stage_names() {
    let directory = tempfile::tempdir().unwrap();
    let diagnostics = ImportDiagnostics::new(directory.path()).unwrap();
    diagnostics.record("fileReadStarted").unwrap();
    diagnostics.record("fileReadFinished").unwrap();
    for data in [
      "password=test",
      "accounts.json",
      "JBSWY3DPEHPK3PXP",
      "fileReadStarted\nsecret",
    ] {
      assert!(diagnostics.record(data).is_err());
    }
    let path = fs::read_dir(directory.path())
      .unwrap()
      .next()
      .unwrap()
      .unwrap()
      .path();
    let log = fs::read_to_string(path).unwrap();
    assert_eq!(log.lines().count(), 3);
    assert!(log.contains("ms fileReadStarted"));
    assert!(log.contains("ms fileReadFinished"));
    assert!(!log.contains("JBSWY"));
  }

  #[test]
  fn selectors_cannot_escape_the_test_namespace() {
    for args in [
      vec!["--migration-fixture", "../tauthy"],
      vec!["--migration-run", "../tauthy"],
      vec!["--migration-run", ""],
      vec!["--migration-run"],
      vec!["--migration-run", "a", "--migration-run", "b"],
    ] {
      let args = args.into_iter().map(str::to_owned).collect::<Vec<_>>();
      assert!(selection(&args).is_err());
    }
  }

  #[test]
  fn fixtures_are_isolated_and_reopen_without_reseeding() {
    let data = tempfile::tempdir().unwrap();
    let production = data.path().join("tauthy");
    fs::create_dir(&production).unwrap();
    fs::write(production.join("sentinel"), b"untouched").unwrap();
    for (case, password) in [
      ("passwordless", ""),
      ("password", "test-password"),
      ("short-password", "test"),
    ] {
      let args = vec![
        "--migration-fixture".into(),
        case.into(),
        "--migration-run".into(),
        "run-1".into(),
      ];
      let target = prepare(data.path(), &args).unwrap();
      let snapshot = target.join("vault.stronghold");
      let before = fs::read(&snapshot).unwrap();
      let state = crate::legacy_vault::VaultState::default();
      crate::legacy_vault::vault_load_at(&state, snapshot.clone(), password.into()).unwrap();
      assert_eq!(
        state
          .with_unlocked(|vault| vault.get_record(b"vault"))
          .unwrap(),
        Some(ACCOUNTS.as_bytes().to_vec())
      );
      drop(state);
      assert_eq!(prepare(data.path(), &args).unwrap(), target);
      assert_eq!(fs::read(&snapshot).unwrap(), before);
      fs::remove_file(&snapshot).unwrap();
      prepare(data.path(), &args).unwrap();
      assert!(!snapshot.exists());
    }
    assert_eq!(fs::read(production.join("sentinel")).unwrap(), b"untouched");
  }

  #[cfg(unix)]
  #[test]
  fn refuses_symlinked_test_roots_without_touching_the_target() {
    let data = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    std::os::unix::fs::symlink(outside.path(), data.path().join(ROOT)).unwrap();
    assert!(prepare(data.path(), &[]).is_err());
    assert_eq!(fs::read_dir(outside.path()).unwrap().count(), 0);
  }
}
