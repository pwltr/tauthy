import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const html = readFileSync('index.html', 'utf8')
const bootstrap = html.match(/<script id="startup-theme">([\s\S]*?)<\/script>/)?.[1]
if (!bootstrap) throw new Error('Missing inline startup bootstrap')
const run = (dark: boolean) => {
  vi.stubGlobal('matchMedia', () => ({ matches: dark }))
  // Execute the actual dependency-free script, including before React exists.
  new Function(bootstrap)()
}
describe('pre-React startup background', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute('style')
  })
  it.each([
    [true, 'rgb(30, 30, 30)'],
    [false, 'rgb(255, 255, 255)'],
  ])('uses system preference: dark=%s', (dark, expected) => {
    run(dark)
    expect(document.documentElement.style.backgroundColor).toBe(expected)
  })
  it.each([
    ['dark', false, 'rgb(30, 30, 30)'],
    ['light', true, 'rgb(255, 255, 255)'],
    ['black', false, 'rgb(0, 0, 0)'],
  ])('respects explicit %s even against system preference', (mode, dark, expected) => {
    localStorage.setItem('theme', JSON.stringify(mode))
    run(dark)
    expect(document.documentElement.style.backgroundColor).toBe(expected)
  })
  it('uses exact cached platform color only for the resolved mode', () => {
    localStorage.setItem('startupTheme', JSON.stringify({ mode: 'dark', background: '#232629' }))
    run(true)
    expect(document.documentElement.style.backgroundColor).toBe('rgb(35, 38, 41)')
    run(false)
    expect(document.documentElement.style.backgroundColor).toBe('rgb(255, 255, 255)')
  })
  it('rejects malformed preferences and unsafe cached CSS', () => {
    localStorage.setItem('theme', 'broken')
    localStorage.setItem(
      'startupTheme',
      JSON.stringify({ mode: 'dark', background: 'url(secret)' }),
    )
    run(true)
    expect(document.documentElement.style.backgroundColor).toBe('rgb(30, 30, 30)')
  })
  it('loads before the React module and keeps baseline inside the theme provider', () => {
    expect(html).not.toMatch(/<style[\s>]/)
    expect(html).toContain('href="/startup-theme.css"')
    expect(html.indexOf('<script id="startup-theme">')).toBeLessThan(html.indexOf('/src/main.tsx'))
    expect(html).not.toContain('src="/startup-theme.js"')
    const app = readFileSync('src/App.tsx', 'utf8')
    expect(app.indexOf('<ThemeProvider theme={theme}>')).toBeLessThan(
      app.indexOf('<CssBaseline />'),
    )
    expect(app.lastIndexOf('</ThemeProvider>')).toBeGreaterThan(app.indexOf('<GlobalStyle />'))
  })
})
