import { beforeEach, expect, it, vi } from 'vitest'

const invoke = vi.hoisted(() => vi.fn())
vi.mock('@tauri-apps/api/core', () => ({ invoke }))

import { exportDiagnostics, recordDiagnostic } from './diagnostics'

beforeEach(() => {
  invoke.mockReset()
  invoke.mockResolvedValue('diagnostic text')
})

it('records only an allowlisted code, never a raw provider error', async () => {
  recordDiagnostic('sync.now.error', 'syncUnavailable')
  recordDiagnostic('sync.now.error', 'syncDeviceFileInvalid: private filename')
  recordDiagnostic('import.error', new Error('importEncryptedWrongPassword'))
  recordDiagnostic('pubky.delete.error', 'syncRemoteDeleteIncomplete')
  await exportDiagnostics()

  expect(invoke).toHaveBeenCalledWith('diagnostics_record', {
    stage: 'sync.now.error',
    code: 'syncUnavailable',
  })
  expect(invoke).toHaveBeenCalledWith('diagnostics_record', {
    stage: 'sync.now.error',
    code: 'other',
  })
  expect(invoke).toHaveBeenCalledWith('diagnostics_record', {
    stage: 'import.error',
    code: 'importEncryptedWrongPassword',
  })
  expect(invoke).toHaveBeenCalledWith('diagnostics_record', {
    stage: 'pubky.delete.error',
    code: 'syncRemoteDeleteIncomplete',
  })
  expect(invoke).toHaveBeenLastCalledWith('diagnostics_export')
})

it('keeps logging failures from affecting the app', async () => {
  invoke.mockRejectedValueOnce(new Error('logger unavailable'))
  recordDiagnostic('vault.init.start')
  recordDiagnostic('vault.init.ok')
  await exportDiagnostics()
  expect(invoke).toHaveBeenCalledWith('diagnostics_record', {
    stage: 'vault.init.ok',
    code: null,
  })
})
