import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  open: vi.fn(),
  save: vi.fn(),
  toastError: vi.fn(),
  getSyncStatus: vi.fn(),
  mergeConflictedSyncCopy: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({
  confirm: vi.fn(),
  open: mocks.open,
  save: mocks.save,
}))
vi.mock('react-hot-toast', () => ({ default: { error: mocks.toastError, success: vi.fn() } }))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}))
vi.mock('~/utils/sync', () => ({
  createSync: vi.fn(),
  disconnectSync: vi.fn(),
  getSyncStatus: mocks.getSyncStatus,
  joinSync: vi.fn(),
  mergeConflictedSyncCopy: mocks.mergeConflictedSyncCopy,
  syncNow: vi.fn(),
}))

import Sync from '~/components/Sync'

describe('sync file pickers', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
    mocks.open.mockReset()
    mocks.save.mockReset()
    mocks.toastError.mockReset()
    mocks.getSyncStatus.mockResolvedValue({ enabled: false, path: null, lastSyncedAt: null })
  })

  it.each([
    ['sync.create', mocks.save],
    ['sync.join', mocks.open],
  ])('reports a rejected %s picker', async (label, picker) => {
    picker.mockRejectedValue(new Error('picker unavailable'))
    render(<Sync />)

    fireEvent.click(await screen.findByText(label))

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith('toasts.syncPickerFailed'))
  })

  it('offers conflicted-copy recovery when sync is connected', async () => {
    window.sessionStorage.setItem('tauthy:sync-recovery-tools', 'true')
    mocks.getSyncStatus.mockResolvedValue({
      enabled: true,
      path: '/cloud/sync',
      lastSyncedAt: null,
    })
    mocks.open.mockResolvedValue('/cloud/conflicted copy')
    mocks.mergeConflictedSyncCopy.mockResolvedValue({ enabled: true, path: '/cloud/sync' })
    render(<Sync />)

    fireEvent.click(await screen.findByText('sync.mergeConflictedCopy'))

    await waitFor(() =>
      expect(mocks.mergeConflictedSyncCopy).toHaveBeenCalledWith('/cloud/conflicted copy'),
    )
    expect(mocks.open).toHaveBeenCalledWith({ multiple: false, directory: false })
  })

  it('hides conflicted-copy recovery by default', async () => {
    mocks.getSyncStatus.mockResolvedValue({
      enabled: true,
      path: '/cloud/sync',
      lastSyncedAt: null,
    })
    render(<Sync />)

    await screen.findByText('sync.syncNow')
    expect(screen.queryByText('sync.mergeConflictedCopy')).not.toBeInTheDocument()
  })
})
