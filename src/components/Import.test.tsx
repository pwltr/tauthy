import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  message: vi.fn(),
  confirm: vi.fn(),
  exportCodes: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}))
vi.mock('@tauri-apps/plugin-dialog', () => ({ message: mocks.message, confirm: mocks.confirm }))
vi.mock('~/utils', () => ({ exportCodes: mocks.exportCodes }))
vi.mock('react-hot-toast', () => ({ default: { success: mocks.success, error: mocks.error } }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('~/components/modals/Import', () => ({ default: () => null }))
vi.mock('~/components/modals/ExportPassword', () => ({
  default: ({
    open,
    busy,
    onSubmit,
  }: {
    open: boolean
    busy: boolean
    onSubmit: (password: string) => void
  }) =>
    open ? (
      <button disabled={busy} onClick={() => onSubmit('backup password')}>
        Submit backup password
      </button>
    ) : null,
}))

import Import from '~/components/Import'

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/import']}>
      <Import />
    </MemoryRouter>,
  )
const chooseExport = () => fireEvent.click(screen.getByRole('button', { name: /import.export / }))

describe('native export choice', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset())
    mocks.exportCodes.mockResolvedValue('exportSuccess')
  })

  it('has one export row and a localized three-button native dialog', async () => {
    mocks.message.mockResolvedValue('modals.cancel')
    renderPage()
    chooseExport()
    await waitFor(() =>
      expect(mocks.message).toHaveBeenCalledWith('', {
        title: 'import.exportTitle',
        buttons: {
          yes: 'import.exportEncrypted',
          no: 'import.exportPlaintext',
          cancel: 'modals.cancel',
        },
      }),
    )
    expect(screen.queryByText('import.exportEncrypted')).not.toBeInTheDocument()
    expect(screen.queryByText('import.exportPlaintext')).not.toBeInTheDocument()
    expect(mocks.exportCodes).not.toHaveBeenCalled()
  })

  it('opens password protection only after that choice and exports on submission', async () => {
    mocks.message.mockResolvedValue('import.exportEncrypted')
    renderPage()
    chooseExport()
    const submit = await screen.findByRole('button', { name: 'Submit backup password' })
    expect(mocks.exportCodes).not.toHaveBeenCalled()
    expect(mocks.confirm).not.toHaveBeenCalled()
    fireEvent.click(submit)
    await waitFor(() => expect(mocks.exportCodes).toHaveBeenCalledWith('backup password'))
    await waitFor(() => expect(mocks.success).toHaveBeenCalledWith('toasts.exportSuccess'))
  })

  it('requires the existing plaintext warning before exporting', async () => {
    mocks.message.mockResolvedValue('import.exportPlaintext')
    mocks.confirm.mockResolvedValue(true)
    renderPage()
    chooseExport()
    await waitFor(() =>
      expect(mocks.confirm).toHaveBeenCalledWith('modals.exportWarning', {
        title: 'import.export',
        kind: 'warning',
        okLabel: 'import.export',
        cancelLabel: 'modals.cancel',
      }),
    )
    await waitFor(() => expect(mocks.exportCodes).toHaveBeenCalledWith(undefined))
    expect(screen.queryByText('Submit backup password')).not.toBeInTheDocument()
  })

  it('does nothing when the plaintext warning is cancelled', async () => {
    mocks.message.mockResolvedValue('import.exportPlaintext')
    mocks.confirm.mockResolvedValue(false)
    renderPage()
    chooseExport()
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalled())
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /import.export / })).toBeEnabled(),
    )
    expect(mocks.exportCodes).not.toHaveBeenCalled()
  })

  it.each(['modals.cancel', 'Cancel', undefined])(
    'does not export on cancel or dismiss: %s',
    async (result) => {
      mocks.message.mockResolvedValue(result)
      renderPage()
      chooseExport()
      await waitFor(() =>
        expect(screen.getByRole('button', { name: /import.export / })).toBeEnabled(),
      )
      expect(mocks.exportCodes).not.toHaveBeenCalled()
      expect(mocks.confirm).not.toHaveBeenCalled()
      expect(screen.queryByText('Submit backup password')).not.toBeInTheDocument()
    },
  )

  it('disables repeated clicks until the native dialog finishes', async () => {
    mocks.message.mockReturnValue(new Promise(() => {}))
    renderPage()
    chooseExport()
    chooseExport()
    expect(mocks.message).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: /import.export / })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
  })

  it('reports a native dialog failure and allows retry', async () => {
    mocks.message.mockRejectedValue(new Error('dialog unavailable'))
    renderPage()
    chooseExport()
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith('toasts.exportFailed'))
    expect(screen.getByRole('button', { name: /import.export / })).toBeEnabled()
    expect(mocks.exportCodes).not.toHaveBeenCalled()
  })
})
