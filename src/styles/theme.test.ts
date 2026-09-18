import { describe, expect, it, vi } from 'vitest'

vi.mock('@tauri-apps/plugin-os', () => ({ type: () => Promise.resolve('linux') }))

import { getDesignTokens, resolvePaletteMode } from '~/styles/theme'

describe('theme preferences', () => {
  it('follows the system color scheme when System is selected', () => {
    expect(resolvePaletteMode('system', false)).toBe('light')
    expect(resolvePaletteMode('system', true)).toBe('dark')
  })

  it('keeps an explicitly selected theme', () => {
    expect(resolvePaletteMode('light', true)).toBe('light')
    expect(resolvePaletteMode('dark', false)).toBe('dark')
    expect(resolvePaletteMode('black', false)).toBe('black')
  })

  it('disables button ripples when reduced motion is preferred', () => {
    const regularTheme = getDesignTokens('light', false)
    const reducedMotionTheme = getDesignTokens('light', true)

    expect(regularTheme.components?.MuiButtonBase?.defaultProps?.disableRipple).toBe(false)
    expect(reducedMotionTheme.components?.MuiButtonBase?.defaultProps?.disableRipple).toBe(true)
  })
})
