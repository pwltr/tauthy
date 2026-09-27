import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const vault = vi.hoisted(() => ({
  fileBackend: false,
  prepare: vi.fn(),
  create: vi.fn(),
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
vi.mock('~/hooks/useVaultProtection', () => ({
  useVaultProtection: () => localStorage.getItem('isPasswordSet') === 'true',
}))
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
    vault.fileBackend = false
    Object.values(vault).forEach((mock) => {
      if (typeof mock === 'function') mock.mockReset()
    })
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

    expect(screen.getByText('vaultUi.openFailed vault read failed')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'vaultUi.retry' }))
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

  it('requires explicit creation for a new file vault, ignoring a stale password flag', async () => {
    vault.fileBackend = true
    localStorage.setItem('isPasswordSet', 'false')
    vault.prepare
      .mockResolvedValueOnce({ lifecycle: 'new', status: 'locked' })
      .mockResolvedValue({ lifecycle: 'active', status: 'unlocked' })
    renderMain()
    await flushPromises()
    expect(vault.create).not.toHaveBeenCalled()
    expect(vault.checkVault).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'vaultUi.create' }))
    await flushPromises()
    expect(vault.create).toHaveBeenCalledWith(undefined)
    expect(screen.getByText('Accounts')).toBeInTheDocument()
  })

  it('routes a locked file vault to unlock even when the legacy password flag is false', async () => {
    vault.fileBackend = true
    vault.prepare.mockResolvedValue({
      lifecycle: 'active',
      status: 'locked',
      protectionHint: 'password',
    })
    renderMain()
    await flushPromises()
    expect(screen.getByText('Unlock')).toBeInTheDocument()
    expect(vault.checkVault).not.toHaveBeenCalled()
    expect(vault.reset).not.toHaveBeenCalled()
  })

  it('does not reset a missing migrated vault and exposes explicit recovery deletion', async () => {
    vault.fileBackend = true
    vault.prepare.mockRejectedValue({ code: 'vaultMissing' })
    renderMain()
    await flushPromises()
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'security.deleteVault' })).toBeInTheDocument()
    expect(vault.reset).not.toHaveBeenCalled()
    expect(vault.create).not.toHaveBeenCalled()
  })
})
