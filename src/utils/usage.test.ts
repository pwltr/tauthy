import { beforeEach, describe, expect, it } from 'vitest'
import { ENTRY_USAGE_STORAGE_KEY, recordEntryUsage } from './usage'

describe('recordEntryUsage', () => {
  beforeEach(() => window.localStorage.clear())

  it('tracks successful-copy count and recency locally', () => {
    recordEntryUsage('account', 100)
    recordEntryUsage('account', 200)

    expect(JSON.parse(window.localStorage.getItem(ENTRY_USAGE_STORAGE_KEY)!)).toEqual({
      account: { count: 2, lastUsedAt: 200 },
    })
  })

  it('recovers from malformed local metadata', () => {
    window.localStorage.setItem(ENTRY_USAGE_STORAGE_KEY, 'invalid')
    recordEntryUsage('account', 100)

    expect(JSON.parse(window.localStorage.getItem(ENTRY_USAGE_STORAGE_KEY)!)).toEqual({
      account: { count: 1, lastUsedAt: 100 },
    })
  })

  it('recovers from valid JSON that is not a usage map', () => {
    window.localStorage.setItem(ENTRY_USAGE_STORAGE_KEY, 'null')
    recordEntryUsage('account', 100)

    expect(JSON.parse(window.localStorage.getItem(ENTRY_USAGE_STORAGE_KEY)!)).toEqual({
      account: { count: 1, lastUsedAt: 100 },
    })
  })
})
