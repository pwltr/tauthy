import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'

// Exercise deletion ordering/routing independently of MUI's portal focus restore.
vi.mock('~/components/Modal', () => ({
  default: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <div>{children}</div> : null,
  Buttons: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

const mocks = vi.hoisted(() => ({
  fileBackend: false,
  create: vi.fn(),
  destroy: vi.fn(),
  unlock: vi.fn(),
  reset: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}))

vi.mock('~/utils/storage', () => ({ vault: mocks }))
vi.mock('react-hot-toast', () => ({
  default: { success: mocks.success, error: mocks.error },
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

import ResetModal from '~/components/modals/Reset'

describe('vault deletion', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.localStorage.setItem('isPasswordSet', 'true')
    mocks.fileBackend = false
    Object.values(mocks).forEach((mock) => {
      if (typeof mock === 'function') mock.mockReset()
    })

    let unlocked = true
    mocks.destroy.mockImplementation(async () => {
      unlocked = false
      localStorage.setItem('isPasswordSet', 'false')
    })
    mocks.unlock.mockImplementation(async (password: string) => {
      if (password !== '') throw new Error('Unexpected password')
      unlocked = true
    })
    mocks.reset.mockImplementation(async () => {
      if (!unlocked) throw new Error('vault is locked')
    })
  })

  it('creates a usable empty file vault only after confirmed deletion finishes', async () => {
    mocks.fileBackend = true
    const order: string[] = []
    mocks.destroy.mockImplementation(async () => {
      order.push('delete')
    })
    mocks.create.mockImplementation(async () => {
      order.push('create')
    })
    render(
      <MemoryRouter initialEntries={['/security']}>
        <Routes>
          <Route path="/security" element={<ResetModal open onClose={vi.fn()} />} />
          <Route path="/" element={<div>Accounts</div>} />
        </Routes>
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'security.deleteVault' }))
    await waitFor(() => expect(screen.getByText('Accounts')).toBeInTheDocument())
    expect(order).toEqual(['delete', 'create'])
    expect(mocks.create).toHaveBeenCalledExactlyOnceWith()
    expect(mocks.unlock).not.toHaveBeenCalled()
    expect(mocks.reset).not.toHaveBeenCalled()
  })

  it('does not create a new vault when deletion cleanup fails', async () => {
    mocks.fileBackend = true
    mocks.destroy.mockRejectedValue({ code: 'vaultReconciliationFailed' })
    const onClose = vi.fn()
    render(
      <MemoryRouter>
        <ResetModal open onClose={onClose} />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'security.deleteVault' }))
    await waitFor(() => expect(mocks.error).toHaveBeenCalled())
    expect(mocks.create).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(mocks.success).not.toHaveBeenCalled()
  })

  it('opens a fresh vault before writing an empty record and returns home', async () => {
    render(
      <MemoryRouter initialEntries={['/security']}>
        <Routes>
          <Route path="/security" element={<ResetModal open onClose={vi.fn()} />} />
          <Route path="/" element={<div>Accounts</div>} />
        </Routes>
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'security.deleteVault' }))

    await waitFor(() => expect(screen.getByText('Accounts')).toBeInTheDocument())
    expect(mocks.destroy).toHaveBeenCalledOnce()
    expect(mocks.unlock).toHaveBeenCalledWith('')
    expect(mocks.reset).toHaveBeenCalledOnce()
    expect(window.localStorage.getItem('isPasswordSet')).toBe('false')
    expect(mocks.success).toHaveBeenCalledWith('toasts.reset')
    expect(mocks.error).not.toHaveBeenCalled()
  })
})
