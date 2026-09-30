import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  copyToClipboard: vi.fn(),
  recordEntryUsage: vi.fn(),
  minimize: vi.fn(),
}))

vi.mock('@tauri-apps/api/webviewWindow', () => ({
  getCurrentWebviewWindow: () => ({ minimize: mocks.minimize }),
}))
vi.mock('@hello-pangea/dnd', () => ({
  DragDropContext: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Droppable: ({ children }: { children: (provided: object) => ReactNode }) =>
    children({ innerRef: vi.fn(), droppableProps: {}, placeholder: null }),
  Draggable: ({ children }: { children: (provided: object, snapshot: object) => ReactNode }) =>
    children({ innerRef: vi.fn(), draggableProps: {}, dragHandleProps: {} }, { isDragging: false }),
}))
vi.mock('~/utils', () => ({
  copyToClipboard: mocks.copyToClipboard,
  recordEntryUsage: mocks.recordEntryUsage,
  reorderList: (entries: unknown) => entries,
  sortEntries: (entries: unknown) => entries,
}))

import EntryList from '~/components/EntryList'

describe('single-result copy shortcut', () => {
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
  })
})
