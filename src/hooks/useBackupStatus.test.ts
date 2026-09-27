import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const getVault = vi.hoisted(() => vi.fn())
vi.mock('~/utils/storage', () => ({ vault: { getVault } }))
vi.mock('~/utils/sync', () => ({ SYNC_COMPLETE_EVENT: 'tauthy:sync-complete' }))
import { useBackupStatus } from './useBackupStatus'
import { recordBackupExport, VAULT_DATA_EVENT } from '~/utils/backupStatus'
import type { VaultEntry } from '~/types'
const entries = [{ uuid: 'a', name: 'Dropbox', secret: 'ABC234' }]

describe('backup status refresh', () => {
  beforeEach(() => {
    localStorage.clear()
    getVault.mockReset().mockResolvedValue(entries)
  })
  it('refreshes after local edits and remote sync', async () => {
    await recordBackupExport(entries, true)
    const { result } = renderHook(useBackupStatus)
    await waitFor(() => expect(result.current?.state).toBe('current'))
    getVault.mockResolvedValue([{ ...entries[0], name: 'Changed' }])
    act(() => window.dispatchEvent(new Event(VAULT_DATA_EVENT)))
    await waitFor(() => expect(result.current?.state).toBe('changed'))
    getVault.mockResolvedValue(entries)
    act(() => window.dispatchEvent(new Event('tauthy:sync-complete')))
    await waitFor(() => expect(result.current?.state).toBe('current'))
  })
  it('hides status when a locked vault cannot be read', async () => {
    const { result } = renderHook(useBackupStatus)
    await waitFor(() => expect(result.current?.state).toBe('never'))
    getVault.mockRejectedValue(Error('locked'))
    act(() => window.dispatchEvent(new Event(VAULT_DATA_EVENT)))
    await waitFor(() => expect(result.current).toBeUndefined())
  })
  it('does not replace fresh status with a stale asynchronous read', async () => {
    await recordBackupExport(entries, true)
    let finish: (entries: VaultEntry[]) => void = () => {}
    getVault.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const { result } = renderHook(useBackupStatus)
    act(() => window.dispatchEvent(new Event(VAULT_DATA_EVENT)))
    await waitFor(() => expect(result.current?.state).toBe('current'))
    await act(async () => finish([{ ...entries[0], name: 'Old read' }]))
    expect(result.current?.state).toBe('current')
  })
})
