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
