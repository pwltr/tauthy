import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { localSigningIdentity } from './macos-local-signing.mjs'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tauriCli = path.join(projectRoot, 'node_modules', '@tauri-apps', 'cli', 'tauri.js')
const args = process.argv.slice(2)
const env = { ...process.env }

if (process.platform === 'darwin' && args[0] === 'dev') {
  const target = process.arch === 'arm64' ? 'AARCH64_APPLE_DARWIN' : 'X86_64_APPLE_DARWIN'
  env[`CARGO_TARGET_${target}_RUNNER`] = '../scripts/macos-dev-runner.mjs'
}

if (process.platform === 'darwin' && args[0] === 'build') {
  env.PATH = `${path.join(projectRoot, 'scripts', 'build-tools')}${path.delimiter}${env.PATH ?? ''}`

  // Preview has its own bundle ID and vault. Sign only local Preview builds
  // with the developer's persistent identity, never production/release builds.
  const isPreview = args.some((arg) => arg.includes('tauri.preview.conf.json'))
  const identity = isPreview && !env.APPLE_SIGNING_IDENTITY ? localSigningIdentity() : null
  if (identity) {
    env.APPLE_SIGNING_IDENTITY = identity.hash
    console.log(`Signing Tauthy Preview with ${identity.name}.`)
  }
}

const child = spawn(process.execPath, [tauriCli, ...args], {
  cwd: projectRoot,
  env,
  stdio: 'inherit',
})

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
