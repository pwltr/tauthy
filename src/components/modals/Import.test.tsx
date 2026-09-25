import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  prepareOtpAuthImport: vi.fn(),
  commitOtpAuthImport: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock('~/utils', () => ({
  prepareOtpAuthImport: mocks.prepareOtpAuthImport,
  commitOtpAuthImport: mocks.commitOtpAuthImport,
  importFile: vi.fn(),
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

const chooseUriList = () => {
  fireEvent.click(screen.getByText('import.otpAuth'))
  const input = document.querySelector('input[type="file"]') as HTMLInputElement
  expect(input.accept).toBe('.txt,.uris')
  fireEvent.change(input, { target: { files: [new File(['uri'], 'accounts.txt')] } })
}

describe('OTPAuth import review', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset())
    mocks.prepareOtpAuthImport.mockResolvedValue({ entries, newCount: 1, duplicateCount: 1 })
    mocks.commitOtpAuthImport.mockResolvedValue(1)
  })

  it('shows account metadata but not secrets and does not import when cancelled', async () => {
    renderImport()
    chooseUriList()

    expect(await screen.findByText('modals.otpAuthPreviewTitle')).toBeInTheDocument()
    expect(screen.getByText('alice')).toBeInTheDocument()
    expect(screen.getByText('bob')).toBeInTheDocument()
    expect(screen.queryByText('JBSWY3DPEHPK3PXP')).not.toBeInTheDocument()
    expect(mocks.commitOtpAuthImport).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText('modals.cancel'))
    expect(mocks.commitOtpAuthImport).not.toHaveBeenCalled()
  })

  it('commits the reviewed entries only after confirmation', async () => {
    renderImport()
    chooseUriList()
    await screen.findByText('modals.otpAuthPreviewTitle')

    fireEvent.click(screen.getByText('modals.import'))

    await waitFor(() => expect(mocks.commitOtpAuthImport).toHaveBeenCalledWith(entries))
    expect(mocks.toastSuccess).toHaveBeenCalledWith('toasts.imported')
    expect(await screen.findByText('Home')).toBeInTheDocument()
  })
})
