# Isolated migration test

This test app uses dummy accounts, separate settings, a separate credential
namespace and separate local vaults. It does not update or migrate your installed
Tauthy. It requires a fixed NTFS system/data drive on Windows, not ReFS/Dev Drive
or a network drive. Leave your installed app alone.

Extract the whole Windows download and double-click **Run Migration Tests.cmd**.
Windows may warn about this unsigned test download; only run the artifact from
the project's test workflow if you trust it. The launcher bypasses PowerShell
execution policy for this script invocation only, without changing system policy.
WebView2 must be installed (an existing working Tauthy installation already uses it).

The launcher offers:

- **1:** new passwordless migration.
- **2:** new protected migration; password `test-password`.
- **3:** new passwordless migration with simulated credential denial.
- **4:** reopen the last run with credentials allowed, retaining edits and sync.

Quit the test app before using the launcher again. Options 1–3 create a different
run; option 4 is for restart/persistence checks. The two fixture accounts are
Dropbox and GitHub. A normal passwordless test uses the real Windows Credential
Manager, but only for test keys. Delete Vault performs tracked credential cleanup.
Do not delete vault files by hand.

## Windows checks

1. Passwordless: both accounts appear with codes; edit/add/delete an account and
   reopen with option 4. Changes persist, including deletion.
2. Protected: choose option 2; a wrong password gives an error and permits retry;
   `test-password` opens the accounts. Lock and restart require the password.
3. Change the password to `test-password-2`, restart, remove protection, restart,
   add protection and restart. Each restart follows the latest setting.
4. Export an encrypted Tauthy backup, Delete Vault and import it. Deletion returns
   immediately to an empty usable app. Wrong backup password permits retry.
   Restart after deleting must not restore old accounts.
5. Choose option 3, edit an account while storage setup is deferred, then quit
   and reopen with option 4. Press Try again. The edit survives completed migration.
6. If you use the tray, verify entries disappear when locked and return on unlock.

## macOS + Windows folder sync

Use only test apps and a **new, separate Nextcloud folder**, never your real
Tauthy Sync folder. Start with launcher option **1 on both devices** so the dummy
accounts match; do not use a locally edited migration run for the initial join.
After connecting, keep the same run on each device throughout this test.

1. On macOS: Settings → Sync → Create sync folder. Select the new Nextcloud
   test location and use recovery password `sync-test-password`.
2. Wait for Nextcloud to finish transferring. On Windows: Settings → Sync →
   Join existing sync. Select the **Tauthy Sync** folder created inside that
   location. Enter `sync-test-password`.
3. Add an account on macOS and another on Windows. Let Nextcloud finish, then
   press Sync now on each app (repeat after transfer if necessary). Both appear
   on both devices.
4. Edit an account and delete another. Sync both, restart with option 4 on both,
   and sync again. The edit remains and the deleted account stays deleted.
5. Keep both apps open; edit different accounts on the two devices before Nextcloud finishes transfer.
   After transfer and sync, neither change is lost and no conflict copies appear.
6. Disconnect sync on Windows. Local accounts remain; the macOS connection and
   remote files remain intact. Rejoining the same folder succeeds.

These checks verify two already-migrated devices. They do **not** prove preservation
of a pre-existing sync configuration through migration, mixed-version sync or the
released-app updater path; those require separately prepared older-version fixtures.

Import diagnostics are stage names/timings only, in timestamped
`import-diagnostics-*.log` files beneath the selected test run's data directory.
No account data, passwords, file contents or selected filenames are logged.

## Building the test harness

The **Build isolated migration test** workflow is manual-only and produces the
Windows download without publishing a release. Production builds still use
Stronghold; `file-vault` is opt-in, and Windows file-vault writes are enabled only
in unit tests or the isolated `migration-test` app on supported fixed NTFS disks.
Never enable `migration-test` in release workflows.

For a local macOS test app, after installing the normal build dependencies:

```sh
node node_modules/@tauri-apps/cli/tauri.js build --features migration-test --config src-tauri/tauri.migration-test.conf.json --bundles app -- --locked
open -n "src-tauri/target/release/bundle/macos/Tauthy Migration Test.app" --args --migration-fixture password --migration-run run-1
```

Quit before reopening. Reuse the same fixture/run to test persistence; change the
run identifier to repeat migration. Opening the app without arguments selects
the default passwordless run, not the last argument-selected run. Existing runs
are never reseeded, including after deletion. `--deny-test-credentials` simulates
denial; reopen the same run without it to retry. Short passwords and legacy v2
snapshots are covered by backend tests, not the interactive fixtures.

For diagnostic builds on macOS, prefix the build command with
`VITE_IMPORT_DIAGNOSTICS=1`. Normal builds emit no diagnostic IPC, and the logging
command exists only in `migration-test` builds.

Check the opt-in backend without launching an app:

```sh
cargo check --manifest-path src-tauri/Cargo.toml --locked --features file-vault
cargo test --manifest-path src-tauri/Cargo.toml --locked --features file-vault vault_
```

Windows vault tests require an NTFS temporary directory. If `TEMP` points to ReFS,
a Dev Drive, or a network/removable volume, set `TEMP` and `TMP` to an existing
local NTFS directory before running tests.
