## What's new in 0.3.3

- Added password-protected Tauthy backups for secure portable recovery.
- Improved Tauthy backups to preserve icons and OTP settings in a versioned format.
- Added imports from password-protected Aegis backups.
- Added issuer, recent, frequent, and manual account sorting.
- Simplified the main toolbar and settings navigation.
- Improved dialogs, the icon picker, scrollbars, and other interface details.

### Windows upgrade notice

Automatic updates from Tauthy 0.2.7 may repeatedly offer the update when the
existing app was installed with the `.exe` installer. Tauthy now uses the
Windows Installer (`.msi`) package for automatic updates, and Windows can keep
the older `.exe` installation alongside it instead of replacing it.

If the update prompt reappears after installing 0.3.3:

1. Export a Tauthy backup.
2. Close Tauthy and uninstall the older Tauthy installation from Windows
   Settings. If both 0.2.7 and 0.3.3 are listed, uninstall both.
3. Download and install `Tauthy_0.3.3_x64_en-US.msi` from this release.

This is a one-time installer migration. Updates after 0.3.3 should install
normally.
