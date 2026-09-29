import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  open: vi.fn(),
  toastError: vi.fn(),
  navigate: vi.fn(),
}))

vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.navigate }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: mocks.open }))
vi.mock('react-hot-toast', () => ({ default: { error: mocks.toastError, success: vi.fn() } }))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock('~/utils/sync', () => ({
  createSync: vi.fn(),
  joinSync: vi.fn(),
}))

import FolderSync from '~/components/FolderSync'

describe('folder sync setup', () => {
  beforeEach(() => {
    mocks.open.mockReset()
    mocks.toastError.mockReset()
    mocks.navigate.mockReset()
  })

  it('keeps create and join together on the folder screen', () => {
    render(<FolderSync />)

    expect(screen.getByText('sync.folderSetupDescription')).toHaveClass('MuiTypography-body2')
    expect(screen.getByText('sync.create')).toBeInTheDocument()
    expect(screen.getByText('sync.join')).toBeInTheDocument()
  })

  it.each(['sync.create', 'sync.join'])('selects a folder for %s', async (label) => {
    mocks.open.mockResolvedValue(null)
    render(<FolderSync />)

    fireEvent.click(screen.getByText(label))

    await waitFor(() =>
      expect(mocks.open).toHaveBeenCalledWith({ multiple: false, directory: true }),
    )
  })

  it.each(['sync.create', 'sync.join'])('reports a rejected %s picker', async (label) => {
    mocks.open.mockRejectedValue(new Error('picker unavailable'))
    render(<FolderSync />)

    fireEvent.click(screen.getByText(label))

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith('toasts.syncPickerFailed'))
  })
})
