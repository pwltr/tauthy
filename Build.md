## Requirements:

- Node.js
- yarn
- Rust
- Cargo
- Git

## Build

1. Install git submodules

```
git submodules update --init --remote
```

2. Install dependencies

```
yarn install
```

3. Build the app

```
yarn tauri build
```

Executables will be saved to `./src-tauri/target/release`
