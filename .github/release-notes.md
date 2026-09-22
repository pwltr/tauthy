## What's new in 0.4.0

- Added optional encrypted folder sync for Nextcloud, Dropbox, OneDrive,
  iCloud Drive, Syncthing, and similar services.
- Create a new sync file or join an existing one with a recovery password.
- Sync automatically after startup, unlock, and local changes, or manually
  from Settings.
- Merge changes and deletions safely between devices while keeping the local
  vault available if the sync folder is offline.
- Improved native scrollbar sizing on macOS while retaining native styling on
  every platform.
- Fixed vault deletion so the app returns to an empty, usable vault without a
  restart.

### Windows upgrade notice

Automatic updates from Tauthy 0.2.7 may repeatedly offer the update when the
existing app was installed with the `.exe` installer. Tauthy now uses the
Windows Installer (`.msi`) package for automatic updates, and Windows can keep
the older `.exe` installation alongside it instead of replacing it.

If the update prompt reappears after installing 0.4.0:

1. Export a Tauthy backup.
2. Close Tauthy and uninstall the older Tauthy installation from Windows
   Settings. If both 0.2.7 and 0.4.0 are listed, uninstall both.
3. Download and install `Tauthy_0.4.0_x64_en-US.msi` from this release.

This is a one-time installer migration. Updates after 0.4.0 should install
normally.
