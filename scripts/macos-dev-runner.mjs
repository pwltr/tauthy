#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process'
import { localSigningIdentity } from './macos-local-signing.mjs'

const [executable, ...args] = process.argv.slice(2)

if (!executable) {
  console.error('The macOS development runner requires an executable path.')
  process.exit(1)
}

// A certificate-backed signature gives rebuilt debug binaries a stable
// Keychain identity. Ad-hoc signing remains available to contributors without
// a local certificate, but it cannot reliably preserve Keychain authorization.
const identifier = 'com.pwltr.tauthy.dev'
const identity = localSigningIdentity()
if (identity) {
  console.log(`Signing Tauthy Debug with ${identity.name}.`)
} else {
  console.warn('No local Tauthy signing identity found; Keychain may ask again after rebuilds.')
}
const signed = spawnSync(
  'codesign',
  [
    '--force',
    '--sign',
    identity?.hash ?? '-',
    '--identifier',
    identifier,
    ...(identity ? [] : ['--requirements', `=designated => identifier "${identifier}"`]),
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
