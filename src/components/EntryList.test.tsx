import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  copyToClipboard: vi.fn(),
  recordEntryUsage: vi.fn(),
  minimize: vi.fn(),
  menuNew: vi.fn(),
  menuPopup: vi.fn(),
  menuClose: vi.fn(),
  menuGet: vi.fn(),
  menuSetEnabled: vi.fn(),
  menuItems: [] as Array<{ id?: string; action?: () => void }>,
  confirm: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock('@tauri-apps/api/menu', () => ({
  Menu: { new: mocks.menuNew },
}))
vi.mock('@tauri-apps/plugin-dialog', () => ({ confirm: mocks.confirm }))
vi.mock('react-hot-toast', () => ({ default: { error: mocks.toastError } }))
vi.mock('~/components/modals/QRCode', () => ({
  default: ({ entry }: { entry: { name: string } }) => (
    <div data-testid="qr-modal">{entry.name}</div>
  ),
}))
vi.mock('@tauri-apps/api/webviewWindow', () => ({
  getCurrentWebviewWindow: () => ({ minimize: mocks.minimize }),
}))
vi.mock('@hello-pangea/dnd', () => ({
  DragDropContext: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Droppable: ({ children }: { children: (provided: object) => ReactNode }) =>
    children({ innerRef: vi.fn(), droppableProps: {}, placeholder: null }),
  Draggable: ({ children }: { children: (provided: object, snapshot: object) => ReactNode }) =>
    children(
      { innerRef: vi.fn(), draggableProps: {}, dragHandleProps: { 'data-drag-handle': 'true' } },
      { isDragging: false },
    ),
}))
vi.mock('~/utils', () => ({
  copyToClipboard: mocks.copyToClipboard,
  recordEntryUsage: mocks.recordEntryUsage,
  reorderList: (entries: unknown) => entries,
  sortEntries: (entries: unknown) => entries,
}))

import EntryList from '~/components/EntryList'
import { AppSettingsContext, SearchContext } from '~/context'

describe('single-result copy shortcut', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => {
      if (vi.isMockFunction(mock)) mock.mockReset()
    })
    mocks.menuItems = []
    mocks.menuNew.mockImplementation(async ({ items }) => {
      mocks.menuItems = items
      return { popup: mocks.menuPopup, close: mocks.menuClose, get: mocks.menuGet }
    })
    mocks.menuGet.mockImplementation(async () => ({ setEnabled: mocks.menuSetEnabled }))
    mocks.confirm.mockResolvedValue(false)
  })

  it.each(['staem', 'stae'])('finds Steam for %s and copies the matching account', (searchTerm) => {
    const { container } = render(
      <MemoryRouter>
        <SearchContext.Provider value={{ searchTerm, setSearch: vi.fn() }}>
          <EntryList
            entries={[
              { uuid: 'steam', name: 'alice', issuer: 'Steam', secret: 'secret', token: '123456' },
              { uuid: 'github', name: 'bob', issuer: 'GitHub', secret: 'secret', token: '654321' },
            ]}
          />
        </SearchContext.Provider>
      </MemoryRouter>,
    )
    const rows = container.querySelectorAll('[data-code-row]')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toHaveTextContent('Steam')
    fireEvent.keyDown(window, { key: 'c', metaKey: true })
    expect(mocks.copyToClipboard).toHaveBeenCalledWith('123456')
  })

  it('copies only from the list, never while typing', async () => {
    render(
      <MemoryRouter>
        <input aria-label="other text" />
        <EntryList
          entries={[{ uuid: 'account', name: 'Account', secret: 'secret', token: '123456' }]}
        />
      </MemoryRouter>,
    )

    fireEvent.keyDown(screen.getByRole('textbox', { name: 'other text' }), {
      key: 'c',
      metaKey: true,
    })
    fireEvent.copy(screen.getByRole('textbox', { name: 'other text' }))
    expect(mocks.copyToClipboard).not.toHaveBeenCalled()

    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    document.body.appendChild(dialog)
    fireEvent.keyDown(window, { key: 'c', metaKey: true })
    expect(mocks.copyToClipboard).not.toHaveBeenCalled()
    dialog.remove()

    fireEvent.keyDown(window, { key: 'c', metaKey: true })
    expect(mocks.copyToClipboard).toHaveBeenCalledWith('123456')
    await waitFor(() => expect(mocks.recordEntryUsage).toHaveBeenCalledWith('account'))

    mocks.copyToClipboard.mockClear()
    fireEvent.copy(window)
    expect(mocks.copyToClipboard).toHaveBeenCalledWith('123456')
  })

  it('copies the sole result from search unless its text is selected', () => {
    render(
      <MemoryRouter>
        <input aria-label="search" data-tauthy-search="true" defaultValue="Account" />
        <EntryList
          entries={[{ uuid: 'account', name: 'Account', secret: 'secret', token: '123456' }]}
        />
      </MemoryRouter>,
    )
    const search = screen.getByRole('textbox', { name: 'search' }) as HTMLInputElement
    search.focus()
    search.setSelectionRange(7, 7)

    fireEvent.keyDown(search, { key: 'c', metaKey: true })
    expect(mocks.copyToClipboard).toHaveBeenCalledWith('123456')

    mocks.copyToClipboard.mockClear()
    fireEvent.copy(window)
    expect(mocks.copyToClipboard).toHaveBeenCalledWith('123456')

    mocks.copyToClipboard.mockClear()
    search.setSelectionRange(0, 7)
    fireEvent.keyDown(search, { key: 'c', metaKey: true })
    fireEvent.copy(window)
    expect(mocks.copyToClipboard).not.toHaveBeenCalled()
  })

  it('uses the current minimize-on-copy setting for the shortcut', async () => {
    const view = (minimizeOnCopy: boolean) => (
      <MemoryRouter>
        <AppSettingsContext.Provider
          value={{ minimizeOnCopy, showTrayIcon: false, setAppSettings: vi.fn() }}
        >
          <EntryList
            entries={[{ uuid: 'account', name: 'Account', secret: 'secret', token: '123456' }]}
          />
        </AppSettingsContext.Provider>
      </MemoryRouter>
    )
    const { rerender } = render(view(false))

    fireEvent.keyDown(window, { key: 'c', metaKey: true })
    await waitFor(() => expect(mocks.recordEntryUsage).toHaveBeenCalledOnce())
    expect(mocks.minimize).not.toHaveBeenCalled()

    rerender(view(true))
    fireEvent.keyDown(window, { key: 'c', metaKey: true })
    await waitFor(() => expect(mocks.minimize).toHaveBeenCalledOnce())
  })

  it('moves focus with arrows and copies the focused row with Cmd+C or Enter', async () => {
    const { container } = render(
      <MemoryRouter>
        <EntryList
          entries={[
            { uuid: 'first', name: 'First', secret: 'secret', token: '111111' },
            { uuid: 'second', name: 'Second', secret: 'secret', token: '222222' },
          ]}
        />
      </MemoryRouter>,
    )
    const rows = [...container.querySelectorAll<HTMLElement>('[data-code-row]')]
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveAttribute('data-drag-handle', 'true')
    expect(rows[0].parentElement).not.toHaveAttribute('data-drag-handle')

    fireEvent.keyDown(window, { key: 'ArrowDown' })
    expect(rows[0]).toHaveFocus()
    fireEvent.keyDown(rows[0], { key: 'ArrowDown' })
    expect(rows[1]).toHaveFocus()

    fireEvent.keyDown(rows[1], { key: 'c', metaKey: true })
    expect(mocks.copyToClipboard).toHaveBeenCalledWith('222222')
    await waitFor(() => expect(mocks.recordEntryUsage).toHaveBeenCalledWith('second'))

    mocks.copyToClipboard.mockClear()
    fireEvent.keyDown(rows[1], { key: 'Enter' })
    expect(mocks.copyToClipboard).toHaveBeenCalledWith('222222')

    mocks.copyToClipboard.mockClear()
    fireEvent.copy(rows[1])
    expect(mocks.copyToClipboard).toHaveBeenCalledOnce()
    expect(mocks.copyToClipboard).toHaveBeenCalledWith('222222')

    fireEvent.keyDown(rows[1], { key: 'ArrowUp' })
    expect(rows[0]).toHaveFocus()
  })

  it('leaves ArrowDown alone in text fields and dialogs', () => {
    const { container } = render(
      <MemoryRouter>
        <input aria-label="search input" />
        <EntryList
          entries={[{ uuid: 'first', name: 'First', secret: 'secret', token: '111111' }]}
        />
      </MemoryRouter>,
    )
    const row = container.querySelector<HTMLElement>('[data-code-row]')!

    fireEvent.keyDown(screen.getByRole('textbox', { name: 'search input' }), {
      key: 'ArrowDown',
    })
    expect(row).not.toHaveFocus()

    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    document.body.appendChild(dialog)
    fireEvent.keyDown(window, { key: 'ArrowDown' })
    expect(row).not.toHaveFocus()
    dialog.remove()
  })

  it('opens the native menu for the right-clicked account and reuses its copy action', async () => {
    const { container } = render(
      <MemoryRouter>
        <EntryList
          entries={[
            { uuid: 'first', name: 'First', secret: 'secret', token: '111111' },
            { uuid: 'second', name: 'Second', secret: 'secret', token: '222222' },
          ]}
        />
      </MemoryRouter>,
    )
    const rows = [...container.querySelectorAll<HTMLElement>('[data-code-row]')]
    await waitFor(() => expect(mocks.menuNew).toHaveBeenCalledOnce())

    fireEvent.contextMenu(rows[1])
    await waitFor(() => expect(mocks.menuPopup).toHaveBeenCalledOnce())
    expect(mocks.menuSetEnabled).toHaveBeenCalledWith(true)
    mocks.menuItems.find((item) => item.id === 'account-copy')?.action?.()

    await waitFor(() => expect(mocks.copyToClipboard).toHaveBeenCalledWith('222222'))
    expect(mocks.recordEntryUsage).toHaveBeenCalledWith('second')
    expect(mocks.copyToClipboard).not.toHaveBeenCalledWith('111111')
  })

  it('disables code actions for entries with invalid secrets', async () => {
    const { container } = render(
      <MemoryRouter>
        <EntryList entries={[{ uuid: 'invalid', name: 'Invalid', secret: 'bad', token: '' }]} />
      </MemoryRouter>,
    )
    await waitFor(() => expect(mocks.menuNew).toHaveBeenCalledOnce())
    fireEvent.contextMenu(container.querySelector('[data-code-row]')!)
    await waitFor(() => expect(mocks.menuPopup).toHaveBeenCalledOnce())
    expect(mocks.menuSetEnabled).toHaveBeenCalledWith(false)
  })

  it('opens the selected account QR or Edit screen from the menu', async () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route
            path="/"
            element={
              <EntryList
                entries={[{ uuid: 'account', name: 'Account', secret: 'secret', token: '123456' }]}
              />
            }
          />
          <Route path="/edit/:id" element={<div data-testid="edit-screen" />} />
        </Routes>
      </MemoryRouter>,
    )
    await waitFor(() => expect(mocks.menuNew).toHaveBeenCalledOnce())
    fireEvent.contextMenu(container.querySelector('[data-code-row]')!)
    await waitFor(() => expect(mocks.menuPopup).toHaveBeenCalledOnce())

    mocks.menuItems.find((item) => item.id === 'account-qr')?.action?.()
    await waitFor(() => expect(screen.getByTestId('qr-modal')).toHaveTextContent('Account'))

    mocks.menuItems.find((item) => item.id === 'account-edit')?.action?.()
    await waitFor(() => expect(screen.getByTestId('edit-screen')).toBeInTheDocument())
  })

  it('requires confirmation before deleting the selected account', async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined)
    const { container } = render(
      <MemoryRouter>
        <EntryList
          entries={[{ uuid: 'account', name: 'Account', secret: 'secret', token: '123456' }]}
          onDelete={onDelete}
        />
      </MemoryRouter>,
    )
    await waitFor(() => expect(mocks.menuNew).toHaveBeenCalledOnce())
    fireEvent.contextMenu(container.querySelector('[data-code-row]')!)
    await waitFor(() => expect(mocks.menuPopup).toHaveBeenCalledOnce())

    mocks.menuItems.find((item) => item.id === 'account-delete')?.action?.()
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledOnce())
    expect(onDelete).not.toHaveBeenCalled()

    mocks.confirm.mockResolvedValue(true)
    mocks.menuItems.find((item) => item.id === 'account-delete')?.action?.()
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith('account'))
  })
})
