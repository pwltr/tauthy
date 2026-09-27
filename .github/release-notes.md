## What's new in 0.5.0

- Faster startup and unlock with new encrypted local storage. Existing accounts
  and sync settings migrate automatically; passwords remain optional.
- Improved Windows export dialog and removed the artificial unlock delay.

### Windows upgrade notice

Automatic updates from Tauthy 0.2.7 may repeatedly offer the update when the
existing app was installed with the `.exe` installer. Tauthy now uses the
Windows Installer (`.msi`) package for automatic updates, and Windows can keep
the older `.exe` installation alongside it instead of replacing it.

If the update prompt keeps reappearing:

1. Export a Tauthy backup.
2. Close Tauthy and uninstall the older Tauthy installation from Windows
   Settings. If both the old and current versions are listed, uninstall both.
3. Download and install the `.msi` package from this release.

This is a one-time installer migration. Updates after 0.4.1 should install
normally.
