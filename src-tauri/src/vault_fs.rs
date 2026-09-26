//! Platform file effects for journaled vault transactions.
//! Unix retains file + directory fsync. The Windows candidate is TEST-ONLY:
//! production refuses all effects until native NTFS verification is complete.
//! No administrator/volume flush, network share, cross-volume move or fallback.
use std::{
  fs::{self, File},
  io,
  path::Path,
};
use tempfile::NamedTempFile;

// Exclusive scratch namespace, never a source of authoritative data. Do not
// clean generic .tmp* names: older files or other tools may own them.
const TEMP_PREFIX: &str = ".tauthy-write-";
const TEMP_RANDOM_LENGTH: usize = 16;

pub(crate) const MIGRATION_COPY_FILES: &[&str] = &[
  "vault-migration.stronghold",
  "vault-migration.stronghold.migrating",
  "vault-migration.stronghold.v2-backup",
  "vault-migration.stronghold.backup",
  "vault-migration.stronghold.password-migrating",
];

fn owned_temporary_name(name: &std::ffi::OsStr) -> bool {
  name.to_str().is_some_and(|name| {
    name.strip_prefix(TEMP_PREFIX).is_some_and(|suffix| {
      suffix.len() == TEMP_RANDOM_LENGTH && suffix.bytes().all(|byte| byte.is_ascii_alphanumeric())
    })
  })
}

/// Caller owns the directory exclusively (runtime mutex + single-instance app).
/// Preflight all matching artifacts before any deletion; reject symlinks and
/// directories. Only uncommitted scratch names are eligible, never staged files.
pub(crate) fn cleanup_temporary_files(directory: &Path) -> io::Result<()> {
  require_supported(directory)?;
  let mut paths = Vec::new();
  for entry in fs::read_dir(directory)? {
    let entry = entry?;
    if owned_temporary_name(&entry.file_name()) {
      if !fs::symlink_metadata(entry.path())?.file_type().is_file() {
        return Err(io::ErrorKind::InvalidData.into());
      }
      paths.push(entry.path());
      if paths.len() > 1024 {
        return Err(io::ErrorKind::InvalidData.into());
      }
    }
  }
  for path in paths {
    remove(&path)?;
  }
  Ok(())
}

pub(crate) fn require_supported(directory: &Path) -> io::Result<()> {
  #[cfg(unix)]
  {
    let _ = directory;
    Ok(())
  }
  #[cfg(windows)]
  {
    windows::require_candidate(directory, cfg!(test))
  }
  #[cfg(not(any(unix, windows)))]
  {
    let _ = directory;
    Err(io::ErrorKind::Unsupported.into())
  }
}

pub(crate) fn temporary(directory: &Path) -> io::Result<NamedTempFile> {
  require_supported(directory)?;
  let mut builder = tempfile::Builder::new();
  builder.prefix(TEMP_PREFIX).rand_bytes(TEMP_RANDOM_LENGTH);
  #[cfg(windows)]
  {
    builder.make_in(directory, |path| windows::writable(path, true, false))
  }
  #[cfg(not(windows))]
  {
    builder.tempfile_in(directory)
  }
}

pub(crate) fn persist(temporary: NamedTempFile, target: &Path, replace: bool) -> io::Result<()> {
  require_supported(parent(target)?)?;
  temporary.as_file().sync_all()?;
  #[cfg(windows)]
  {
    windows::move_file(temporary.path(), target, replace)?;
    // Drop the now-unlinked old name, rather than using tempfile's unflushed
    // Windows persistence. The moved file has already been flushed by handle.
    drop(temporary);
    Ok(())
  }
  #[cfg(not(windows))]
  {
    if replace {
      temporary.persist(target).map_err(|error| error.error)?;
    } else {
      temporary
        .persist_noclobber(target)
        .map_err(|error| error.error)?;
    }
    sync_directory(parent(target)?)
  }
}

/// No-clobber immutable snapshot: Unix hard link, Windows flushed private copy
/// published by same-directory rename. Callers still verify the fingerprint.
pub(crate) fn snapshot(source: &Path, target: &Path) -> io::Result<()> {
  require_supported(parent(target)?)?;
  same_directory(source, target)?;
  #[cfg(windows)]
  {
    let mut source = File::open(source)?;
    let mut temporary = temporary(parent(target)?)?;
    use std::io::Read;
    // Bound a source which grows after its fingerprint was inspected. Never
    // publish a partial copy; this matches the legacy-source limit.
    const MAX_SNAPSHOT: u64 = 256 * 1024 * 1024;
    if io::copy(
      &mut source.by_ref().take(MAX_SNAPSHOT + 1),
      temporary.as_file_mut(),
    )? > MAX_SNAPSHOT
    {
      return Err(io::ErrorKind::InvalidData.into());
    }
    persist(temporary, target, false)
  }
  #[cfg(not(windows))]
  {
    fs::hard_link(source, target)?;
    sync_directory(parent(target)?)
  }
}

/// Install without clobber, retaining staged until authenticated activation.
/// Windows uses a flushed private copy; Unix uses a hard link.
pub(crate) fn install(source: &Path, target: &Path) -> io::Result<()> {
  snapshot(source, target)
}

pub(crate) fn replace(source: &Path, target: &Path) -> io::Result<()> {
  require_supported(parent(target)?)?;
  same_directory(source, target)?;
  #[cfg(windows)]
  {
    windows::move_file(source, target, true)
  }
  #[cfg(not(windows))]
  {
    fs::rename(source, target)?;
    sync_directory(parent(target)?)
  }
}

pub(crate) fn remove(path: &Path) -> io::Result<()> {
  require_supported(parent(path)?)?;
  #[cfg(windows)]
  {
    windows::remove(path)
  }
  #[cfg(not(windows))]
  {
    fs::remove_file(path)?;
    sync_directory(parent(path)?)
  }
}

pub(crate) fn sync_file(path: &Path) -> io::Result<()> {
  require_supported(parent(path)?)?;
  #[cfg(windows)]
  {
    windows::writable(path, false, false)?.sync_all()
  }
  #[cfg(not(windows))]
  {
    File::open(path)?.sync_all()
  }
}

pub(crate) fn sync_directory(directory: &Path) -> io::Result<()> {
  require_supported(directory)?;
  #[cfg(unix)]
  {
    File::open(directory)?.sync_all()
  }
  #[cfg(windows)]
  {
    // Windows effects above flush their own data/metadata handles. This is a
    // capability barrier, NOT a claimed emulation of Unix directory fsync.
    Ok(())
  }
  #[cfg(not(any(unix, windows)))]
  {
    Err(io::ErrorKind::Unsupported.into())
  }
}

fn parent(path: &Path) -> io::Result<&Path> {
  path
    .parent()
    .filter(|p| !p.as_os_str().is_empty())
    .ok_or_else(|| io::ErrorKind::InvalidInput.into())
}

fn same_directory(source: &Path, target: &Path) -> io::Result<()> {
  if fs::canonicalize(parent(source)?)? != fs::canonicalize(parent(target)?)? {
    return Err(io::ErrorKind::InvalidInput.into());
  }
  Ok(())
}

#[cfg(windows)]
mod windows {
  use super::*;
  use std::{
    fs::OpenOptions,
    os::windows::{ffi::OsStrExt, fs::OpenOptionsExt, io::AsRawHandle},
    ptr,
  };
  use windows_sys::Win32::{
    Foundation::{GENERIC_READ, GENERIC_WRITE},
    Storage::FileSystem::*,
    System::WindowsProgramming::DRIVE_FIXED,
  };

  fn wide(path: &Path) -> io::Result<Vec<u16>> {
    let mut value: Vec<u16> = path.as_os_str().encode_wide().collect();
    if value.contains(&0) {
      return Err(io::ErrorKind::InvalidInput.into());
    }
    value.push(0);
    Ok(value)
  }

  pub(super) fn require_candidate(directory: &Path, enabled: bool) -> io::Result<()> {
    if !enabled {
      return Err(io::ErrorKind::Unsupported.into());
    }
    require_ntfs(directory)
  }

  pub(super) fn require_ntfs(directory: &Path) -> io::Result<()> {
    let directory = fs::canonicalize(directory)?;
    let path = wide(&directory)?;
    let mut root = vec![0; 32768];
    // SAFETY: all pointers refer to live NUL-terminated/bounded buffers.
    if unsafe { GetVolumePathNameW(path.as_ptr(), root.as_mut_ptr(), root.len() as u32) } == 0 {
      return Err(io::Error::last_os_error());
    }
    if unsafe { GetDriveTypeW(root.as_ptr()) } != DRIVE_FIXED {
      return Err(io::ErrorKind::Unsupported.into());
    }
    let handle = OpenOptions::new()
      .read(true)
      .custom_flags(FILE_FLAG_BACKUP_SEMANTICS)
      .open(directory)?;
    let mut name = [0; 64];
    if unsafe {
      GetVolumeInformationByHandleW(
        handle.as_raw_handle(),
        ptr::null_mut(),
        0,
        ptr::null_mut(),
        ptr::null_mut(),
        ptr::null_mut(),
        name.as_mut_ptr(),
        name.len() as u32,
      )
    } == 0
    {
      return Err(io::Error::last_os_error());
    }
    let end = name
      .iter()
      .position(|c| *c == 0)
      .ok_or(io::ErrorKind::Unsupported)?;
    if String::from_utf16_lossy(&name[..end]) != "NTFS" {
      return Err(io::ErrorKind::Unsupported.into());
    }
    Ok(())
  }

  pub(super) fn writable(path: &Path, create: bool, delete: bool) -> io::Result<File> {
    let mut options = OpenOptions::new();
    options
      .read(true)
      .write(true)
      .create_new(create)
      .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE)
      .custom_flags(FILE_FLAG_WRITE_THROUGH);
    if delete {
      options.access_mode(GENERIC_READ | GENERIC_WRITE | DELETE);
    }
    options.open(path)
  }

  pub(super) fn move_file(source: &Path, target: &Path, replace: bool) -> io::Result<()> {
    same_directory(source, target)?;
    // Hold a writable write-through handle across the metadata change, then
    // FlushFileBuffers via sync_all before reporting success.
    let handle = writable(source, false, false)?;
    handle.sync_all()?;
    let source = wide(source)?;
    let target = wide(target)?;
    let flags = MOVEFILE_WRITE_THROUGH
      | if replace {
        MOVEFILE_REPLACE_EXISTING
      } else {
        0
      };
    // COPY_ALLOWED deliberately absent: never copy/delete across volumes.
    if unsafe { MoveFileExW(source.as_ptr(), target.as_ptr(), flags) } == 0 {
      return Err(io::Error::last_os_error());
    }
    handle.sync_all()
  }

  pub(super) fn remove(path: &Path) -> io::Result<()> {
    // POSIX disposition removes the name on closing the delete handle even
    // while another handle retains the data. Flush the survivor AFTER unlink.
    // Native tests must verify this ordering on supported Windows/NTFS versions.
    let survivor = writable(path, false, false)?;
    let deletion = writable(path, false, true)?;
    let info = FILE_DISPOSITION_INFO_EX {
      Flags: FILE_DISPOSITION_FLAG_DELETE | FILE_DISPOSITION_FLAG_POSIX_SEMANTICS,
    };
    if unsafe {
      SetFileInformationByHandle(
        deletion.as_raw_handle(),
        FileDispositionInfoEx,
        (&info as *const FILE_DISPOSITION_INFO_EX).cast(),
        size_of::<FILE_DISPOSITION_INFO_EX>() as u32,
      )
    } == 0
    {
      return Err(io::Error::last_os_error());
    }
    drop(deletion);
    survivor.sync_all()
  }
}

#[cfg(test)]
#[path = "vault_fs_tests.rs"]
mod tests;
