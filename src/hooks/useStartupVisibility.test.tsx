import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const bridge = vi.hoisted(() => ({ invoke: vi.fn(), platform: 'windows' }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: bridge.invoke }))
vi.mock('@tauri-apps/plugin-os', () => ({ type: () => bridge.platform }))

import { useStartupVisibility } from './useStartupVisibility'

beforeEach(() => {
  vi.useFakeTimers()
  bridge.platform = 'windows'
  bridge.invoke.mockReset().mockResolvedValue(undefined)
})
afterEach(() => vi.useRealTimers())

it.each([
  ['windows', '#ffffff'],
  ['windows', '#191919'],
  ['macos', '#ffffff'],
  ['macos', '#1e1e1e'],
])('reveals %s with the committed app background %s', async (platform, background) => {
  bridge.platform = platform
  const { rerender } = renderHook(({ color }) => useStartupVisibility(color), {
    initialProps: { color: background },
  })
  expect(bridge.invoke).not.toHaveBeenCalled()
  await act(async () => vi.advanceTimersByTimeAsync(100))
  expect(bridge.invoke).toHaveBeenCalledExactlyOnceWith('startup_ready', { background })

  rerender({ color: '#000000' })
  await act(async () => vi.advanceTimersByTimeAsync(100))
  expect(bridge.invoke).toHaveBeenCalledTimes(1)
})

it('waits for the final theme if it changes before the window is revealed', async () => {
  const { rerender } = renderHook(({ color }) => useStartupVisibility(color), {
    initialProps: { color: '#ffffff' },
  })
  await act(async () => vi.advanceTimersByTimeAsync(50))
  rerender({ color: '#191919' })
  await act(async () => vi.advanceTimersByTimeAsync(99))
  expect(bridge.invoke).not.toHaveBeenCalled()
  await act(async () => vi.advanceTimersByTimeAsync(1))
  expect(bridge.invoke).toHaveBeenCalledExactlyOnceWith('startup_ready', {
    background: '#191919',
  })
})

it('cancels the reveal when unmounted', async () => {
  const { unmount } = renderHook(() => useStartupVisibility('#ffffff'))
  unmount()
  await act(async () => vi.advanceTimersByTimeAsync(100))
  expect(bridge.invoke).not.toHaveBeenCalled()
})

it('does not invoke the native startup command on Linux', async () => {
  bridge.platform = 'linux'
  renderHook(() => useStartupVisibility('#232629'))
  await act(async () => vi.advanceTimersByTimeAsync(100))
  expect(bridge.invoke).not.toHaveBeenCalled()
})
