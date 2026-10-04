import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
  { uuid: 'github', name: 'alice@example.com', issuer: 'GitHub', group: 'Work', code: '123456' },
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

  it('clears accounts immediately when the vault locks and sends Enter to the main window', async () => {
    await open()
    expect(screen.getAllByRole('option')).toHaveLength(2)
    bridge.invoke.mockResolvedValue({ locked: true, entries: [] })
    await event('tauthy://picker-refresh')
    expect(screen.queryByRole('option')).not.toBeInTheDocument()
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
