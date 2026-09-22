import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AppBarTitleContext, SearchContext } from '~/context'

const vault = vi.hoisted(() => ({ lock: vi.fn() }))

vi.mock('~/utils/storage', () => ({ vault }))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'appBar.lock': 'Lock',
        'appBar.search': 'Search',
        'appBar.settings': 'Settings',
      })[key] ?? key,
  }),
}))

import AppBar from '~/components/AppBar'

const renderAppBar = () =>
  render(
    <AppBarTitleContext.Provider value={{ appBarTitle: 'Tauthy', setAppBarTitle: vi.fn() }}>
      <SearchContext.Provider value={{ searchTerm: '', setSearch: vi.fn() }}>
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route path="/" element={<AppBar />} />
            <Route path="/settings" element={<div>Settings page</div>} />
            <Route path="/unlock" element={<div>Unlock page</div>} />
          </Routes>
        </MemoryRouter>
      </SearchContext.Provider>
    </AppBarTitleContext.Provider>,
  )

describe('AppBar actions', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vault.lock.mockReset()
    vault.lock.mockResolvedValue(undefined)
  })

  it('opens Settings directly from the three-dot button', () => {
    renderAppBar()

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))

    expect(screen.getByText('Settings page')).toBeInTheDocument()
  })

  it('shows a dedicated lock button for password-protected vaults', async () => {
    window.localStorage.setItem('isPasswordSet', 'true')
    renderAppBar()

    fireEvent.click(screen.getByRole('button', { name: 'Lock' }))

    await waitFor(() => expect(vault.lock).toHaveBeenCalledOnce())
    expect(await screen.findByText('Unlock page')).toBeInTheDocument()
  })
})
