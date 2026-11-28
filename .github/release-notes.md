## What's new in 0.7.0

- Automatic updates on Windows and Linux now use signed installers and AppImages
  directly. The legacy updater ZIPs and AppImage archive have been retired.

### Upgrading from Tauthy 0.2.8 or earlier

This release uses Tauri 2 update packages. If you're still on Tauthy 0.2.8 or
earlier, first export a backup, then download and install
[Tauthy 0.6.0](https://github.com/pwltr/tauthy/releases/tag/v0.6.0) manually. Use
the `.msi` installer on Windows. Open 0.6.0 and unlock your vault if prompted
before using automatic updates again.

### Windows upgrade notice

Automatic updates from Tauthy 0.2.7 may repeatedly offer the update when the
existing app was installed with the `.exe` installer. Tauthy now uses the
Windows Installer (`.msi`) package for automatic updates, and Windows can keep
the older `.exe` installation alongside it instead of replacing it.

If the update prompt keeps reappearing:

1. Export a Tauthy backup.
2. Close Tauthy and uninstall the older Tauthy installation from Windows
   Settings. If both the old and current versions are listed, uninstall both.
3. Install the v0.6.0 `.msi` package linked above.

This is a one-time installer migration. Updates after 0.4.1 should install
normally.
