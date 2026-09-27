import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const invoke = vi.hoisted(() => vi.fn())
vi.mock('@tauri-apps/api/core', () => ({ invoke }))
import { installImportDiagnostics, traceImport } from './importDiagnostics'

beforeEach(() => {
  invoke.mockReset().mockResolvedValue(undefined)
})
afterEach(() => vi.unstubAllEnvs())

it('does nothing in ordinary builds', () => {
  vi.stubEnv('VITE_IMPORT_DIAGNOSTICS', '')
  const cleanup = installImportDiagnostics()
  traceImport('fileReadStarted')
  window.dispatchEvent(new Event('error'))
  cleanup()
  expect(invoke).not.toHaveBeenCalled()
})

it('logs fixed stages without including frontend exception data', () => {
  vi.stubEnv('VITE_IMPORT_DIAGNOSTICS', '1')
  const cleanup = installImportDiagnostics()
  window.dispatchEvent(
    new ErrorEvent('error', { message: 'secret contents', filename: 'backup.json' }),
  )
  cleanup()
  window.dispatchEvent(new Event('error'))
  expect(invoke.mock.calls).toEqual([
    ['import_diagnostic', { stage: 'frontendReady' }],
    ['import_diagnostic', { stage: 'frontendError' }],
  ])
})

it('diagnostic failures do not reject the import flow', async () => {
  vi.stubEnv('VITE_IMPORT_DIAGNOSTICS', '1')
  invoke.mockRejectedValue(new Error('logging unavailable'))
  traceImport('fileReadStarted')
  await Promise.resolve()
  expect(invoke).toHaveBeenCalledWith('import_diagnostic', { stage: 'fileReadStarted' })
})
