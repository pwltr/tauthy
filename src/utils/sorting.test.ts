import { describe, expect, it } from 'vitest'
import { sortEntries } from './sorting'

const entries = [
  { uuid: 'personal', name: 'Personal', issuer: 'Zulu' },
  { uuid: 'work', name: 'Work', issuer: 'alpha' },
  { uuid: 'fallback', name: 'Beta' },
]

describe('sortEntries', () => {
  it('sorts by the displayed service label without mutating the source list', () => {
    const source = [...entries]

    expect(sortEntries(source, 'a-z', [], {}, 'en').map(({ uuid }) => uuid)).toEqual([
      'work',
      'fallback',
      'personal',
    ])
    expect(source).toEqual(entries)
  })

  it('sorts frequent entries by count and then recency', () => {
    const usage = {
      personal: { count: 2, lastUsedAt: 100 },
      work: { count: 2, lastUsedAt: 200 },
      fallback: { count: 1, lastUsedAt: 300 },
    }

    expect(sortEntries(entries, 'frequent', [], usage, 'en').map(({ uuid }) => uuid)).toEqual([
      'work',
      'personal',
      'fallback',
    ])
  })

  it('sorts recent entries by the latest successful copy', () => {
    const usage = {
      personal: { count: 1, lastUsedAt: 100 },
      fallback: { count: 1, lastUsedAt: 300 },
    }

    expect(sortEntries(entries, 'recent', [], usage, 'en').map(({ uuid }) => uuid)).toEqual([
      'fallback',
      'personal',
      'work',
    ])
  })

  it('preserves manual ordering and appends new entries', () => {
    expect(
      sortEntries(entries, 'custom', ['personal', 'work'], {}, 'en').map(({ uuid }) => uuid),
    ).toEqual(['personal', 'work', 'fallback'])
  })
})
