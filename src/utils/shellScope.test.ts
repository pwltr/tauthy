import { describe, expect, it } from 'vitest'

import tauriConfig from '../../src-tauri/tauri.conf.json'

describe('external-link shell scope', () => {
  const allowedUrl = new RegExp(tauriConfig.plugins.shell.open)

  it.each([
    'https://github.com/pwltr/tauthy',
    'https://github.com/pwltr/tauthy/issues',
    'https://github.com/pwltr/tauthy/releases',
    'https://github.com/pwltr/tauthy/blob/master/LICENSE',
    'https://www.buymeacoffee.com/pwltr',
    'https://pubkyring.app/',
  ])('permits the app’s external URL %s', (url) => {
    expect(allowedUrl.test(url)).toBe(true)
  })

  it.each([
    'https://pubkyring.app@evil.com/phish',
    'https://pubkyring.app.evil.com',
    'https://evil.com/?redir=https://pubkyring.app',
    'https://github.com/pwltr/tauthy.evil.com',
    'https://www.buymeacoffee.com/pwltr@evil.com',
    'http://pubkyring.app/',
  ])('rejects a URL outside the allowed origins: %s', (url) => {
    expect(allowedUrl.test(url)).toBe(false)
  })
})
