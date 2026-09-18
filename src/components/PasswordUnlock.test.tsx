import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Outlet, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const vault = vi.hoisted(() => ({
  checkVault: vi.fn(),
  isUnlocked: vi.fn(),
  lock: vi.fn(),
  reset: vi.fn(),
  unlock: vi.fn(),
}))

vi.mock('~/utils/storage', () => ({ vault }))
vi.mock('~/components/AppBar', () => ({ default: () => <div>Header</div> }))
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
    Object.values(vault).forEach((mock) => mock.mockReset())
    vault.checkVault.mockResolvedValue('[]')
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

  it('stays on the account screen after a successful unlock', async () => {
    renderApp('/unlock')
    await act(() => vi.advanceTimersByTimeAsync(2000))

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
    await act(() => vi.advanceTimersByTimeAsync(2000))

    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'wrong password' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }))
    await flushPromises()
    await act(() => vi.advanceTimersByTimeAsync(2000))

    expect(vault.lock).toHaveBeenCalledOnce()
    expect(screen.getByText('Invalid password')).toBeInTheDocument()
  })
})
