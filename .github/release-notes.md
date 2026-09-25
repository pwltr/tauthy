## What's new in 0.4.1

- Reduced cloud-provider sync conflicts when multiple devices are active:
  each device now updates its own encrypted file in the sync location.
- Automatic sync failures now appear in the app and can be inspected in
  Settings → Sync. Local edits remain available when sync fails.
- Fixed the home-screen list jumping back to the top during sync refresh.

### Sync upgrade note

Update every device using the same sync location to 0.4.1. Older versions
cannot read changes published in the new per-device files. Existing sync
connections keep their current location; they are not moved automatically.

### Windows upgrade notice

Automatic updates from Tauthy 0.2.7 may repeatedly offer the update when the
existing app was installed with the `.exe` installer. Tauthy now uses the
Windows Installer (`.msi`) package for automatic updates, and Windows can keep
the older `.exe` installation alongside it instead of replacing it.

If the update prompt reappears after installing 0.4.1:

1. Export a Tauthy backup.
2. Close Tauthy and uninstall the older Tauthy installation from Windows
   Settings. If both 0.2.7 and 0.4.1 are listed, uninstall both.
3. Download and install `Tauthy_0.4.1_x64_en-US.msi` from this release.

This is a one-time installer migration. Updates after 0.4.1 should install
normally.
