import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const vault = vi.hoisted(() => ({
  checkVault: vi.fn(),
  isUnlocked: vi.fn(),
  lock: vi.fn(),
  reset: vi.fn(),
  unlock: vi.fn(),
}))
const idleTimer = vi.hoisted(() => ({
  onIdle: undefined as (() => Promise<void>) | undefined,
}))
const syncInBackground = vi.hoisted(() => vi.fn())

vi.mock('~/utils/storage', () => ({ vault }))
vi.mock('~/components/AppBar', () => ({ default: () => <div>Header</div> }))
vi.mock('~/utils/sync', () => ({ syncInBackground }))
vi.mock('react-idle-timer', () => ({
  useIdleTimer: vi.fn(({ onIdle }: { onIdle: () => Promise<void> }) => {
    idleTimer.onIdle = onIdle
  }),
}))

import Main from '~/components/Main'

const flushPromises = () =>
  act(async () => {
    for (let index = 0; index < 5; index += 1) await Promise.resolve()
  })

const renderMain = () =>
  render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/welcome" element={<div>Welcome</div>} />
        <Route path="/unlock" element={<div>Unlock</div>} />
        <Route path="/" element={<Main />}>
          <Route index element={<div>Accounts</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )

describe('vault initialization', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.localStorage.setItem('showWelcome', 'false')
    window.localStorage.setItem('isPasswordSet', 'false')
    window.localStorage.setItem('shouldAutoLock', 'false')

    idleTimer.onIdle = undefined
    Object.values(vault).forEach((mock) => mock.mockReset())
    vault.checkVault.mockResolvedValue('[]')
    vault.isUnlocked.mockResolvedValue(true)
    vault.lock.mockResolvedValue(undefined)
    vault.reset.mockResolvedValue(undefined)
    vault.unlock.mockResolvedValue(undefined)
    syncInBackground.mockReset()
  })

  it('sends a new user to onboarding without reading the vault', async () => {
    window.localStorage.setItem('showWelcome', 'true')
    renderMain()
    await flushPromises()

    expect(screen.getByText('Welcome')).toBeInTheDocument()
    expect(vault.checkVault).not.toHaveBeenCalled()
  })

  it('opens the account screen when the existing vault can be read', async () => {
    renderMain()
    await flushPromises()

    expect(vault.checkVault).toHaveBeenCalledOnce()
    expect(vault.reset).not.toHaveBeenCalled()
    expect(screen.getByText('Accounts')).toBeInTheDocument()
  })

  it('checks for remote changes while open and stops after leaving the vault', async () => {
    vi.useFakeTimers()
    try {
      const view = renderMain()
      await flushPromises()

      expect(syncInBackground).toHaveBeenCalledOnce()
      await act(() => vi.advanceTimersByTimeAsync(59_999))
      expect(syncInBackground).toHaveBeenCalledOnce()
      await act(() => vi.advanceTimersByTimeAsync(1))
      expect(syncInBackground).toHaveBeenCalledTimes(2)

      view.unmount()
      await act(() => vi.advanceTimersByTimeAsync(60_000))
      expect(syncInBackground).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('recovers from a stale password setting by showing the unlock screen', async () => {
    vault.checkVault.mockRejectedValueOnce(new Error('Please try another password.'))
    renderMain()
    await flushPromises()

    expect(vault.lock).toHaveBeenCalledOnce()
    expect(screen.getByText('Unlock')).toBeInTheDocument()
  })

  it('initializes a missing vault record and opens the account screen', async () => {
    vault.checkVault.mockRejectedValueOnce(new Error('record not found'))
    renderMain()
    await flushPromises()

    expect(vault.reset).toHaveBeenCalledOnce()
    expect(screen.getByText('Accounts')).toBeInTheDocument()
  })

  it('shows an initialization error and recovers when retried', async () => {
    vault.checkVault.mockRejectedValueOnce(new Error('vault read failed'))
    renderMain()
    await flushPromises()

    expect(screen.getByText('Unable to open the vault: vault read failed')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await flushPromises()

    expect(vault.unlock).toHaveBeenCalledWith('')
    expect(screen.getByText('Accounts')).toBeInTheDocument()
  })

  it('locks a password-protected vault after the configured idle timeout', async () => {
    window.localStorage.setItem('isPasswordSet', 'true')
    window.localStorage.setItem('shouldAutoLock', 'true')
    renderMain()
    await flushPromises()

    expect(screen.getByText('Accounts')).toBeInTheDocument()
    expect(idleTimer.onIdle).toBeDefined()

    await act(async () => idleTimer.onIdle?.())

    expect(vault.lock).toHaveBeenCalledOnce()
    expect(screen.getByText('Unlock')).toBeInTheDocument()
  })
})
