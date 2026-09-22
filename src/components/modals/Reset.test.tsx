import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
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
    Object.values(mocks).forEach((mock) => mock.mockReset())

    let unlocked = true
    mocks.destroy.mockImplementation(async () => {
      unlocked = false
    })
    mocks.unlock.mockImplementation(async (password: string) => {
      if (password !== '') throw new Error('Unexpected password')
      unlocked = true
    })
    mocks.reset.mockImplementation(async () => {
      if (!unlocked) throw new Error('vault is locked')
    })
  })

  it('opens a fresh vault before writing an empty record and returns home', async () => {
    render(
      <MemoryRouter initialEntries={['/import']}>
        <Routes>
          <Route path="/import" element={<ResetModal open onClose={vi.fn()} />} />
          <Route path="/" element={<div>Accounts</div>} />
        </Routes>
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'modals.delete' }))

    await waitFor(() => expect(screen.getByText('Accounts')).toBeInTheDocument())
    expect(mocks.destroy).toHaveBeenCalledOnce()
    expect(mocks.unlock).toHaveBeenCalledWith('')
    expect(mocks.reset).toHaveBeenCalledOnce()
    expect(window.localStorage.getItem('isPasswordSet')).toBe('false')
    expect(mocks.success).toHaveBeenCalledWith('toasts.reset')
    expect(mocks.error).not.toHaveBeenCalled()
  })
})
