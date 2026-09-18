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

vi.mock('~/utils/storage', () => ({ vault }))
vi.mock('~/components/AppBar', () => ({ default: () => <div>Header</div> }))
vi.mock('react-idle-timer', () => ({ useIdleTimer: vi.fn() }))

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

    Object.values(vault).forEach((mock) => mock.mockReset())
    vault.checkVault.mockResolvedValue('[]')
    vault.isUnlocked.mockResolvedValue(true)
    vault.lock.mockResolvedValue(undefined)
    vault.reset.mockResolvedValue(undefined)
    vault.unlock.mockResolvedValue(undefined)
  })

  it('sends a new user to onboarding without reading the vault', async () => {
    window.localStorage.setItem('showWelcome', 'true')
    renderMain()
    await flushPromises()

    expect(screen.getByText('Welcome')).toBeInTheDocument()
    expect(vault.checkVault).not.toHaveBeenCalled()
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
})
