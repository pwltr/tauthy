## What's new in 0.3.2

- Added optional menu bar access for quickly copying account codes.
- Added imports from unencrypted 2FAS backups.
- Prevented multiple Tauthy instances from accessing the vault simultaneously.
- Fixed missing service icons in the Add Account screen.
- Improved the code-expiration animation and macOS dark theme.

### Windows upgrade notice

Automatic updates from Tauthy 0.2.7 may repeatedly offer the update when the
existing app was installed with the `.exe` installer. Tauthy now uses the
Windows Installer (`.msi`) package for automatic updates, and Windows can keep
the older `.exe` installation alongside it instead of replacing it.

If the update prompt reappears after installing 0.3.2:

1. Export a Tauthy backup.
2. Close Tauthy and uninstall the older Tauthy installation from Windows
   Settings. If both 0.2.7 and 0.3.2 are listed, uninstall both.
3. Download and install `Tauthy_0.3.2_x64_en-US.msi` from this release.

This is a one-time installer migration. Updates after 0.3.2 should install
normally.
