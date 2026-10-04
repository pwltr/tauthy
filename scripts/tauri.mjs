import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

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
