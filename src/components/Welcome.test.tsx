import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const vault = vi.hoisted(() => ({ fileBackend: true, prepare: vi.fn(), create: vi.fn() }))
vi.mock('~/utils/storage', () => ({ vault }))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => `translated ${key}` }),
}))
import Welcome from './Welcome'

const renderWelcome = () =>
  render(
    <MemoryRouter initialEntries={['/welcome']}>
      <Routes>
        <Route path="/welcome" element={<Welcome />} />
        <Route path="/" element={<div>Accounts</div>} />
      </Routes>
    </MemoryRouter>,
  )

const finish = () =>
  fireEvent.click(screen.getByRole('button', { name: 'translated welcome.continue' }))

describe('onboarding vault initialization', () => {
  beforeEach(() => {
    localStorage.clear()
    vault.fileBackend = true
    vault.prepare.mockReset().mockResolvedValue({ lifecycle: 'new', status: 'locked' })
    vault.create.mockReset().mockResolvedValue(undefined)
  })

  it('creates passwordless storage before opening the home screen', async () => {
    renderWelcome()
    expect(vault.prepare).not.toHaveBeenCalled()
    expect(vault.create).not.toHaveBeenCalled()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    finish()
    expect(await screen.findByText('Accounts')).toBeInTheDocument()
    expect(vault.create).toHaveBeenCalledExactlyOnceWith()
    expect(localStorage.getItem('showWelcome')).toBe('false')
  })

  it.each(['active', 'legacy', 'legacyMigrationPending', 'deleted', 'transactionPending'])(
    'does not recreate an existing or previously deleted vault (%s)',
    async (lifecycle) => {
      vault.prepare.mockResolvedValue({ lifecycle, status: 'locked' })
      renderWelcome()
      finish()
      expect(await screen.findByText('Accounts')).toBeInTheDocument()
      expect(vault.create).not.toHaveBeenCalled()
    },
  )

  it('keeps onboarding retryable when creation fails, and resumes rather than creating twice', async () => {
    vault.create.mockRejectedValueOnce({ code: 'vaultCredentialAccessDenied' })
    renderWelcome()
    finish()
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'translated vaultErrors.credentialDenied',
    )
    expect(localStorage.getItem('showWelcome')).not.toBe('false')
    vault.prepare.mockResolvedValue({ lifecycle: 'active', status: 'unlocked' })
    finish()
    expect(await screen.findByText('Accounts')).toBeInTheDocument()
    expect(vault.create).toHaveBeenCalledTimes(1)
  })

  it('never treats a missing migrated vault as a fresh installation', async () => {
    vault.prepare.mockRejectedValue({ code: 'vaultMissing' })
    renderWelcome()
    finish()
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('translated vaultErrors.missing'),
    )
    expect(vault.create).not.toHaveBeenCalled()
    expect(localStorage.getItem('showWelcome')).not.toBe('false')
  })

  it('leaves released Stronghold onboarding unchanged', async () => {
    vault.fileBackend = false
    renderWelcome()
    finish()
    expect(await screen.findByText('Accounts')).toBeInTheDocument()
    expect(vault.prepare).not.toHaveBeenCalled()
    expect(vault.create).not.toHaveBeenCalled()
  })

  it('does not reopen onboarding after it has been completed', async () => {
    localStorage.setItem('showWelcome', 'false')
    renderWelcome()
    expect(await screen.findByText('Accounts')).toBeInTheDocument()
  })
})
