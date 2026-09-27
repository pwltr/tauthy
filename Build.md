# Building Tauthy

## Requirements

- [Node.js 22](https://nodejs.org/)
- [Corepack](https://nodejs.org/api/corepack.html) for the repository's pinned Yarn version
- [Rust](https://www.rust-lang.org/tools/install)
- The [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/) for your operating system
- Git

## Build

```sh
git clone https://github.com/pwltr/tauthy.git
cd tauthy
corepack enable
yarn install --immutable
yarn tauri build
```

The packaged application is written to `src-tauri/target/release/bundle`.

## Development

After installing the dependencies, start the development build with:

```sh
yarn tauri dev
```

Run the same checks as CI with:

```sh
yarn tsc:check
yarn lint:check
yarn format:check
cargo test --manifest-path src-tauri/Cargo.toml --locked
```

Windows vault tests require an NTFS temporary directory. ReFS/Dev Drive and
network/removable volumes are intentionally unsupported; if `%TEMP%` points to
one, set `TEMP` and `TMP` to an existing local NTFS directory before running tests.

The `file-vault` Cargo feature is an opt-in backend integration target, not a
supported application mode yet. It does not bypass platform durability guards
and is not enabled by release builds. Check it without launching the app:

```sh
cargo check --manifest-path src-tauri/Cargo.toml --locked --features file-vault
cargo test --manifest-path src-tauri/Cargo.toml --locked --features file-vault vault_
```

## Isolated migration test app

This optional harness uses dummy Stronghold v3 accounts, separate application
preferences, `tauthy-migration-test/<fixture>/<run>` data directories, and a
test-only credential namespace. It cannot install production updates. Never
enable `migration-test` in release workflows; it requires the isolated config:

```sh
yarn tauri build --features migration-test --config src-tauri/tauri.migration-test.conf.json --bundles app
```

For import diagnostics, prefix that build command with
`VITE_IMPORT_DIAGNOSTICS=1`. The isolated app writes timestamped
`import-diagnostics-*.log` files in its selected test-run directory. These contain
only elapsed times and allowlisted stage names, never filenames, account data,
passwords, file contents or exception messages. Normal builds emit no diagnostic
IPC, and the logging command exists only with `migration-test`.

On Windows, `migration-test` also enables the guarded fixed-NTFS filesystem
candidate for this isolated app only. Default and `file-vault` builds still refuse
Windows file-vault effects. The test workflow produces a portable executable
with a launcher and [manual instructions](docs/migration-test-checklist.md);
it does not publish a release or use updater-signing secrets.

On macOS, quit the test app before selecting another run, then launch it with:

```sh
open -n "src-tauri/target/release/bundle/macos/Tauthy Migration Test.app" --args --migration-fixture password --migration-run run-1
```

Manual fixtures: `passwordless` (no password) and `password` (`test-password`).
Short-password preservation remains defensive backend regression coverage, not
a required manual scenario or a claim about released password policy.
Use a different run identifier to repeat migration;
use the same fixture/run to verify persistence after restart. No directory is
reset or reseeded, even after Delete Vault. With no arguments, the app reopens
the default passwordless run; it does not remember the last argument-selected run.

Add `--deny-test-credentials` to a passwordless run to exercise deferral without
contacting a real credential store. Quit, reopen the same run without that flag,
and use Try again to complete migration. Ordinary passwordless tests
use the real OS credential store, but only in the isolated test namespace.
Delete Vault in the test app performs tracked key cleanup; don't just remove its
directory, which could orphan test credentials. The v2 compatibility fixture is
covered by backend tests; it lacks the current account UI fields and is not used
as an interactive test vault.
