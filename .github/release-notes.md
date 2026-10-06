## What's new in 0.6.0

- Import Google Authenticator transfer QR codes from image files or the clipboard,
  including multi-code transfers, with an account review before saving.
- Pubky sync: connect with Pubky Ring and sync encrypted accounts through
  your homeserver. A recovery code lets another device join.
- New keyboard shortcuts, code-list navigation, native macOS menu commands, and
  account right-click actions make common tasks quicker.
- Backup status and reminders help you keep an up-to-date export.
- Smoother startup and onboarding, with fewer theme flashes and UI polish.
- Export privacy-safe diagnostic logs from Settings when troubleshooting.

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
