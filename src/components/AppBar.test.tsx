import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTheme, ThemeProvider } from '@mui/material/styles'

import { AppBarBackContext, AppBarTitleContext, SearchContext } from '~/context'

const vault = vi.hoisted(() => ({ lock: vi.fn() }))
const os = vi.hoisted(() => ({ platform: 'linux' }))
const nativeMenu = vi.hoisted(() => ({
  invoke: vi.fn(),
  onAction: undefined as undefined | ((event: { payload: string }) => void),
}))

vi.mock('@tauri-apps/plugin-os', () => ({ type: () => os.platform }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: nativeMenu.invoke }))
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (_name, callback) => {
    nativeMenu.onAction = callback
    return () => {
      nativeMenu.onAction = undefined
    }
  }),
}))
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

const ImportDestination = () => {
  const location = useLocation()
  return (
    <>
      <div>Import page</div>
      {location.state?.openImport && <div>Import modal requested</div>}
    </>
  )
}

const renderAppBar = (path = '/', backDisabled = false, theme = createTheme()) =>
  render(
    <ThemeProvider theme={theme}>
      <AppBarTitleContext.Provider value={{ appBarTitle: 'Tauthy', setAppBarTitle: vi.fn() }}>
        <AppBarBackContext.Provider value={{ backDisabled, setBackDisabled: vi.fn() }}>
          <SearchContext.Provider value={{ searchTerm: '', setSearch: vi.fn() }}>
            <MemoryRouter initialEntries={['/', path]} initialIndex={1}>
              <Routes>
                <Route
                  element={
                    <>
                      <AppBar />
                      <Outlet />
                    </>
                  }
                >
                  <Route path="/" element={<div>Home page</div>} />
                  <Route path="/import/review" element={<div>Review page</div>} />
                  <Route path="/settings" element={<div>Settings page</div>} />
                  <Route path="/create" element={<div>Create page</div>} />
                  <Route path="/import" element={<ImportDestination />} />
                </Route>
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
    nativeMenu.invoke.mockReset()
    nativeMenu.invoke.mockResolvedValue(undefined)
    nativeMenu.onAction = undefined
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

  it('opens and focuses Search with Cmd/Ctrl+F', async () => {
    renderAppBar()

    fireEvent.keyDown(window, { key: 'f', metaKey: true })

    const input = await screen.findByPlaceholderText('Search')
    expect(input).toHaveFocus()
    expect(screen.getByRole('button', { name: 'filter entries' })).toHaveAttribute(
      'aria-keyshortcuts',
      'Control+f Meta+f',
    )
  })

  it.each([
    ['n', 'Create page'],
    ['o', 'Import page'],
  ])('opens %s from the home screen with Cmd/Ctrl', (key, page) => {
    renderAppBar()

    fireEvent.keyDown(window, { key, ctrlKey: true })

    expect(screen.getByText(page)).toBeInTheDocument()
  })

  it('does not lock an unprotected vault with the shortcut', () => {
    renderAppBar()
    fireEvent.keyDown(window, { key: 'L', metaKey: true, shiftKey: true })
    expect(vault.lock).not.toHaveBeenCalled()
  })

  it('locks a protected vault with Cmd/Ctrl+Shift+L', async () => {
    window.localStorage.setItem('isPasswordSet', 'true')
    renderAppBar()
    fireEvent.keyDown(window, { key: 'L', metaKey: true, shiftKey: true })

    await waitFor(() => expect(vault.lock).toHaveBeenCalledOnce())
    expect(await screen.findByText('Unlock page')).toBeInTheDocument()
  })

  it('routes a native macOS menu action without also handling its keydown', async () => {
    os.platform = 'macos'
    renderAppBar()
    await waitFor(() => expect(nativeMenu.onAction).toBeTypeOf('function'))

    fireEvent.keyDown(window, { key: 'n', metaKey: true })
    expect(screen.queryByText('Create page')).not.toBeInTheDocument()

    act(() => nativeMenu.onAction?.({ payload: 'create' }))
    expect(screen.getByText('Create page')).toBeInTheDocument()
    expect(nativeMenu.invoke).toHaveBeenCalledWith('menu_set_enabled', {
      available: true,
      canLock: false,
    })
  })

  it('enables native Lock only while a protected vault is available', () => {
    os.platform = 'macos'
    window.localStorage.setItem('isPasswordSet', 'true')
    renderAppBar('/settings')

    expect(nativeMenu.invoke).toHaveBeenCalledWith('menu_set_enabled', {
      available: true,
      canLock: true,
    })
  })

  it('opens the import modal from the native macOS menu', async () => {
    os.platform = 'macos'
    renderAppBar()
    await waitFor(() => expect(nativeMenu.onAction).toBeTypeOf('function'))

    act(() => nativeMenu.onAction?.({ payload: 'import' }))
    expect(screen.getByText('Import modal requested')).toBeInTheDocument()
  })

  it('uses the native macOS Lock action and ignores actions while a dialog is open', async () => {
    os.platform = 'macos'
    window.localStorage.setItem('isPasswordSet', 'true')
    renderAppBar()
    await waitFor(() => expect(nativeMenu.onAction).toBeTypeOf('function'))

    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    document.body.appendChild(dialog)
    act(() => nativeMenu.onAction?.({ payload: 'lock' }))
    expect(vault.lock).not.toHaveBeenCalled()

    dialog.remove()
    act(() => nativeMenu.onAction?.({ payload: 'lock' }))
    await waitFor(() => expect(vault.lock).toHaveBeenCalledOnce())
    expect(await screen.findByText('Unlock page')).toBeInTheDocument()
  })

  it('locks to the correct route from Settings', async () => {
    window.localStorage.setItem('isPasswordSet', 'true')
    renderAppBar('/settings')

    fireEvent.keyDown(window, { key: 'L', metaKey: true, shiftKey: true })

    expect(await screen.findByText('Unlock page')).toBeInTheDocument()
  })

  it('ignores shortcuts while editing, in a dialog, or away from home', () => {
    renderAppBar()
    fireEvent.click(screen.getByRole('button', { name: 'filter entries' }))
    fireEvent.keyDown(screen.getByPlaceholderText('Search'), { key: 'n', metaKey: true })
    expect(screen.queryByText('Create page')).not.toBeInTheDocument()

    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    document.body.appendChild(dialog)
    fireEvent.keyDown(window, { key: 'o', metaKey: true })
    expect(screen.queryByText('Import page')).not.toBeInTheDocument()
    dialog.remove()
  })

  it('does not navigate away from a nested screen', () => {
    renderAppBar('/import/review')

    fireEvent.keyDown(window, { key: 'n', ctrlKey: true })

    expect(screen.getByRole('button', { name: 'menu' })).toBeInTheDocument()
    expect(screen.queryByText('Create page')).not.toBeInTheDocument()
  })

  it('does not leave a screen while navigation is disabled', () => {
    renderAppBar('/', true)

    fireEvent.keyDown(window, { key: 'n', ctrlKey: true })

    expect(screen.getByText('Home page')).toBeInTheDocument()
    expect(screen.queryByText('Create page')).not.toBeInTheDocument()
  })

  it('opens Import from Settings, where the shortcut is advertised', () => {
    renderAppBar('/settings')

    fireEvent.keyDown(window, { key: 'o', ctrlKey: true })

    expect(screen.getByText('Import page')).toBeInTheDocument()
    expect(screen.getByText('Import modal requested')).toBeInTheDocument()
  })

  it('returns to the home search from Settings', async () => {
    renderAppBar('/settings')

    fireEvent.keyDown(window, { key: 'f', metaKey: true })

    expect(await screen.findByPlaceholderText('Search')).toHaveFocus()
  })

  it('disables the back button while a screen is saving', () => {
    renderAppBar('/import/review', true)
    expect(screen.getByRole('button', { name: 'menu' })).toBeDisabled()
  })
})
