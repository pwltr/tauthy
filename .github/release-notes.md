## What's new in 0.4.2

- Import encrypted 2FAS and Ente Auth backups, Proton Authenticator backups
  (plain text or encrypted), Bitwarden unencrypted JSON exports, and andOTP
  plain-text backups.
- Review accounts before importing, including from Authenticator links
  (`.txt`), with recognizable provider icons in the import chooser.
- Export from one native dialog: choose password protected or plain text.
- Automatically check for sync changes while Tauthy is open, without
  rewriting unchanged data.
- Improved macOS light-theme colors and search visibility; renamed the theme
  option to “System Default.”

### Windows upgrade notice

Automatic updates from Tauthy 0.2.7 may repeatedly offer the update when the
existing app was installed with the `.exe` installer. Tauthy now uses the
Windows Installer (`.msi`) package for automatic updates, and Windows can keep
the older `.exe` installation alongside it instead of replacing it.

If the update prompt reappears after installing 0.4.2:

1. Export a Tauthy backup.
2. Close Tauthy and uninstall the older Tauthy installation from Windows
   Settings. If both 0.2.7 and 0.4.2 are listed, uninstall both.
3. Download and install `Tauthy_0.4.2_x64_en-US.msi` from this release.

This is a one-time installer migration. Updates after 0.4.1 should install
normally.
