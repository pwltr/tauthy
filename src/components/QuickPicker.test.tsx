import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const bridge = vi.hoisted(() => ({
  invoke: vi.fn(),
  listeners: new Map<string, () => void>(),
}))
vi.mock('@tauri-apps/api/core', () => ({ invoke: bridge.invoke }))
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (event: string, callback: () => void) => {
    bridge.listeners.set(event, callback)
    return () => bridge.listeners.delete(event)
  }),
}))
vi.mock('~/hooks/useMediaQuery', () => ({ useMediaQuery: () => false }))
vi.mock('@tauri-apps/plugin-os', () => ({ type: () => 'macos' }))

import QuickPicker from './QuickPicker'

const entries = [
  {
    uuid: 'github',
    name: 'alice@example.com',
    issuer: 'GitHub',
    group: 'Work',
    icon: 'PHN2Zz48L3N2Zz4=',
    code: '123456',
  },
  { uuid: 'proton', name: 'alice', issuer: 'Proton', group: 'Personal', code: '654321' },
]
const event = async (name: string) => {
  await act(async () => bridge.listeners.get(name)?.())
}
const open = async () => {
  render(<QuickPicker />)
  await waitFor(() => expect(bridge.invoke).toHaveBeenCalledWith('quick_picker_ready'))
  await event('tauthy://picker-open')
}

describe('quick picker', () => {
  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem('i18nextLng', 'en')
    bridge.listeners.clear()
    bridge.invoke.mockReset()
    bridge.invoke.mockImplementation(async (command: string) => {
      if (command === 'quick_picker_snapshot') return { locked: false, entries }
    })
  })

  it('opens the main window through an accessible footer button', async () => {
    await open()
    const button = within(screen.getByRole('contentinfo')).getByRole('button', {
      name: 'Open Tauthy',
    })
    const image = within(button).getByAltText('')
    expect(image).toHaveAttribute('aria-hidden', 'true')
    fireEvent.click(button)
    expect(bridge.invoke).toHaveBeenCalledWith('quick_picker_open_main')
  })

  it('uses the saved digit grouping and updates when the main window changes it', async () => {
    localStorage.setItem('listOptions', JSON.stringify({ dense: false, groupByTwos: true }))
    await open()
    expect(screen.getByText('12 34 56')).toBeInTheDocument()
    localStorage.setItem('listOptions', JSON.stringify({ dense: false, groupByTwos: false }))
    fireEvent(window, new StorageEvent('storage', { key: 'listOptions' }))
    expect(screen.getByText('123 456')).toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' })
    expect(bridge.invoke).toHaveBeenCalledWith('quick_picker_copy', { uuid: 'github' })
  })

  it('shows saved account icons and initials for accounts without an icon', async () => {
    await open()
    const [github, proton] = screen.getAllByRole('option')
    expect(within(github).getByAltText('')).toHaveAttribute(
      'src',
      `data:image/svg+xml;base64,${entries[0].icon}`,
    )
    expect(within(proton).queryByAltText('')).not.toBeInTheDocument()
    expect(within(proton).getByText('P')).toBeInTheDocument()
  })

  it('falls back to initials for broken icons and displays a replacement after refresh', async () => {
    await open()
    const github = screen.getAllByRole('option')[0]
    fireEvent.error(within(github).getByAltText(''))
    expect(within(github).queryByAltText('')).not.toBeInTheDocument()
    expect(within(github).getByText('G')).toBeInTheDocument()

    const replacement = 'PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4='
    bridge.invoke.mockResolvedValue({
      locked: false,
      entries: [{ ...entries[0], icon: replacement }, entries[1]],
    })
    await event('tauthy://picker-refresh')
    expect(within(github).getByAltText('')).toHaveAttribute(
      'src',
      `data:image/svg+xml;base64,${replacement}`,
    )
  })

  it('searches issuer, account and group, then copies by account ID', async () => {
    await open()
    const input = screen.getByRole('combobox')
    fireEvent.change(input, { target: { value: 'github work alice' } })
    expect(screen.getAllByRole('option')).toHaveLength(1)
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() =>
      expect(bridge.invoke).toHaveBeenCalledWith('quick_picker_copy', { uuid: 'github' }),
    )
  })

  it.each(['staem', 'stae'])(
    'finds Steam for %s and copies the matching account',
    async (query) => {
      bridge.invoke.mockImplementation(async (command: string) => {
        if (command === 'quick_picker_snapshot')
          return {
            locked: false,
            entries: [{ ...entries[0], uuid: 'steam', issuer: 'Steam' }, entries[1]],
          }
      })
      await open()
      const input = screen.getByRole('combobox')
      fireEvent.change(input, { target: { value: query } })
      expect(screen.getAllByRole('option')).toHaveLength(1)
      expect(screen.getByRole('option')).toHaveTextContent('Steam')
      fireEvent.keyDown(input, { key: 'Enter' })
      expect(bridge.invoke).toHaveBeenCalledWith('quick_picker_copy', { uuid: 'steam' })
    },
  )

  it('prefers a literal match over a more recently used fuzzy match', async () => {
    localStorage.setItem(
      'entryUsage',
      JSON.stringify({ steam: { count: 10, lastUsedAt: Date.now() } }),
    )
    bridge.invoke.mockImplementation(async (command: string) => {
      if (command === 'quick_picker_snapshot')
        return {
          locked: false,
          entries: [
            { ...entries[0], uuid: 'steam', issuer: 'Steam' },
            { ...entries[1], uuid: 'literal', issuer: 'Staem' },
          ],
        }
    })
    await open()
    const input = screen.getByRole('combobox')
    fireEvent.change(input, { target: { value: 'staem' } })
    expect(screen.getAllByRole('option')).toHaveLength(2)
    expect(screen.getAllByRole('option')[0]).toHaveTextContent('Staem')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(bridge.invoke).toHaveBeenCalledWith('quick_picker_copy', { uuid: 'literal' })
  })

  it('supports keyboard selection and dismissal', async () => {
    await open()
    const input = screen.getByRole('combobox')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() =>
      expect(bridge.invoke).toHaveBeenCalledWith('quick_picker_copy', { uuid: 'proton' }),
    )
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(bridge.invoke).toHaveBeenCalledWith('quick_picker_dismiss')
  })

  it('copies the highlighted account with Command+C while search has focus', async () => {
    await open()
    const input = screen.getByRole('combobox')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(fireEvent.keyDown(input, { key: 'c', metaKey: true })).toBe(false)
    await waitFor(() =>
      expect(bridge.invoke).toHaveBeenCalledWith('quick_picker_copy', { uuid: 'proton' }),
    )
  })

  it('handles native Copy events without copying twice during an in-flight request', async () => {
    await open()
    bridge.invoke.mockImplementation(() => new Promise(() => {}))
    const input = screen.getByRole('combobox')
    fireEvent.keyDown(input, { key: 'c', metaKey: true })
    fireEvent.copy(input)
    fireEvent.keyDown(input, { key: 'c', metaKey: true, repeat: true })
    expect(bridge.invoke.mock.calls.filter(([command]) => command === 'quick_picker_copy')).toEqual(
      [['quick_picker_copy', { uuid: 'github' }]],
    )
  })

  it('copies the selected account through the native Copy event', async () => {
    await open()
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'ArrowDown' })
    expect(fireEvent.copy(screen.getByRole('combobox'))).toBe(false)
    expect(bridge.invoke).toHaveBeenCalledWith('quick_picker_copy', { uuid: 'proton' })
  })

  it('preserves copying selected search text and leaves other modified shortcuts alone', async () => {
    await open()
    const input = screen.getByRole('combobox') as HTMLInputElement
    input.focus()
    fireEvent.change(input, { target: { value: 'github' } })
    input.setSelectionRange(0, 6)
    expect(fireEvent.keyDown(input, { key: 'c', metaKey: true })).toBe(true)
    expect(fireEvent.copy(input)).toBe(true)
    input.setSelectionRange(6, 6)
    fireEvent.keyDown(input, { key: 'c', ctrlKey: true })
    fireEvent.keyDown(input, { key: 'C', metaKey: true, shiftKey: true })
    fireEvent.keyDown(input, { key: 'c', metaKey: true, altKey: true })
    expect(bridge.invoke).not.toHaveBeenCalledWith('quick_picker_copy', expect.anything())
  })

  it('does not copy from locked, empty, invalid or hidden picker state', async () => {
    await open()
    const input = screen.getByRole('combobox')
    fireEvent.change(input, { target: { value: 'no matching account' } })
    fireEvent.keyDown(input, { key: 'c', metaKey: true })
    fireEvent.copy(input)
    fireEvent.change(input, { target: { value: '' } })
    bridge.invoke.mockResolvedValue({ locked: false, entries: [{ ...entries[0], code: null }] })
    await event('tauthy://picker-refresh')
    fireEvent.keyDown(input, { key: 'c', metaKey: true })
    fireEvent.copy(input)
    bridge.invoke.mockResolvedValue({ locked: true, entries: [] })
    await event('tauthy://picker-refresh')
    fireEvent.keyDown(input, { key: 'c', metaKey: true })
    fireEvent.copy(input)
    await event('tauthy://picker-close')
    fireEvent.keyDown(input, { key: 'c', metaKey: true })
    fireEvent.copy(input)
    expect(bridge.invoke).not.toHaveBeenCalledWith('quick_picker_copy', expect.anything())
  })

  it('clears accounts immediately when the vault locks and sends Enter to the main window', async () => {
    await open()
    expect(screen.getAllByRole('option')).toHaveLength(2)
    bridge.invoke.mockResolvedValue({ locked: true, entries: [] })
    await event('tauthy://picker-refresh')
    expect(screen.queryByRole('option')).not.toBeInTheDocument()
    expect(within(screen.getByRole('listbox')).queryByAltText('')).not.toBeInTheDocument()
    expect(screen.getByText('Your vault is locked.')).toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' })
    expect(bridge.invoke).toHaveBeenCalledWith('quick_picker_open_main')
    expect(bridge.invoke).not.toHaveBeenCalledWith('quick_picker_copy', expect.anything())
  })

  it('discards a pending response after dismissal and resets search on reopening', async () => {
    let resolve: (value: unknown) => void = () => {}
    bridge.invoke.mockImplementation(async (command: string) => {
      if (command === 'quick_picker_snapshot')
        return new Promise((done) => {
          resolve = done
        })
    })
    await open()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'old query' } })
    await event('tauthy://picker-close')
    await act(async () => resolve({ locked: false, entries }))
    expect(screen.queryByRole('option')).not.toBeInTheDocument()
    bridge.invoke.mockResolvedValue({ locked: false, entries })
    await event('tauthy://picker-open')
    expect(screen.getByRole('combobox')).toHaveValue('')
    expect(screen.getAllByRole('option')).toHaveLength(2)
  })

  it('keeps the picker open when copying fails and blocks invalid codes', async () => {
    bridge.invoke.mockImplementation(async (command: string) => {
      if (command === 'quick_picker_snapshot')
        return {
          locked: false,
          entries: [...entries, { uuid: 'invalid', name: 'Invalid', code: null }],
        }
      if (command === 'quick_picker_copy') throw new Error('clipboard unavailable')
    })
    await open()
    fireEvent.click(screen.getByText('Invalid'))
    expect(bridge.invoke).not.toHaveBeenCalledWith('quick_picker_copy', { uuid: 'invalid' })
    fireEvent.click(screen.getByText('GitHub'))
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Could not copy the code. Try again.'),
    )
    expect(screen.getAllByRole('option')).toHaveLength(3)
  })
})
