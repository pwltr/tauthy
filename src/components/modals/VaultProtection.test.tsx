import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'

// These tests exercise protection routing/IPC, not MUI's portal focus restore.
vi.mock('~/components/Modal', () => ({
  default: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <div>{children}</div> : null,
  Buttons: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

const mocks = vi.hoisted(() => ({
  changePassword: vi.fn(),
  isUnlocked: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}))
vi.mock('~/utils/storage', () => ({
  vault: { fileBackend: true, changePassword: mocks.changePassword, isUnlocked: mocks.isUnlocked },
}))
vi.mock('~/hooks/useVaultProtection', () => ({ useVaultProtection: () => true }))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => `translated ${key}` }),
}))
vi.mock('react-hot-toast', () => ({ default: { success: mocks.success, error: mocks.error } }))

import PasswordModal from './Password'
import PasswordResetModal from './PasswordReset'

const renderModal = (removePassword = false) =>
  render(
    <MemoryRouter initialEntries={['/security']}>
      <Routes>
        <Route
          path="/security"
          element={
            removePassword ? (
              <PasswordResetModal open onClose={vi.fn()} />
            ) : (
              <PasswordModal open onClose={vi.fn()} />
            )
          }
        />
        <Route path="/unlock" element={<div>Unlock screen</div>} />
      </Routes>
    </MemoryRouter>,
  )

describe('file vault protection controls', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset())
    mocks.changePassword.mockResolvedValue(undefined)
    mocks.isUnlocked.mockResolvedValue(true)
  })

  it.each([false, true])(
    'uses the same compact filled password field (remove password: %s)',
    (removePassword) => {
      renderModal(removePassword)
      const field = screen
        .getByLabelText('translated modals.currentPassword')
        .closest('.MuiInputBase-root')
      expect(field).toHaveClass('MuiFilledInput-root', 'MuiInputBase-sizeSmall')
    },
  )

  it('asks for the current and new passwords without storage implementation warnings', async () => {
    renderModal()
    fireEvent.change(screen.getByLabelText('translated modals.currentPassword'), {
      target: { value: 'old' },
    })
    fireEvent.change(screen.getByLabelText('translated modals.newPassword'), {
      target: { value: 'new-password' },
    })
    fireEvent.change(screen.getByLabelText('translated modals.repeatPassword'), {
      target: { value: 'new-password' },
    })
    expect(screen.queryByText('translated vaultUi.rotationWarning')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'translated modals.confirm' }))
    await waitFor(() => expect(mocks.changePassword).toHaveBeenCalledWith('new-password', 'old'))
  })

  it('removes password protection with current authentication rather than empty-password wrapping', async () => {
    renderModal(true)
    expect(screen.queryByText('translated vaultUi.rotationWarning')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('translated modals.currentPassword'), {
      target: { value: 'old' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'translated modals.confirm' }))
    await waitFor(() => expect(mocks.changePassword).toHaveBeenCalledWith('', 'old'))
  })

  it('routes a revoked session back to unlock on incorrect current authentication', async () => {
    mocks.changePassword.mockRejectedValue({ code: 'vaultAuthenticationFailed' })
    mocks.isUnlocked.mockResolvedValue(false)
    renderModal(true)
    fireEvent.change(screen.getByLabelText('translated modals.currentPassword'), {
      target: { value: 'wrong' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'translated modals.confirm' }))
    expect(await screen.findByText('Unlock screen')).toBeInTheDocument()
    expect(mocks.error).toHaveBeenCalledWith('translated vaultErrors.authentication')
  })
})
