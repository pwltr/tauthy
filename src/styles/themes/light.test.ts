import { afterEach, describe, expect, it, vi } from 'vitest'

const os = vi.hoisted(() => ({ platform: 'linux' }))
vi.mock('@tauri-apps/plugin-os', () => ({ type: () => Promise.resolve(os.platform) }))

afterEach(() => {
  os.platform = 'linux'
  vi.resetModules()
})

describe('platform theme colors', () => {
  it('uses white surfaces and a readable header on macOS', async () => {
    os.platform = 'macos'
    vi.resetModules()
    const { default: light } = await import('./light')

    expect(light.mui.palette.secondary.main).toBe('#ffffff')
    expect(light.mui.palette.secondary.contrastText).toBe(light.mui.palette.text.primary)
    expect(light.mui.palette.background.default).toBe('#ffffff')
    expect(light.mui.palette.background.paper).toBe('#ffffff')
    expect(light.mui.palette.primary.main).toBe('#363636')
  })

  it('uses a slightly darker header while preserving the dark background on macOS', async () => {
    os.platform = 'macos'
    vi.resetModules()
    const { default: dark } = await import('./dark')

    expect(dark.mui.palette.secondary.main).toBe('#262626')
    expect(dark.mui.palette.background.default).toBe('#1e1e1e')
  })

  it('uses the Windows light header color with readable text without changing dark mode', async () => {
    os.platform = 'windows'
    vi.resetModules()
    const { default: light } = await import('./light')
    const { default: dark } = await import('./dark')

    expect(light.mui.palette.secondary.main).toBe('#f8f8f8')
    expect(light.mui.palette.secondary.contrastText).toBe(light.mui.palette.text.primary)
    expect(light.mui.palette.primary.main).toBe('#191919')
    expect(light.mui.palette.background.default).toBe('#ffffff')
    expect(light.mui.palette.background.paper).toBe('#ffffff')
    expect(dark.mui.palette.secondary.main).toBe('#2c2c2c')
    expect(dark.mui.palette.background.default).toBe('#191919')
  })

  it('preserves Linux colors', async () => {
    os.platform = 'linux'
    vi.resetModules()
    const { default: light } = await import('./light')

    expect(light.mui.palette.secondary.main).toBe('#31363b')
    expect(light.mui.palette.background.default).toBe('#232629')
  })
})
