import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useState, type ReactNode } from 'react'
import { AppBarTitleContext } from '~/context'

vi.mock('@tauri-apps/plugin-os', () => ({ type: () => 'linux' }))
const mocks = vi.hoisted(() => ({ status: vi.fn(), importForeign: vi.fn(), open: vi.fn() }))
vi.mock('~/utils/storage', () => ({
  vault: { fileBackend: true, getStatus: mocks.status, importForeign: mocks.importForeign },
}))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: mocks.open }))
vi.mock('~/hooks/useVaultProtection', () => ({ useVaultProtection: () => true }))
const t = (key: string) => `translated ${key}`
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t }) }))
import VaultRecovery from './VaultRecovery'

const TitleProvider = ({ children }: { children: ReactNode }) => {
  const [appBarTitle, setAppBarTitle] = useState('Tauthy')
  return (
    <AppBarTitleContext.Provider value={{ appBarTitle, setAppBarTitle }}>
      {children}
    </AppBarTitleContext.Provider>
  )
}

const renderScreen = (from = '/security') =>
  render(
    <TitleProvider>
      <MemoryRouter initialEntries={[from, '/vault-recovery']} initialIndex={1}>
        <Routes>
          <Route path="/vault-recovery" element={<VaultRecovery />} />
          <Route path="/security" element={<div>Security settings</div>} />
          <Route path="/" element={<div>Accounts</div>} />
          <Route path="/unlock" element={<div>Unlock</div>} />
        </Routes>
      </MemoryRouter>
    </TitleProvider>,
  )

const choose = async () => {
  const button = screen.getByRole('button', { name: 'translated vaultUi.chooseFile' })
  await waitFor(() => expect(button).toBeEnabled())
  fireEvent.click(button)
  expect(await screen.findByText('foreign.tauthy')).toBeInTheDocument()
}

describe('foreign vault recovery screen', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset())
    mocks.status.mockResolvedValue({
      status: 'unlocked',
      lifecycle: 'active',
      protectionHint: 'password',
    })
    mocks.open.mockResolvedValue('/test/foreign.tauthy')
    mocks.importForeign.mockResolvedValue(undefined)
  })

  it.each(['/security', '/unlock'])(
    'shows the standard header and returns to %s with Back',
    async (from) => {
      renderScreen(from)
      const header = screen.getByRole('banner')
      expect(header).toHaveTextContent('translated vaultUi.replaceTitle')
      expect(
        screen.getByRole('heading', { name: 'translated vaultUi.replaceTitle' }),
      ).toBeInTheDocument()
      expect(
        screen.getAllByRole('heading', { name: 'translated vaultUi.replaceTitle' }),
      ).toHaveLength(1)
      fireEvent.click(screen.getByRole('button', { name: 'menu' }))
      expect(
        await screen.findByText(from === '/security' ? 'Security settings' : 'Unlock'),
      ).toBeInTheDocument()
      expect(mocks.importForeign).not.toHaveBeenCalled()
    },
  )

  it('disables Back while replacement is in progress', async () => {
    mocks.importForeign.mockImplementation(() => new Promise(() => {}))
    renderScreen()
    await choose()
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'translated vaultUi.replaceTitle' }))
    expect(screen.getByRole('button', { name: 'menu' })).toBeDisabled()
  })

  it('explains destructive replacement and requires file selection plus explicit confirmation', async () => {
    renderScreen()
    expect(screen.getByText('translated vaultUi.replaceWarning')).toBeInTheDocument()
    const submit = screen.getByRole('button', { name: 'translated vaultUi.replaceTitle' })
    expect(submit).toBeDisabled()
    await choose()
    expect(submit).toBeDisabled()
    fireEvent.change(screen.getByLabelText('translated vaultUi.filePassword'), {
      target: { value: 'foreign' },
    })
    fireEvent.change(screen.getByLabelText('translated modals.currentPassword'), {
      target: { value: 'current' },
    })
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(submit)
    expect(await screen.findByText('Accounts')).toBeInTheDocument()
    expect(mocks.importForeign).toHaveBeenCalledWith({
      path: '/test/foreign.tauthy',
      foreignPassword: 'foreign',
      currentPassword: 'current',
      password: '',
      recovery: false,
    })
  })

  it('re-submits the source for an interrupted replacement rather than silently loading it', async () => {
    mocks.status.mockResolvedValue({
      status: 'locked',
      lifecycle: 'transactionPending',
      operation: 'replace',
      protectionHint: 'deviceCredential',
    })
    renderScreen()
    await choose()
    expect(screen.getByText('translated vaultUi.replaceResume')).toBeInTheDocument()
    expect(screen.queryByLabelText('translated modals.currentPassword')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'translated vaultUi.replaceTitle' }))
    await waitFor(() =>
      expect(mocks.importForeign).toHaveBeenCalledWith(expect.objectContaining({ recovery: true })),
    )
  })

  it('keeps authentication errors visible without claiming corruption or replacing anything', async () => {
    mocks.importForeign.mockRejectedValue({
      code: 'vaultAuthenticationFailed',
      detail: 'never display',
    })
    renderScreen()
    await choose()
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'translated vaultUi.replaceTitle' }))
    expect(await screen.findByText('translated vaultErrors.authentication')).toBeInTheDocument()
    expect(screen.queryByText('never display')).not.toBeInTheDocument()
  })

  it('refuses replacement of a locked incumbent until it is unlocked', async () => {
    mocks.status.mockResolvedValue({
      status: 'locked',
      lifecycle: 'active',
      protectionHint: 'password',
    })
    renderScreen()
    await waitFor(() => expect(mocks.status).toHaveBeenCalledOnce())
    expect(screen.getByRole('button', { name: 'translated vaultUi.chooseFile' })).toBeDisabled()
    expect(mocks.importForeign).not.toHaveBeenCalled()
  })
})
