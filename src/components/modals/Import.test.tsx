import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('~/hooks/useBackupStatus', () => ({ useBackupStatus: () => undefined }))
import { AppBarBackContext } from '~/context'

const mocks = vi.hoisted(() => ({
  prepareImport: vi.fn(),
  prepareGoogleImport: vi.fn(),
  scanGoogleQrImage: vi.fn(),
  commitPreparedImport: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  setBackDisabled: vi.fn(),
  recordDiagnostic: vi.fn(),
  platform: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-os', () => ({ type: mocks.platform }))

vi.mock('~/utils', () => ({
  prepareImport: mocks.prepareImport,
  prepareGoogleImport: mocks.prepareGoogleImport,
  commitPreparedImport: mocks.commitPreparedImport,
}))
vi.mock('~/utils/googleAuthenticator', async (importOriginal) => ({
  ...(await importOriginal<typeof import('~/utils/googleAuthenticator')>()),
  scanGoogleQrImage: mocks.scanGoogleQrImage,
}))
vi.mock('react-hot-toast', () => ({
  default: { success: mocks.toastSuccess, error: mocks.toastError },
}))
vi.mock('~/utils/diagnostics', () => ({ recordDiagnostic: mocks.recordDiagnostic }))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { total?: number; shortcut?: string }) =>
      options?.total !== undefined
        ? `${key}: ${options.total}`
        : options?.shortcut
          ? `${key}: ${options.shortcut}`
          : key === 'import.googlePasteControl'
            ? 'Ctrl+V'
            : key,
  }),
}))
vi.mock('~/components/Modal', () => ({
  default: ({
    open,
    title,
    children,
  }: {
    open: boolean
    title: string
    children: React.ReactNode
  }) =>
    open ? (
      <div role="dialog" aria-label={title}>
        <h2>{title}</h2>
        {children}
      </div>
    ) : null,
  Buttons: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))
vi.mock('~/components/modals/ExportPassword', () => ({ default: () => null }))

import Import from '~/components/Import'
import ImportReview from '~/components/ImportReview'
import GoogleImport from '~/components/GoogleImport'

const entries = [
  { uuid: 'one', issuer: 'Example', name: 'alice', secret: 'JBSWY3DPEHPK3PXP' },
  { uuid: 'two', issuer: 'Other', name: 'bob', secret: 'MZXW6YTBOI' },
]

const renderImport = (initialPath = '/import') =>
  render(
    <AppBarBackContext.Provider
      value={{ backDisabled: false, setBackDisabled: mocks.setBackDisabled }}
    >
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/import" element={<Import />}>
            <Route path="review" element={<ImportReview />} />
            <Route path="google" element={<GoogleImport />} />
          </Route>
          <Route path="/" element={<div>Home</div>} />
        </Routes>
      </MemoryRouter>
    </AppBarBackContext.Provider>,
  )

const chooseFile = (label: string) => {
  fireEvent.click(screen.getByText('import.import'))
  fireEvent.click(screen.getByText(label))
  const input = document.querySelector('input[type="file"]') as HTMLInputElement
  if (label === 'import.otpAuth') expect(input.accept).toBe('.txt,.uris')
  fireEvent.change(input, { target: { files: [new File(['backup'], 'accounts.txt')] } })
}

describe('import review', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset())
    mocks.platform.mockReturnValue('macos')
    mocks.prepareImport.mockImplementation(async (_file, format) => ({
      format,
      sourceName: 'accounts.txt',
      entries,
      newCount: 1,
      duplicateCount: 1,
      duplicateIndices: [0],
    }))
    mocks.commitPreparedImport.mockResolvedValue(1)
    mocks.prepareGoogleImport.mockImplementation(async () => ({
      format: 'google',
      sourceName: 'Google Authenticator',
      entries,
      newCount: 2,
      duplicateCount: 0,
      duplicateIndices: [],
    }))
  })

  it('shows locally bundled, decorative provider logos beside accessible labels', () => {
    renderImport()
    fireEvent.click(screen.getByText('import.import'))

    for (const label of [
      '2FAS',
      'Aegis',
      'andOTP',
      'Authy',
      'Bitwarden',
      'Ente Auth',
      'Google Authenticator',
      'Proton Authenticator',
      'Tauthy',
    ]) {
      const button = screen.getByRole('button', { name: label })
      const logo = button.querySelector('img')
      expect(logo).toHaveAttribute('alt', '')
      expect(logo?.getAttribute('src')).toBeTruthy()
      expect(logo?.getAttribute('src')).not.toMatch(/^https?:/)
      expect(logo?.parentElement).toHaveAttribute('aria-hidden', 'true')
    }
    expect(screen.getByRole('button', { name: 'import.otpAuth' })).toBeInTheDocument()
  })

  it.each([
    ['macos', '⌘V'],
    ['windows', 'Ctrl+V'],
    ['linux', 'Ctrl+V'],
  ])('shows only the %s paste shortcut', (platform, shortcut) => {
    mocks.platform.mockReturnValue(platform)
    renderImport('/import/google')
    expect(screen.getByText(`import.googlePaste: ${shortcut}`)).toBeInTheDocument()
  })

  it('collects all Google QR images before opening review', async () => {
    renderImport()
    fireEvent.click(screen.getByText('import.import'))
    fireEvent.click(screen.getByRole('button', { name: 'Google Authenticator' }))
    expect(screen.getByText('import.googleChooseImages')).toBeInTheDocument()
    const input = document.querySelector('input[type="file"][multiple]') as HTMLInputElement
    const first = new File(['first'], 'first.png', { type: 'image/png' })
    const second = new File(['second'], 'second.png', { type: 'image/png' })
    mocks.scanGoogleQrImage
      .mockResolvedValueOnce({
        batchId: 123,
        batchSize: 2,
        batchIndex: 0,
        data: 'first',
        accounts: [{ name: 'alice', secret: 'JBSWY3DP' }],
      })
      .mockResolvedValueOnce({
        batchId: 123,
        batchSize: 2,
        batchIndex: 1,
        data: 'second',
        accounts: [{ name: 'bob', secret: 'MZXW6YTB' }],
      })

    fireEvent.change(input, { target: { files: [first] } })
    expect(await screen.findByText('import.googleProgress: 2')).toBeInTheDocument()
    expect(mocks.prepareGoogleImport).not.toHaveBeenCalled()
    fireEvent.change(input, { target: { files: [second] } })
    expect(await screen.findByText('alice')).toBeInTheDocument()
    expect(mocks.prepareGoogleImport).toHaveBeenCalledWith([
      { name: 'alice', secret: 'JBSWY3DP' },
      { name: 'bob', secret: 'MZXW6YTB' },
    ])
    expect(mocks.commitPreparedImport).not.toHaveBeenCalled()
  })

  it('accepts a pasted Google QR image', async () => {
    renderImport()
    fireEvent.click(screen.getByText('import.import'))
    fireEvent.click(screen.getByRole('button', { name: 'Google Authenticator' }))
    const image = new File(['qr'], 'clipboard.png', { type: 'image/png' })
    mocks.scanGoogleQrImage.mockResolvedValue({
      batchId: 123,
      batchSize: 1,
      batchIndex: 0,
      data: 'single',
      accounts: [{ name: 'alice', secret: 'JBSWY3DP' }],
    })

    fireEvent.paste(window, {
      clipboardData: { items: [{ type: 'image/png', getAsFile: () => image }] },
    })
    await waitFor(() => expect(mocks.scanGoogleQrImage).toHaveBeenCalledWith(image))
    expect(await screen.findByText('alice')).toBeInTheDocument()
    expect(mocks.commitPreparedImport).not.toHaveBeenCalled()
  })

  it('keeps an incomplete transfer intact after a different export is selected', async () => {
    renderImport()
    fireEvent.click(screen.getByText('import.import'))
    fireEvent.click(screen.getByRole('button', { name: 'Google Authenticator' }))
    const input = document.querySelector('input[type="file"][multiple]') as HTMLInputElement
    const image = new File(['qr'], 'part.png', { type: 'image/png' })
    mocks.scanGoogleQrImage
      .mockResolvedValueOnce({
        batchId: 123,
        batchSize: 2,
        batchIndex: 0,
        data: 'first',
        accounts: [{ name: 'alice', secret: 'JBSWY3DP' }],
      })
      .mockResolvedValueOnce({
        batchId: 456,
        batchSize: 2,
        batchIndex: 1,
        data: 'foreign',
        accounts: [{ name: 'bob', secret: 'MZXW6YTB' }],
      })

    fireEvent.change(input, { target: { files: [image] } })
    expect(await screen.findByText('import.googleProgress: 2')).toBeInTheDocument()
    fireEvent.change(input, { target: { files: [image] } })
    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith('toasts.importGoogleDifferentTransfer'),
    )
    expect(screen.getByText('import.googleProgress: 2')).toBeInTheDocument()
    expect(mocks.prepareGoogleImport).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'import.googleStartOver' }))
    expect(screen.queryByText('import.googleProgress: 2')).not.toBeInTheDocument()
  })

  it.each([
    ['Aegis', 'aegis'],
    ['Authy', 'authy'],
    ['Tauthy', 'tauthy'],
  ])(
    'handles %s selection when the native picker returns before React commits',
    async (label, format) => {
      renderImport()
      fireEvent.click(screen.getByText('import.import'))
      const input = document.querySelector('input[type="file"]') as HTMLInputElement
      const file = new File(['backup'], 'accounts.json')
      vi.spyOn(input, 'click').mockImplementation(() => {
        fireEvent.change(input, { target: { files: [file] } })
      })
      fireEvent.click(screen.getByText(label))
      expect(await screen.findByText('accounts.txt')).toBeInTheDocument()
      expect(mocks.prepareImport).toHaveBeenCalledExactlyOnceWith(file, format)
      expect(mocks.commitPreparedImport).not.toHaveBeenCalled()
    },
  )

  it.each([
    '2FAS',
    'Aegis',
    'andOTP',
    'Authy',
    'Bitwarden',
    'Ente Auth',
    'Proton Authenticator',
    'Tauthy',
    'import.otpAuth',
  ])('reviews %s account metadata before allowing an import', async (label) => {
    renderImport()
    chooseFile(label)

    expect(await screen.findByText('accounts.txt')).toBeInTheDocument()
    expect(screen.queryByText('modals.importPreviewTitle')).not.toBeInTheDocument()
    expect(screen.getByText('alice')).toBeInTheDocument()
    expect(screen.getByText('bob')).toBeInTheDocument()
    expect(screen.queryByText('JBSWY3DPEHPK3PXP')).not.toBeInTheDocument()
    expect(mocks.commitPreparedImport).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText('modals.cancel'))
    expect(mocks.commitPreparedImport).not.toHaveBeenCalled()
    expect(await screen.findByText('import.import')).toBeInTheDocument()
  })

  it('commits the reviewed entries only after confirmation', async () => {
    renderImport()
    chooseFile('import.otpAuth')
    await screen.findByText('accounts.txt')

    fireEvent.click(screen.getByText('modals.import'))

    await waitFor(() =>
      expect(mocks.commitPreparedImport).toHaveBeenCalledWith(
        expect.objectContaining({ format: 'otpauth', entries }),
      ),
    )
    expect(mocks.toastSuccess).toHaveBeenCalledWith('toasts.imported')
    expect(await screen.findByText('Home')).toBeInTheDocument()
  })

  it('holds back navigation disabled until the import finishes', async () => {
    let finishImport!: (count: number) => void
    mocks.commitPreparedImport.mockImplementationOnce(
      () => new Promise<number>((resolve) => (finishImport = resolve)),
    )
    renderImport()
    chooseFile('Tauthy')
    await screen.findByText('accounts.txt')

    fireEvent.click(screen.getByText('modals.import'))
    expect(mocks.setBackDisabled).toHaveBeenCalledWith(true)
    expect(screen.getByRole('button', { name: 'modals.cancel' })).toBeDisabled()

    await act(async () => finishImport(1))
    expect(mocks.setBackDisabled).toHaveBeenCalledWith(false)
    expect(await screen.findByText('Home')).toBeInTheDocument()
  })

  it('does not claim accounts were imported when they became duplicates before confirmation', async () => {
    mocks.commitPreparedImport.mockResolvedValueOnce(0)
    renderImport()
    chooseFile('Tauthy')
    await screen.findByText('accounts.txt')

    fireEvent.click(screen.getByText('modals.import'))

    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalledWith('modals.importNoNew'))
    expect(await screen.findByText('Home')).toBeInTheDocument()
  })

  it('shows all accounts in one scrollable review list', async () => {
    mocks.prepareImport.mockResolvedValue({
      format: 'otpauth',
      sourceName: 'many.txt',
      entries: Array.from({ length: 25 }, (_, index) => ({
        uuid: `entry-${index}`,
        name: `account-${index}`,
        secret: 'JBSWY3DPEHPK3PXP',
      })),
      newCount: 25,
      duplicateCount: 0,
      duplicateIndices: [],
    })
    const { container } = renderImport()
    chooseFile('import.otpAuth')
    await screen.findByText('many.txt')

    expect(screen.getByText('account-0')).toBeInTheDocument()
    expect(screen.getByText('account-8')).toBeInTheDocument()
    expect(screen.getByText('account-24')).toBeInTheDocument()
    expect(container.querySelector('.MuiListItem-divider')).toBeNull()
    expect(screen.queryByText('modals.importPreviewNext')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'modals.cancel' })).toHaveClass('MuiButton-outlined')
    expect(screen.getByRole('button', { name: 'modals.import' })).toHaveClass('MuiButton-contained')
  })

  it('returns to import options when review is opened without a prepared file', async () => {
    renderImport('/import/review')
    expect(await screen.findByText('import.import')).toBeInTheDocument()
    expect(mocks.commitPreparedImport).not.toHaveBeenCalled()
  })

  it('shows the authenticator-link option without a subtitle', () => {
    renderImport()
    fireEvent.click(screen.getByText('import.import'))
    expect(screen.getByText('import.otpAuth')).toBeInTheDocument()
    expect(screen.queryByText('import.otpAuthDescription')).not.toBeInTheDocument()
  })

  it('decrypts a protected backup before review, never before confirmation', async () => {
    mocks.prepareImport.mockRejectedValueOnce(new Error('importPasswordRequired'))
    renderImport()
    chooseFile('Tauthy')
    expect(await screen.findByText('modals.importPasswordTitle')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('modals.importPasswordLabel'), {
      target: { value: 'backup password' },
    })
    fireEvent.click(screen.getByText('modals.import'))

    expect(await screen.findByText('accounts.txt')).toBeInTheDocument()
    expect(mocks.prepareImport).toHaveBeenLastCalledWith(
      expect.any(File),
      'tauthy',
      'backup password',
    )
    expect(mocks.commitPreparedImport).not.toHaveBeenCalled()
  })

  it('keeps the password prompt open after a wrong password and reviews after retry', async () => {
    mocks.prepareImport
      .mockRejectedValueOnce(new Error('importPasswordRequired'))
      .mockRejectedValueOnce(new Error('importEncryptedAuthenticationFailed'))
    renderImport()
    chooseFile('Tauthy')
    await screen.findByText('modals.importPasswordTitle')

    fireEvent.change(screen.getByLabelText('modals.importPasswordLabel'), {
      target: { value: 'wrong password' },
    })
    fireEvent.click(screen.getByText('modals.import'))
    expect(
      await screen.findByText('toasts.importEncryptedAuthenticationFailed'),
    ).toBeInTheDocument()
    expect(mocks.commitPreparedImport).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('modals.importPasswordLabel'), {
      target: { value: 'correct password' },
    })
    fireEvent.click(screen.getByText('modals.import'))
    expect(await screen.findByText('accounts.txt')).toBeInTheDocument()
    expect(mocks.commitPreparedImport).not.toHaveBeenCalled()
  })
})
