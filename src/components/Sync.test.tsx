import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  open: vi.fn(),
  toastError: vi.fn(),
  getSyncStatus: vi.fn(),
  getBackgroundSyncError: vi.fn(),
  syncNow: vi.fn(),
  mergeConflictedSyncCopy: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({
  confirm: vi.fn(),
  open: mocks.open,
}))
vi.mock('react-hot-toast', () => ({ default: { error: mocks.toastError, success: vi.fn() } }))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { file?: string }) =>
      options?.file ? `${key}: ${options.file}` : key,
    i18n: { language: 'en' },
  }),
}))
vi.mock('~/utils/sync', () => ({
  createSync: vi.fn(),
  disconnectSync: vi.fn(),
  getSyncStatus: mocks.getSyncStatus,
  getBackgroundSyncError: mocks.getBackgroundSyncError,
  joinSync: vi.fn(),
  mergeConflictedSyncCopy: mocks.mergeConflictedSyncCopy,
  syncNow: mocks.syncNow,
  SYNC_BACKGROUND_ERROR_EVENT: 'tauthy:sync-background-error',
}))

import Sync from '~/components/Sync'

describe('sync location pickers', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
    mocks.open.mockReset()
    mocks.toastError.mockReset()
    mocks.syncNow.mockReset()
    mocks.getBackgroundSyncError.mockReset()
    mocks.getBackgroundSyncError.mockReturnValue(undefined)
    mocks.getSyncStatus.mockResolvedValue({ enabled: false, path: null, lastSyncedAt: null })
  })

  it.each(['sync.create', 'sync.join'])('reports a rejected %s picker', async (label) => {
    mocks.open.mockRejectedValue(new Error('picker unavailable'))
    render(<Sync />)

    fireEvent.click(await screen.findByText(label))

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith('toasts.syncPickerFailed'))
  })

  it.each(['sync.create', 'sync.join'])('selects a folder for %s', async (label) => {
    mocks.open.mockResolvedValue(null)
    render(<Sync />)

    fireEvent.click(await screen.findByText(label))

    await waitFor(() =>
      expect(mocks.open).toHaveBeenCalledWith({ multiple: false, directory: true }),
    )
  })

  it('shows only one way to join', async () => {
    render(<Sync />)

    expect(await screen.findByText('sync.join')).toBeInTheDocument()
    expect(screen.queryByText('sync.joinLegacy')).not.toBeInTheDocument()
  })

  it('offers conflicted-copy recovery when sync is connected', async () => {
    window.sessionStorage.setItem('tauthy:developer-settings', 'true')
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

  it('names an unreadable device file in the sync error', async () => {
    mocks.getSyncStatus.mockResolvedValue({
      enabled: true,
      path: '/cloud/sync',
      lastSyncedAt: null,
    })
    mocks.syncNow.mockRejectedValue(
      'syncDeviceFileInvalid:device-00000000000000000000000000000001.tauthy-sync',
    )
    render(<Sync />)

    fireEvent.click(await screen.findByText('sync.syncNow'))

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        'toasts.syncDeviceFileInvalid: device-00000000000000000000000000000001.tauthy-sync',
      ),
    )
  })

  it('shows a distinct error when the device-file limit is reached', async () => {
    mocks.getSyncStatus.mockResolvedValue({
      enabled: true,
      path: '/cloud/sync',
      lastSyncedAt: null,
    })
    mocks.syncNow.mockRejectedValue('syncDeviceFileLimit')
    render(<Sync />)

    fireEvent.click(await screen.findByText('sync.syncNow'))

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith('toasts.syncDeviceFileLimit'))
  })

  it('shows the last automatic-sync error until a successful sync clears it', async () => {
    mocks.getSyncStatus.mockResolvedValue({
      enabled: true,
      path: '/cloud/sync',
      lastSyncedAt: null,
    })
    mocks.getBackgroundSyncError.mockReturnValue('syncDeviceFileLimit')
    render(<Sync />)

    expect(await screen.findByRole('alert')).toHaveTextContent('toasts.syncDeviceFileLimit')

    mocks.getBackgroundSyncError.mockReturnValue(undefined)
    window.dispatchEvent(new Event('tauthy:sync-background-error'))

    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  })

  it('uses secondary body typography for the introduction', async () => {
    render(<Sync />)

    expect(await screen.findByText('sync.description')).toHaveClass('MuiTypography-body2')
  })
})
