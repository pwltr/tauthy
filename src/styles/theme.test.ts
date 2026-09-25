import { describe, expect, it, vi } from 'vitest'
import { createTheme } from '@mui/material/styles'

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

  it('uses dark MUI component defaults for dark and black themes', () => {
    const light = createTheme(getDesignTokens('light'))
    const dark = createTheme(getDesignTokens('dark'))
    const black = createTheme(getDesignTokens('black'))

    expect(light.palette.mode).toBe('light')
    expect(dark.palette.mode).toBe('dark')
    expect(black.palette.mode).toBe('dark')
    expect(dark.palette.divider).not.toBe(light.palette.divider)
  })

  it('disables button ripples when reduced motion is preferred', () => {
    const regularTheme = getDesignTokens('light', false)
    const reducedMotionTheme = getDesignTokens('light', true)

    expect(regularTheme.components?.MuiButtonBase?.defaultProps?.disableRipple).toBe(false)
    expect(reducedMotionTheme.components?.MuiButtonBase?.defaultProps?.disableRipple).toBe(true)
  })
})
