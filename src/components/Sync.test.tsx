import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  open: vi.fn(),
  toastError: vi.fn(),
  getSyncStatus: vi.fn(),
  mergeConflictedSyncCopy: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({
  confirm: vi.fn(),
  open: mocks.open,
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

describe('sync location pickers', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
    mocks.open.mockReset()
    mocks.toastError.mockReset()
    mocks.getSyncStatus.mockResolvedValue({ enabled: false, path: null, lastSyncedAt: null })
  })

  it.each(['sync.create', 'sync.join', 'sync.joinLegacy'])(
    'reports a rejected %s picker',
    async (label) => {
      mocks.open.mockRejectedValue(new Error('picker unavailable'))
      render(<Sync />)

      fireEvent.click(await screen.findByText(label))

      await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith('toasts.syncPickerFailed'))
    },
  )

  it.each(['sync.create', 'sync.join'])('selects a folder for %s', async (label) => {
    mocks.open.mockResolvedValue(null)
    render(<Sync />)

    fireEvent.click(await screen.findByText(label))

    await waitFor(() =>
      expect(mocks.open).toHaveBeenCalledWith({ multiple: false, directory: true }),
    )
  })

  it('allows joining an older sync file', async () => {
    mocks.open.mockResolvedValue(null)
    render(<Sync />)

    fireEvent.click(await screen.findByText('sync.joinLegacy'))

    await waitFor(() =>
      expect(mocks.open).toHaveBeenCalledWith({
        multiple: false,
        directory: false,
        filters: [{ name: 'Tauthy sync file', extensions: ['tauthy-sync'] }],
      }),
    )
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

  it('uses secondary body typography for the introduction', async () => {
    render(<Sync />)

    expect(await screen.findByText('sync.description')).toHaveClass('MuiTypography-body2')
  })
})
