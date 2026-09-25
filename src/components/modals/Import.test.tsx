import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  prepareImport: vi.fn(),
  commitPreparedImport: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock('~/utils', () => ({
  prepareImport: mocks.prepareImport,
  commitPreparedImport: mocks.commitPreparedImport,
}))
vi.mock('react-hot-toast', () => ({
  default: { success: mocks.toastSuccess, error: mocks.toastError },
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { total?: number }) =>
      options?.total === undefined ? key : `${key}: ${options.total}`,
  }),
}))
vi.mock('~/components/Modal', () => ({
  default: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div>{children}</div> : null,
  Buttons: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

import ImportModal from '~/components/modals/Import'

const entries = [
  { uuid: 'one', issuer: 'Example', name: 'alice', secret: 'JBSWY3DPEHPK3PXP' },
  { uuid: 'two', issuer: 'Other', name: 'bob', secret: 'MZXW6YTBOI' },
]

const renderImport = () =>
  render(
    <MemoryRouter initialEntries={['/import']}>
      <Routes>
        <Route path="/import" element={<ImportModal open onClose={vi.fn()} />} />
        <Route path="/" element={<div>Home</div>} />
      </Routes>
    </MemoryRouter>,
  )

const chooseFile = (label: string) => {
  fireEvent.click(screen.getByText(label))
  const input = document.querySelector('input[type="file"]') as HTMLInputElement
  if (label === 'import.otpAuth') expect(input.accept).toBe('.txt,.uris')
  fireEvent.change(input, { target: { files: [new File(['backup'], 'accounts.txt')] } })
}

describe('import review', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset())
    mocks.prepareImport.mockImplementation(async (_file, format) => ({
      format,
      sourceName: 'accounts.txt',
      entries,
      newCount: 1,
      duplicateCount: 1,
      duplicateIndices: [0],
    }))
    mocks.commitPreparedImport.mockResolvedValue(1)
  })

  it.each(['2FAS', 'Aegis', 'Authy', 'Tauthy', 'import.otpAuth'])(
    'reviews %s account metadata before allowing an import',
    async (label) => {
      renderImport()
      chooseFile(label)

      expect(await screen.findByText('modals.importPreviewTitle')).toBeInTheDocument()
      expect(screen.getByText('alice')).toBeInTheDocument()
      expect(screen.getByText('bob')).toBeInTheDocument()
      expect(screen.queryByText('JBSWY3DPEHPK3PXP')).not.toBeInTheDocument()
      expect(mocks.commitPreparedImport).not.toHaveBeenCalled()

      fireEvent.click(screen.getByText('modals.cancel'))
      expect(mocks.commitPreparedImport).not.toHaveBeenCalled()
    },
  )

  it('commits the reviewed entries only after confirmation', async () => {
    renderImport()
    chooseFile('import.otpAuth')
    await screen.findByText('modals.importPreviewTitle')

    fireEvent.click(screen.getByText('modals.import'))

    await waitFor(() =>
      expect(mocks.commitPreparedImport).toHaveBeenCalledWith(
        expect.objectContaining({ format: 'otpauth', entries }),
      ),
    )
    expect(mocks.toastSuccess).toHaveBeenCalledWith('toasts.imported')
    expect(await screen.findByText('Home')).toBeInTheDocument()
  })

  it('shows a bounded page of a large import with navigation', async () => {
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
    renderImport()
    chooseFile('import.otpAuth')
    await screen.findByText('modals.importPreviewTitle')

    expect(screen.getByText('account-0')).toBeInTheDocument()
    expect(screen.queryByText('account-8')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('modals.importPreviewNext'))
    expect(screen.getByText('account-8')).toBeInTheDocument()
    expect(screen.queryByText('account-0')).not.toBeInTheDocument()
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

    expect(await screen.findByText('modals.importPreviewTitle')).toBeInTheDocument()
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
    expect(await screen.findByText('modals.importPreviewTitle')).toBeInTheDocument()
    expect(mocks.commitPreparedImport).not.toHaveBeenCalled()
  })
})
