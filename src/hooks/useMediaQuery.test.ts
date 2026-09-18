import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useMediaQuery } from '~/hooks/useMediaQuery'

describe('useMediaQuery', () => {
  let matches = false
  let listeners: Array<() => void> = []

  beforeEach(() => {
    matches = false
    listeners = []
    window.matchMedia = vi.fn().mockImplementation(
      () =>
        ({
          get matches() {
            return matches
          },
          addEventListener: (_event: string, listener: () => void) => listeners.push(listener),
          removeEventListener: (_event: string, listener: () => void) => {
            listeners = listeners.filter((candidate) => candidate !== listener)
          },
        }) as unknown as MediaQueryList,
    )
  })

  it('reacts when a system preference changes', () => {
    const { result } = renderHook(() => useMediaQuery('(prefers-reduced-motion: reduce)'))
    expect(result.current).toBe(false)

    act(() => {
      matches = true
      listeners.forEach((listener) => listener())
    })

    expect(result.current).toBe(true)
  })
})
