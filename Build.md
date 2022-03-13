## Requirements

- Node.js
- yarn
- Rust
- Cargo
- Git

## Setup

1. Clone the repo

```
git clone --recurse-submodules https://github.com/pwltr/tauthy.git
```

2. Install dependencies

```
yarn install
```

## Build

Build the app for production

```
yarn tauri build
```

Find the executable for your platform under `./src-tauri/target/release`

## Development

Run the app for development

```
yarn tauri dev
```