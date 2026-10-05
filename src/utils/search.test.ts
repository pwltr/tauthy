import { describe, expect, it } from 'vitest'
import { searchEntries } from './search'

const steam = { name: 'alice@example.com', issuer: 'Steam', group: 'Personal' }

describe('account search', () => {
  it.each(['staem', 'steem', 'stem', 'steamm', ' STEAM ', 'ste'])('finds Steam for %s', (query) => {
    expect(searchEntries([steam], query)).toEqual([steam])
  })

  it.each(['stae', 'stam', 'stew', 'staem'])('matches a mistyped word prefix for %s', (query) => {
    const entry = { ...steam, issuer: 'Steamworks Gaming' }
    expect(searchEntries([entry], query)).toEqual([entry])
  })

  it('keeps prefix matching bounded to the existing typo budget', () => {
    expect(searchEntries([steam], 'stae')).toEqual([steam])
    expect(searchEntries([steam], 'zeam')).toEqual([])
    expect(searchEntries([steam], 'xz')).toEqual([])
    expect(searchEntries([{ name: 'XSteam' }], 'stae')).toEqual([])
    expect(searchEntries([{ name: 'abacus' }], 'axy')).toEqual([])
  })

  it('matches terms across issuer, account and group, ignoring case and accents', () => {
    const entry = { ...steam, name: 'José', group: 'Work' }
    expect(searchEntries([entry], 'STAEM jose wrok')).toEqual([entry])
    expect(searchEntries([entry], 'staem unrelated')).toEqual([])
  })

  it('handles typos within a service name in a longer label and in an email address', () => {
    const entry = { ...steam, issuer: 'Steam Gaming' }
    expect(searchEntries([entry], 'staem')).toEqual([entry])
    expect(searchEntries([entry], 'alic@example.com')).toEqual([entry])
  })

  it('allows two typos in longer terms but keeps short terms literal', () => {
    const entry = { name: 'Microsoft' }
    expect(searchEntries([entry], 'microsfotx')).toEqual([entry])
    expect(searchEntries([steam], 'sx')).toEqual([])
    expect(searchEntries([steam], 'st')).toEqual([steam])
    expect(searchEntries([steam], 'stzzz')).toEqual([])
  })

  it('ranks literal matches first and preserves existing order among equal matches', () => {
    const secondSteam = { ...steam, name: 'bob' }
    const literal = { name: 'Staem' }
    const entries = [secondSteam, steam, literal]
    expect(searchEntries(entries, 'staem')).toEqual([literal, secondSteam, steam])
    expect(searchEntries(entries, '   ')).toEqual(entries)
    expect(entries).toEqual([secondSteam, steam, literal])
  })

  it('ranks literal prefix matches above fuzzy prefixes and matches terms across fields', () => {
    const fuzzy = { ...steam, group: 'Work' }
    const literal = { name: 'Staedtler', group: 'Work' }
    expect(searchEntries([fuzzy, literal], 'stae')).toEqual([literal, fuzzy])
    expect(searchEntries([fuzzy], 'stae wrok')).toEqual([fuzzy])
  })

  it('bounds fuzzy matching for very long account names', () => {
    const entry = { name: `Steam${'x'.repeat(10000)}` }
    expect(searchEntries([entry], 'stae')).toEqual([entry])
  })

  it('never searches secrets or generated codes', () => {
    expect(
      searchEntries([{ ...steam, secret: 'private-secret', code: '123456' }], '123456'),
    ).toEqual([])
    expect(searchEntries([{ ...steam, secret: 'private-secret' }], 'private-secret')).toEqual([])
  })

  it('handles long pasted searches without fuzzy expansion', () => {
    const name = 'a'.repeat(1000)
    expect(searchEntries([{ name }], name)).toEqual([{ name }])
    expect(searchEntries([{ name }], `${name}x`)).toEqual([])
  })
})
