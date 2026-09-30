import { act, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('~/hooks/useBackupStatus', () => ({ useBackupStatus: () => undefined }))

const vault = vi.hoisted(() => ({
  fileBackend: false,
  prepare: vi.fn(),
  create: vi.fn(),
  retryMigration: vi.fn(),
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
const prepareImport = vi.hoisted(() => vi.fn())
const recordDiagnostic = vi.hoisted(() => vi.fn())

vi.mock('~/utils/storage', () => ({ vault }))
vi.mock('~/hooks/useVaultProtection', () => ({
  useVaultProtection: () => localStorage.getItem('isPasswordSet') === 'true',
}))
vi.mock('~/components/AppBar', () => ({ default: () => <div>Header</div> }))
vi.mock('~/utils/sync', () => ({ syncInBackground }))
vi.mock('~/utils/diagnostics', () => ({ recordDiagnostic }))
vi.mock('~/utils', () => ({ prepareImport, exportCodes: vi.fn(), commitPreparedImport: vi.fn() }))
vi.mock('~/components/Modal', () => ({
  default: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div>{children}</div> : null,
  Buttons: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))
vi.mock('react-idle-timer', () => ({
  useIdleTimer: vi.fn(({ onIdle }: { onIdle: () => Promise<void> }) => {
    idleTimer.onIdle = onIdle
  }),
}))

import Main from '~/components/Main'
import Welcome from '~/components/Welcome'
import Import from '~/components/Import'
import ImportReview from '~/components/ImportReview'

const flushPromises = () =>
  act(async () => {
    for (let index = 0; index < 5; index += 1) await Promise.resolve()
  })

const renderMain = (indexElement: ReactNode = <div>Accounts</div>) =>
  render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/welcome" element={<div>Welcome</div>} />
        <Route path="/unlock" element={<div>Unlock</div>} />
        <Route path="/" element={<Main />}>
          <Route index element={indexElement} />
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
    prepareImport.mockReset()
    recordDiagnostic.mockReset()
  })

  it('sends a new user to onboarding without reading the vault', async () => {
    window.localStorage.setItem('showWelcome', 'true')
    renderMain()
    await flushPromises()

    expect(screen.getByText('Welcome')).toBeInTheDocument()
    expect(vault.checkVault).not.toHaveBeenCalled()
  })

  it.each([false, true])(
    'retains the import preview across shell navigation (file backend: %s)',
    async (fileBackend) => {
      vault.fileBackend = fileBackend
      vault.prepare.mockResolvedValue({ lifecycle: 'active', status: 'unlocked' })
      // Real IPC spans event-loop turns; an immediately resolved mock can batch
      // away the loading render that unmounts the import route.
      vault.checkVault.mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5))
        return '[]'
      })
      prepareImport.mockResolvedValue({
        format: 'tauthy',
        sourceName: 'sample.json',
        entries: [
          { uuid: 'sample', name: 'Dropbox', issuer: 'Dropbox', secret: 'JBSWY3DPEHPK3PXP' },
        ],
        newCount: 1,
        duplicateCount: 0,
        duplicateIndices: [],
      })
      render(
        <MemoryRouter initialEntries={['/import']}>
          <Routes>
            <Route path="/" element={<Main />}>
              <Route path="import" element={<Import />}>
                <Route path="review" element={<ImportReview />} />
              </Route>
            </Route>
          </Routes>
        </MemoryRouter>,
      )
      await screen.findByText('import.import')
      fireEvent.click(screen.getByText('import.import'))
      fireEvent.click(screen.getByText('Tauthy'))
      const input = document.querySelector('input[type="file"]') as HTMLInputElement
      fireEvent.change(input, { target: { files: [new File(['backup'], 'sample.json')] } })
      expect(await screen.findByText('sample.json')).toBeInTheDocument()
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20))
      })
      expect(screen.getAllByText('Dropbox')).toHaveLength(2)
      expect(screen.getByText('sample.json')).toBeInTheDocument()
      expect(vault.checkVault).toHaveBeenCalledOnce()
      if (fileBackend) expect(vault.prepare).toHaveBeenCalledOnce()
    },
  )

  it('goes directly from onboarding to home with passwordless file storage', async () => {
    localStorage.setItem('showWelcome', 'true')
    vault.fileBackend = true
    let created = false
    vault.prepare.mockImplementation(async () => ({
      lifecycle: created ? 'active' : 'new',
      status: created ? 'unlocked' : 'locked',
    }))
    vault.create.mockImplementation(async () => {
      created = true
    })
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/welcome" element={<Welcome />} />
          <Route path="/" element={<Main />}>
            <Route index element={<div>Accounts</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )
    await flushPromises()
    expect(vault.create).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'welcome.continue' }))
    await flushPromises()
    expect(screen.getByText('Accounts')).toBeInTheDocument()
    expect(vault.create).toHaveBeenCalledExactlyOnceWith()
    expect(screen.queryByRole('button', { name: 'vaultUi.create' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('vaultUi.optionalPassword')).not.toBeInTheDocument()
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

  it.each(['new', 'deleted'])(
    'opens an empty %s vault without an extra creation step',
    async (lifecycle) => {
      vault.fileBackend = true
      localStorage.setItem('isPasswordSet', 'false')
      vault.prepare
        .mockResolvedValueOnce({ lifecycle, status: 'locked' })
        .mockResolvedValue({ lifecycle: 'active', status: 'unlocked' })
      renderMain()
      await flushPromises()
      expect(screen.queryByLabelText('vaultUi.optionalPassword')).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'vaultUi.create' })).not.toBeInTheDocument()
      expect(vault.create).toHaveBeenCalledExactlyOnceWith()
      expect(screen.getByText('Accounts')).toBeInTheDocument()
    },
  )

  it('routes a locked file vault to unlock even when the legacy password flag is false', async () => {
    vault.fileBackend = true
    vault.prepare.mockResolvedValue({
      lifecycle: 'active',
      status: 'locked',
      protectionHint: 'password',
    })
    const renderAccounts = vi.fn()
    renderMain(<div ref={() => renderAccounts()}>Accounts</div>)
    expect(screen.queryByText('Header')).not.toBeInTheDocument()
    expect(screen.queryByText('Accounts')).not.toBeInTheDocument()
    await flushPromises()
    expect(screen.getByText('Unlock')).toBeInTheDocument()
    expect(screen.queryByText('Header')).not.toBeInTheDocument()
    expect(renderAccounts).not.toHaveBeenCalled()
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

  it('keeps deferred accounts usable and retries only on an explicit click', async () => {
    vault.fileBackend = true
    vault.prepare.mockResolvedValue({
      lifecycle: 'legacyMigrationPending',
      status: 'unlocked',
      usingLegacy: true,
    })
    vault.retryMigration.mockResolvedValue({
      lifecycle: 'active',
      status: 'unlocked',
      usingLegacy: false,
    })
    renderMain()
    await flushPromises()
    expect(screen.getByText('Accounts')).toBeInTheDocument()
    expect(screen.getByText('vaultUi.deferred')).toBeInTheDocument()
    expect(vault.retryMigration).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'vaultUi.retryMigration' }))
    await flushPromises()
    expect(vault.retryMigration).toHaveBeenCalledWith('')
    expect(screen.queryByText('vaultUi.deferred')).not.toBeInTheDocument()
  })
})
