import { beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.hoisted(() => vi.fn())
vi.mock('@tauri-apps/api/core', () => ({ invoke }))

import {
  createSync,
  joinSync,
  mergeConflictedSyncCopy,
  SYNC_COMPLETE_EVENT,
  syncNow,
} from '~/utils/sync'

describe('sync commands', () => {
  beforeEach(() => invoke.mockReset())

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
})
