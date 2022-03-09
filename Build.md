## Requirements:

- Node.js
- yarn
- Rust
- Cargo
- Git

## Build

1. Clone the repo

```
git clone https://github.com/pwltr/tauthy.git
```

2. Install git submodules

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

## Run

Find the executable for your platform under `./src-tauri/target/release`
