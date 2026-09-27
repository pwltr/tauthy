import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Outlet, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const vault = vi.hoisted(() => ({
  prepare: vi.fn(),
  checkVault: vi.fn(),
  isUnlocked: vi.fn(),
  lock: vi.fn(),
  reset: vi.fn(),
  unlock: vi.fn(),
  getStatus: vi.fn(),
}))
const backend = vi.hoisted(() => ({ file: false }))

vi.mock('~/utils/storage', () => ({
  vault: {
    ...vault,
    get fileBackend() {
      return backend.file
    },
  },
}))
vi.mock('~/hooks/useVaultProtection', () => ({
  useVaultProtection: () => localStorage.getItem('isPasswordSet') === 'true',
}))
vi.mock('~/components/AppBar', () => ({ default: () => <div>Header</div> }))
vi.mock('~/utils/sync', () => ({ syncInBackground: vi.fn() }))
vi.mock('react-idle-timer', () => ({ useIdleTimer: vi.fn() }))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'unlock.invalid': 'Invalid password',
        'unlock.password': 'Password',
        'unlock.subtitle': 'Enter password to unlock',
        'unlock.title': 'Welcome back',
        'unlock.unlock': 'Unlock',
      })[key] ?? key,
  }),
}))

import Main from '~/components/Main'
import Unlock from '~/components/Unlock'

const AccountScreen = () => (
  <>
    <div>Accounts</div>
    <Outlet />
  </>
)

const renderApp = (initialPath: '/' | '/unlock') =>
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/unlock" element={<Unlock />} />
        <Route path="/" element={<Main />}>
          <Route index element={<AccountScreen />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )

const flushPromises = () =>
  act(async () => {
    for (let index = 0; index < 5; index += 1) await Promise.resolve()
  })

describe('password unlock flow', () => {
  let unlocked = false

  beforeEach(() => {
    vi.useFakeTimers()
    window.localStorage.clear()
    window.localStorage.setItem('showWelcome', 'false')
    window.localStorage.setItem('isPasswordSet', 'true')
    window.localStorage.setItem('shouldAutoLock', 'false')

    unlocked = false
    backend.file = false
    Object.values(vault).forEach((mock) => mock.mockReset())
    vault.checkVault.mockResolvedValue('[]')
    vault.prepare.mockResolvedValue({ lifecycle: 'active', protectionHint: 'password' })
    vault.getStatus.mockResolvedValue({ lifecycle: 'active', protectionHint: 'password' })
    vault.isUnlocked.mockImplementation(async () => unlocked)
    vault.lock.mockImplementation(async () => {
      unlocked = false
    })
    vault.unlock.mockImplementation(async () => {
      unlocked = true
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it.each([false, true])(
    'has no artificial startup delay (file backend: %s)',
    async (fileBackend) => {
      backend.file = fileBackend
      renderApp('/unlock')
      await flushPromises()
      expect(screen.getByRole('button', { name: 'Unlock' })).toBeEnabled()
      expect(vault.unlock).not.toHaveBeenCalled()
    },
  )

  it('waits only for real recovery metadata before allowing unlock', async () => {
    backend.file = true
    let finish!: (status: object) => void
    vault.getStatus.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    renderApp('/unlock')
    const button = screen.getByRole('button', { name: 'Unlock' })
    expect(button).toBeDisabled()
    fireEvent.submit(button.closest('form')!)
    expect(vault.unlock).not.toHaveBeenCalled()
    await act(async () => finish({ lifecycle: 'active', protectionHint: 'password' }))
    await flushPromises()
    expect(button).toBeEnabled()
  })

  it('shows loading for a real unlock and prevents duplicate form submissions', async () => {
    let finish!: () => void
    vault.unlock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = () => {
            unlocked = true
            resolve()
          }
        }),
    )
    renderApp('/unlock')
    await flushPromises()
    const button = screen.getByRole('button', { name: 'Unlock' })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct password' } })
    fireEvent.submit(button.closest('form')!)
    fireEvent.submit(button.closest('form')!)
    expect(button).toBeDisabled()
    expect(vault.unlock).toHaveBeenCalledOnce()
    await act(async () => finish())
    await flushPromises()
    expect(screen.getByText('Accounts')).toBeInTheDocument()
  })

  it('stays on the account screen after a successful unlock', async () => {
    renderApp('/unlock')
    await flushPromises()

    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'correct password' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }))
    await flushPromises()

    expect(screen.getByText('Accounts')).toBeInTheDocument()
    expect(vault.isUnlocked).toHaveBeenCalledOnce()
    expect(screen.queryByText('Welcome back')).not.toBeInTheDocument()
  })

  it('shows the unlock screen when a password-protected vault is locked', async () => {
    renderApp('/')
    await flushPromises()

    expect(screen.getByText('Welcome back')).toBeInTheDocument()
    expect(vault.checkVault).not.toHaveBeenCalled()
  })

  it('shows an invalid-password error after a failed unlock', async () => {
    vault.unlock.mockRejectedValueOnce(new Error('Please try another password.'))
    renderApp('/unlock')
    await flushPromises()

    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'wrong password' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }))
    await flushPromises()

    expect(vault.lock).toHaveBeenCalledOnce()
    expect(screen.getByText('Invalid password')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Unlock' })).toBeEnabled()
  })

  it('does not offer replacement or deletion for a wrong password on a migrated vault', async () => {
    backend.file = true
    vault.unlock.mockRejectedValueOnce({ code: 'vaultAuthenticationFailed' })
    renderApp('/unlock')
    await flushPromises()
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong' } })
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }))
    await flushPromises()
    expect(screen.getByText('Invalid password')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'vaultUi.replaceTitle' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'security.deleteVault' })).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct' } })
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }))
    await flushPromises()
    expect(screen.getByText('Accounts')).toBeInTheDocument()
  })

  it('still offers recovery actions for a structurally corrupt migrated vault', async () => {
    backend.file = true
    vault.unlock.mockRejectedValueOnce({ code: 'vaultCorrupt' })
    renderApp('/unlock')
    await flushPromises()
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }))
    await flushPromises()
    expect(screen.getByRole('button', { name: 'vaultUi.replaceTitle' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'security.deleteVault' })).toBeInTheDocument()
  })
})
