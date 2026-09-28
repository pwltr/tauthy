import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTheme, ThemeProvider } from '@mui/material/styles'

import { AppBarBackContext, AppBarTitleContext, SearchContext } from '~/context'

const vault = vi.hoisted(() => ({ lock: vi.fn() }))
const os = vi.hoisted(() => ({ platform: 'linux' }))

vi.mock('@tauri-apps/plugin-os', () => ({ type: () => os.platform }))
vi.mock('~/utils/storage', () => ({ vault }))
vi.mock('~/hooks/useVaultProtection', () => ({
  useVaultProtection: () => localStorage.getItem('isPasswordSet') === 'true',
}))
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

const renderAppBar = (path = '/', backDisabled = false, theme = createTheme()) =>
  render(
    <ThemeProvider theme={theme}>
      <AppBarTitleContext.Provider value={{ appBarTitle: 'Tauthy', setAppBarTitle: vi.fn() }}>
        <AppBarBackContext.Provider value={{ backDisabled, setBackDisabled: vi.fn() }}>
          <SearchContext.Provider value={{ searchTerm: '', setSearch: vi.fn() }}>
            <MemoryRouter initialEntries={['/', path]} initialIndex={1}>
              <Routes>
                <Route path="/" element={<AppBar />} />
                <Route path="/import/review" element={<AppBar />} />
                <Route path="/settings" element={<div>Settings page</div>} />
                <Route path="/unlock" element={<div>Unlock page</div>} />
              </Routes>
            </MemoryRouter>
          </SearchContext.Provider>
        </AppBarBackContext.Provider>
      </AppBarTitleContext.Provider>
    </ThemeProvider>,
  )

describe('AppBar actions', () => {
  beforeEach(() => {
    os.platform = 'linux'
    window.localStorage.clear()
    vault.lock.mockReset()
    vault.lock.mockResolvedValue(undefined)
  })

  it('opens Settings directly from the three-dot button', () => {
    renderAppBar()

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))

    expect(screen.getByText('Settings page')).toBeInTheDocument()
  })

  it('inherits the header color instead of forcing white search text', () => {
    renderAppBar()
    fireEvent.click(screen.getByRole('button', { name: 'filter entries' }))

    const input = screen.getByPlaceholderText('Search')
    const searchStyle = getComputedStyle(input.parentElement!)
    expect(searchStyle.color).toBe(getComputedStyle(screen.getByRole('banner')).color)
  })

  it('uses the secondary header color in macOS dark mode', () => {
    os.platform = 'macos'
    renderAppBar(
      '/',
      false,
      createTheme({
        status: { danger: '#ff0000' },
        palette: {
          mode: 'dark',
          secondary: { main: '#191919' },
          neutral: { main: '#64748b' },
        },
      }),
    )

    expect(
      getComputedStyle(screen.getByRole('banner')).getPropertyValue('--AppBar-background'),
    ).toBe('#191919')
  })

  it('shows a dedicated lock button for password-protected vaults', async () => {
    window.localStorage.setItem('isPasswordSet', 'true')
    renderAppBar()

    fireEvent.click(screen.getByRole('button', { name: 'Lock' }))

    await waitFor(() => expect(vault.lock).toHaveBeenCalledOnce())
    expect(await screen.findByText('Unlock page')).toBeInTheDocument()
  })

  it('disables the back button while a screen is saving', () => {
    renderAppBar('/import/review', true)
    expect(screen.getByRole('button', { name: 'menu' })).toBeDisabled()
  })
})
