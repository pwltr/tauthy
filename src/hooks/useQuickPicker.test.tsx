import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { QuickPickerResponse } from '~/types/quickPicker'

const bridge = vi.hoisted(() => ({ invoke: vi.fn(), listeners: new Map<string, () => void>() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: bridge.invoke }))
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (name: string, callback: () => void) => {
    bridge.listeners.set(name, callback)
    return () => bridge.listeners.delete(name)
  }),
}))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'en' } }) }))

import { useQuickPicker } from './useQuickPicker'

const entries = [
  { uuid: 'github', name: 'alice', issuer: 'GitHub', icon: 'saved-icon', code: '123456' },
  { uuid: 'proton', name: 'bob', issuer: 'Proton', code: '654321' },
]
const full = (): QuickPickerResponse => ({
  locked: false,
  entries,
  expiresAtMs: Date.now() + 29_000,
})
const event = async (name: string) => {
  await act(async () => bridge.listeners.get(name)?.())
}
const mount = async () => {
  const hook = renderHook(() => useQuickPicker())
  await act(async () => {})
  expect(bridge.invoke).toHaveBeenCalledWith('quick_picker_ready')
  await event('tauthy://picker-open')
  return hook
}
const snapshotCalls = () =>
  bridge.invoke.mock.calls.filter(([command]) => command === 'quick_picker_snapshot')

beforeEach(() => {
  localStorage.clear()
  bridge.listeners.clear()
  bridge.invoke.mockReset()
  bridge.invoke.mockImplementation(async (command: string) => {
    if (command === 'quick_picker_snapshot') return full()
  })
})
afterEach(() => vi.useRealTimers())

it('keeps the selected account through metadata reordering, then safely falls back if it is removed', async () => {
  const { result } = await mount()
  act(() => result.current.select(1))
  bridge.invoke.mockResolvedValue({
    ...full(),
    entries: [{ ...entries[0], uuid: 'first', issuer: 'AAA' }, ...entries],
  })
  await event('tauthy://picker-refresh')
  expect(result.current.entries[result.current.selection].uuid).toBe('proton')
  await act(async () => result.current.copy(result.current.entries[result.current.selection]))
  expect(bridge.invoke).toHaveBeenCalledWith('quick_picker_copy', { uuid: 'proton' })

  bridge.invoke.mockResolvedValue({ ...full(), entries: [entries[0]] })
  await event('tauthy://picker-refresh')
  expect(result.current.entries[result.current.selection].uuid).toBe('github')
})

it('refreshes codes at the backend boundary without requesting metadata, and stops when dismissed', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(1_000_000)
  bridge.invoke.mockImplementation(async (command: string, args?: { includeMetadata: boolean }) => {
    if (command !== 'quick_picker_snapshot') return
    return args?.includeMetadata
      ? full()
      : {
          locked: false,
          codes: entries.map(({ uuid }) => ({ uuid, code: '999999' })),
          expiresAtMs: Date.now() + 30_000,
        }
  })
  const { result } = await mount()
  await act(async () => vi.advanceTimersByTimeAsync(10_000))
  expect(snapshotCalls()).toHaveLength(1)
  await act(async () => vi.advanceTimersByTimeAsync(19_010))
  expect(snapshotCalls()).toEqual([
    ['quick_picker_snapshot', { includeMetadata: true }],
    ['quick_picker_snapshot', { includeMetadata: false }],
  ])
  expect(result.current.entries[0]).toEqual({ ...entries[0], code: '999999' })
  await event('tauthy://picker-close')
  await act(async () => vi.advanceTimersByTimeAsync(60_000))
  expect(snapshotCalls()).toHaveLength(2)
  expect(result.current.snapshot).toBeNull()
})

it('serializes requests and gives a pending lock refresh priority over an old code response', async () => {
  const { result } = await mount()
  let resolve: (data: QuickPickerResponse) => void = () => {}
  bridge.invoke.mockImplementation(async (command: string, args?: { includeMetadata: boolean }) => {
    if (command !== 'quick_picker_snapshot') return
    if (args?.includeMetadata) return { locked: true, entries: [], expiresAtMs: null }
    return new Promise<QuickPickerResponse>((done) => {
      resolve = done
    })
  })
  await act(async () => window.dispatchEvent(new Event('focus')))
  await act(async () => window.dispatchEvent(new Event('focus')))
  await event('tauthy://picker-refresh')
  expect(snapshotCalls()).toHaveLength(2)
  expect(result.current.snapshot).toBeNull()
  await act(async () =>
    resolve({
      locked: false,
      codes: entries.map(({ uuid, code }) => ({ uuid, code })),
      expiresAtMs: Date.now() + 30_000,
    }),
  )
  expect(snapshotCalls()).toHaveLength(3)
  expect(snapshotCalls()[2][1]).toEqual({ includeMetadata: true })
  expect(result.current.snapshot).toEqual({ locked: true, entries: [] })
})

it('does not starve a slow request or accept its data after reopening', async () => {
  vi.useFakeTimers()
  let resolve: (data: QuickPickerResponse) => void = () => {}
  bridge.invoke.mockImplementationOnce(async () => {}) // ready
  bridge.invoke.mockImplementationOnce(
    () =>
      new Promise<QuickPickerResponse>((done) => {
        resolve = done
      }),
  )
  bridge.invoke.mockImplementation(async (command: string) =>
    command === 'quick_picker_snapshot' ? full() : undefined,
  )
  const { result } = await mount()
  await act(async () => vi.advanceTimersByTimeAsync(5000))
  expect(snapshotCalls()).toHaveLength(1)
  await event('tauthy://picker-close')
  await event('tauthy://picker-open')
  expect(snapshotCalls()).toHaveLength(1)
  await act(async () => resolve({ ...full(), entries: [{ ...entries[0], uuid: 'stale' }] }))
  expect(snapshotCalls()).toHaveLength(2)
  expect(result.current.entries.map(({ uuid }) => uuid)).toEqual(['github', 'proton'])
})

it('reloads metadata if a code-only response reveals an account change', async () => {
  const { result } = await mount()
  bridge.invoke.mockImplementation(async (command: string, args?: { includeMetadata: boolean }) => {
    if (command !== 'quick_picker_snapshot') return
    return args?.includeMetadata
      ? { ...full(), entries: [entries[1]] }
      : {
          locked: false,
          codes: [{ uuid: 'proton', code: '654321' }],
          expiresAtMs: Date.now() + 30_000,
        }
  })
  await act(async () => window.dispatchEvent(new Event('focus')))
  expect(
    snapshotCalls()
      .slice(-2)
      .map(([, args]) => args),
  ).toEqual([{ includeMetadata: false }, { includeMetadata: true }])
  expect(result.current.entries.map(({ uuid }) => uuid)).toEqual(['proton'])
})
