import { describe, expect, it } from 'vitest'
import { vaultErrorCode, vaultErrorMessage } from './vaultErrors'
import translations from '~/locales'

describe('vault error boundary', () => {
  it('recognizes structured and old string errors without leaking arbitrary detail', () => {
    expect(vaultErrorCode({ code: 'vaultAuthenticationFailed' })).toBe('vaultAuthenticationFailed')
    expect(vaultErrorCode('Please try another password.')).toBe('vaultAuthenticationFailed')
    expect(vaultErrorCode(new Error('record not found'))).toBe('vaultRecordMissing')
    expect(vaultErrorMessage({ code: 'unknown', detail: 'secret' }, (key) => key)).toBe(
      'vaultErrors.generic',
    )
  })
  it('keeps recovery messages distinct and supplies every group in all locales', () => {
    const t = (key: string) => `translated ${key}`
    expect(vaultErrorMessage({ code: 'vaultStagedCleanupFailed' }, t)).not.toBe(
      vaultErrorMessage({ code: 'vaultCorrupt' }, t),
    )
    for (const locale of Object.values(translations)) {
      expect(Object.keys(locale.vaultErrors).sort()).toEqual(
        Object.keys(translations.en.vaultErrors).sort(),
      )
      expect(Object.keys(locale.vaultUi).sort()).toEqual(
        Object.keys(translations.en.vaultUi).sort(),
      )
    }
  })
})
