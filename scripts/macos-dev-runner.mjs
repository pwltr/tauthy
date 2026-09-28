#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process'

const [executable, ...args] = process.argv.slice(2)

if (!executable) {
  console.error('The macOS development runner requires an executable path.')
  process.exit(1)
}

// Linker-signed debug binaries use their changing CDHash as their identity.
// Give Tauthy dev builds an explicit, stable requirement so a Keychain
// "Always Allow" decision survives Rust rebuilds. This identity is deliberately
// development-only and does not affect packaged or production applications.
const identifier = 'com.pwltr.tauthy.dev'
const requirement = `=designated => identifier "${identifier}"`
const signed = spawnSync(
  'codesign',
  [
    '--force',
    '--sign',
    '-',
    '--identifier',
    identifier,
    '--requirements',
    requirement,
    executable,
  ],
  { stdio: 'inherit' },
)

if (signed.error) {
  console.error(signed.error)
  process.exit(1)
}

if (signed.status !== 0) {
  process.exit(signed.status ?? 1)
}

const child = spawn(executable, args, { stdio: 'inherit' })

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal))
}

child.on('error', (error) => {
  console.error(error)
  process.exitCode = 1
})

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
  } else {
    process.exitCode = code ?? 1
  }
})
