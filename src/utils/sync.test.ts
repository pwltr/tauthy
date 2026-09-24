import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), toastError: vi.fn() }))
const invoke = mocks.invoke
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }))
vi.mock('react-hot-toast', () => ({ default: { error: mocks.toastError } }))
vi.mock('~/utils/i18n', () => ({ default: { t: (key: string) => key } }))

import {
  createSync,
  getBackgroundSyncError,
  joinSync,
  mergeConflictedSyncCopy,
  SYNC_BACKGROUND_ERROR_EVENT,
  SYNC_COMPLETE_EVENT,
  syncInBackground,
  syncNow,
} from '~/utils/sync'

describe('sync commands', () => {
  beforeEach(async () => {
    invoke.mockReset()
    invoke.mockResolvedValue({ enabled: true })
    await syncNow()
    invoke.mockReset()
    mocks.toastError.mockReset()
  })

  it.each([
    ['sync_create', () => createSync('/cloud/Tauthy.tauthy-sync', 'recovery password')],
    ['sync_join', () => joinSync('/cloud/Tauthy.tauthy-sync', 'recovery password')],
    ['sync_now', () => syncNow()],
    ['sync_merge_conflicted_copy', () => mergeConflictedSyncCopy('/cloud/conflicted copy')],
  ])(
    'announces a completed %s operation so cached vault data is reloaded',
    async (command, run) => {
      invoke.mockResolvedValue({ enabled: true })
      const listener = vi.fn()
      window.addEventListener(SYNC_COMPLETE_EVENT, listener)

      await run()

      if (command === 'sync_now') {
        expect(invoke).toHaveBeenCalledWith(command)
      } else if (command === 'sync_merge_conflicted_copy') {
        expect(invoke).toHaveBeenCalledWith(command, { path: '/cloud/conflicted copy' })
      } else {
        expect(invoke).toHaveBeenCalledWith(command, {
          path: '/cloud/Tauthy.tauthy-sync',
          password: 'recovery password',
        })
      }
      expect(listener).toHaveBeenCalledOnce()
      window.removeEventListener(SYNC_COMPLETE_EVENT, listener)
    },
  )

  it('reports an automatic failure once and keeps it visible until a successful sync', async () => {
    const listener = vi.fn()
    window.addEventListener(SYNC_BACKGROUND_ERROR_EVENT, listener)
    invoke.mockRejectedValue('syncUnavailable')

    await syncInBackground()
    await syncInBackground()

    expect(getBackgroundSyncError()).toBe('syncUnavailable')
    expect(mocks.toastError).toHaveBeenCalledOnce()
    expect(mocks.toastError).toHaveBeenCalledWith('toasts.syncBackgroundFailed', {
      duration: 8000,
    })
    expect(listener).toHaveBeenCalled()

    invoke.mockResolvedValue({ enabled: true })
    await syncInBackground()

    expect(getBackgroundSyncError()).toBeUndefined()
    window.removeEventListener(SYNC_BACKGROUND_ERROR_EVENT, listener)
  })

  it.each(['syncNotConfigured', 'vault is locked'])(
    'ignores expected background error %s',
    async (error) => {
      invoke.mockRejectedValue(error)

      await syncInBackground()

      expect(getBackgroundSyncError()).toBeUndefined()
      expect(mocks.toastError).not.toHaveBeenCalled()
    },
  )
})
