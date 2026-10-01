import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  confirm: vi.fn(),
  open: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  deletePubkySyncData: vi.fn(),
  getSyncStatus: vi.fn(),
  getBackgroundSyncError: vi.fn(),
  syncNow: vi.fn(),
  mergeConflictedSyncCopy: vi.fn(),
  navigate: vi.fn(),
  getPubkyRecoveryCode: vi.fn(),
  copy: vi.fn(),
}))

vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.navigate }))
vi.mock('@tauri-apps/plugin-dialog', () => ({
  confirm: mocks.confirm,
  open: mocks.open,
}))
vi.mock('react-hot-toast', () => ({
  default: { error: mocks.toastError, success: mocks.toastSuccess },
}))
vi.mock('~/utils/helpers', () => ({ copyToClipboard: mocks.copy }))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { file?: string }) =>
      options?.file ? `${key}: ${options.file}` : key,
    i18n: { language: 'en' },
  }),
}))
vi.mock('~/utils/sync', () => ({
  createSync: vi.fn(),
  deletePubkySyncData: mocks.deletePubkySyncData,
  disconnectSync: vi.fn(),
  getSyncStatus: mocks.getSyncStatus,
  getPubkyRecoveryCode: mocks.getPubkyRecoveryCode,
  getBackgroundSyncError: mocks.getBackgroundSyncError,
  joinSync: vi.fn(),
  mergeConflictedSyncCopy: mocks.mergeConflictedSyncCopy,
  syncNow: mocks.syncNow,
  SYNC_BACKGROUND_ERROR_EVENT: 'tauthy:sync-background-error',
  SYNC_STATUS_EVENT: 'tauthy:sync-status',
}))

import Sync from '~/components/Sync'

describe('sync location pickers', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
    mocks.open.mockReset()
    mocks.confirm.mockReset()
    mocks.toastError.mockReset()
    mocks.toastSuccess.mockReset()
    mocks.deletePubkySyncData.mockReset()
    mocks.syncNow.mockReset()
    mocks.getPubkyRecoveryCode.mockReset()
    mocks.copy.mockReset()
    mocks.getBackgroundSyncError.mockReset()
    mocks.getBackgroundSyncError.mockReturnValue(undefined)
    mocks.getSyncStatus.mockResolvedValue({ enabled: false, path: null, lastSyncedAt: null })
  })

  it('offers folder and Pubky as separate sync methods', async () => {
    render(<Sync />)

    fireEvent.click(await screen.findByText('sync.folder'))
    expect(mocks.navigate).toHaveBeenCalledWith('/sync/folder')

    fireEvent.click(screen.getByText('sync.pubky'))
    expect(mocks.navigate).toHaveBeenCalledWith('/sync/pubky')
    expect(screen.queryByText('sync.create')).not.toBeInTheDocument()
    expect(screen.queryByText('sync.join')).not.toBeInTheDocument()
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
    mocks.syncNow.mockResolvedValue({
      enabled: true,
      path: '/cloud/sync',
      lastSyncedAt: Date.now(),
    })

    fireEvent.click(screen.getByText('sync.retry'))
    await waitFor(() => expect(mocks.syncNow).toHaveBeenCalledOnce())

    mocks.getBackgroundSyncError.mockReturnValue(undefined)
    window.dispatchEvent(new Event('tauthy:sync-background-error'))

    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  })

  it('updates the last synced display after a successful background check', async () => {
    mocks.getSyncStatus.mockResolvedValue({
      enabled: true,
      path: '/cloud/sync',
      lastSyncedAt: null,
    })
    render(<Sync />)
    await screen.findByText('sync.never')

    act(() => {
      window.dispatchEvent(
        new CustomEvent('tauthy:sync-status', {
          detail: { enabled: true, path: '/cloud/sync', lastSyncedAt: Date.now() },
        }),
      )
    })

    expect(screen.queryByText('sync.never')).not.toBeInTheDocument()
  })

  it('uses secondary body typography for the introduction', async () => {
    render(<Sync />)

    expect(await screen.findByText('sync.chooseMethod')).toHaveClass('MuiTypography-body2')
  })

  it('shows Pubky settings without folder-only recovery tools', async () => {
    window.sessionStorage.setItem('tauthy:sync-recovery-tools', 'true')
    mocks.getSyncStatus.mockResolvedValue({
      enabled: true,
      provider: 'pubky',
      path: 'user',
      lastSyncedAt: null,
    })
    render(<Sync />)

    expect(await screen.findByText('sync.pubky')).toBeInTheDocument()
    expect(screen.getByText('sync.status')).toBeInTheDocument()
    expect(screen.getByText('sync.recovery')).toBeInTheDocument()
    expect(screen.getByText('sync.pubkyShowCode')).toBeInTheDocument()
    expect(screen.getByText('sync.pubkyDelete')).toBeInTheDocument()
    expect(screen.queryByText('sync.mergeConflictedCopy')).not.toBeInTheDocument()
  })

  it('only deletes Pubky data after confirmation, then disconnects this device', async () => {
    mocks.getSyncStatus.mockResolvedValue({ enabled: true, provider: 'pubky', path: 'user' })
    mocks.confirm.mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    mocks.deletePubkySyncData.mockResolvedValue({ enabled: false })
    render(<Sync />)

    fireEvent.click(await screen.findByText('sync.pubkyDelete'))
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledOnce())
    expect(mocks.deletePubkySyncData).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText('sync.pubkyDelete'))
    await waitFor(() => expect(mocks.deletePubkySyncData).toHaveBeenCalledOnce())
    expect(mocks.confirm).toHaveBeenCalledWith(
      'sync.pubkyDeleteWarning',
      expect.objectContaining({ okLabel: 'sync.pubkyDelete', kind: 'warning' }),
    )
    expect(mocks.toastSuccess).toHaveBeenCalledWith('toasts.pubkyDeleted')
    expect(await screen.findByText('sync.chooseMethod')).toBeInTheDocument()
  })

  it('keeps Pubky connected and explains an incomplete remote deletion', async () => {
    mocks.getSyncStatus.mockResolvedValue({ enabled: true, provider: 'pubky', path: 'user' })
    mocks.confirm.mockResolvedValue(true)
    mocks.deletePubkySyncData.mockRejectedValue('syncRemoteDeleteIncomplete')
    render(<Sync />)

    fireEvent.click(await screen.findByText('sync.pubkyDelete'))
    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith('toasts.syncRemoteDeleteIncomplete'),
    )
    expect(screen.getByText('sync.pubkyDelete')).toBeInTheDocument()
  })

  it('shows the Pubky recovery code as selectable text rather than a field', async () => {
    const code = 'a'.repeat(64)
    mocks.getSyncStatus.mockResolvedValue({
      enabled: true,
      provider: 'pubky',
      path: 'user',
      lastSyncedAt: null,
    })
    mocks.getPubkyRecoveryCode.mockResolvedValue(code)
    render(<Sync />)

    fireEvent.click(await screen.findByText('sync.pubkyShowCode'))

    const displayedCode = await screen.findByText(code)
    expect(displayedCode.tagName).toBe('CODE')
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'sync.pubkyCopyCode' }))
    expect(mocks.copy).toHaveBeenCalledWith(code)
  })
})
