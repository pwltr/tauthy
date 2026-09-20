import { describe, expect, it } from 'vitest'

import { createTauthyBackup, mergeTauthyImport, parseTauthyBackup } from '~/utils/tauthyBackup'
import type { VaultEntry } from '~/types'

const iconBase64 = 'PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjwvc3ZnPg=='

const entries: VaultEntry[] = [
  {
    uuid: '11111111-1111-4111-8111-111111111111',
    name: 'alice@example.com',
    issuer: 'Example',
    group: 'Personal',
    icon: iconBase64,
    secret: 'JBSW Y3DP ehpk3pxp==',
  },
  {
    uuid: '22222222-2222-4222-8222-222222222222',
    name: 'No optional metadata',
    secret: 'ABC234',
  },
]

describe('Tauthy backup format', () => {
  it('creates a versioned v1 document with explicit OTP settings', () => {
    expect(createTauthyBackup(entries, new Date('2026-09-20T12:30:00.000Z'))).toEqual({
      format: 'tauthy-backup',
      version: 1,
      exportedAt: '2026-09-20T12:30:00.000Z',
      entries: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          name: 'alice@example.com',
          issuer: 'Example',
          group: 'Personal',
          icon: {
            mimeType: 'image/svg+xml',
            base64: iconBase64,
          },
          otp: {
            type: 'totp',
            secret: 'JBSW Y3DP ehpk3pxp==',
            algorithm: 'SHA1',
            digits: 6,
            period: 30,
          },
        },
        {
          id: '22222222-2222-4222-8222-222222222222',
          name: 'No optional metadata',
          otp: {
            type: 'totp',
            secret: 'ABC234',
            algorithm: 'SHA1',
            digits: 6,
            period: 30,
          },
        },
      ],
    })
  })

  it('round-trips every field supported by the current vault', () => {
    expect(parseTauthyBackup(createTauthyBackup(entries))).toEqual(entries)
  })

  it('continues to import legacy unversioned array backups', () => {
    expect(parseTauthyBackup(entries)).toEqual(entries)
  })

  it('repairs duplicate IDs in legacy backups instead of making them unrestorable', () => {
    const legacy = [entries[0], { ...entries[1], uuid: entries[0].uuid }]
    const imported = parseTauthyBackup(legacy)

    expect(imported[0].uuid).toBe(entries[0].uuid)
    expect(imported[1].uuid).not.toBe(entries[0].uuid)
    expect(imported[1]).toMatchObject({ name: entries[1].name, secret: entries[1].secret })
  })

  it('ignores unknown fields for forward-compatible additions', () => {
    const backup = createTauthyBackup(entries)
    const extended = {
      ...backup,
      futureMetadata: true,
      entries: backup.entries.map((entry) => ({ ...entry, futureEntryField: 'ignored' })),
    }

    expect(parseTauthyBackup(extended)).toEqual(entries)
  })

  it('rejects backups from a newer Tauthy format', () => {
    expect(() => parseTauthyBackup({ ...createTauthyBackup(entries), version: 2 })).toThrowError(
      'importTauthyNewerVersion',
    )
  })

  it('rejects duplicate IDs before modifying the vault', () => {
    const backup = createTauthyBackup(entries)
    backup.entries[1].id = backup.entries[0].id

    expect(() => parseTauthyBackup(backup)).toThrowError('importTauthyDuplicateIds')
  })

  it.each(['not base64', 'PHN2Zy', 'A'.repeat(512 * 1024 + 4)])(
    'rejects invalid or oversized embedded icons',
    (base64) => {
      const backup = createTauthyBackup(entries)
      backup.entries[0].icon = { mimeType: 'image/svg+xml', base64 }

      expect(() => parseTauthyBackup(backup)).toThrowError('importFailed')
    },
  )

  it.each([
    {},
    { format: 'tauthy-backup', version: 1, exportedAt: 'not-a-date', entries: [] },
    {
      ...createTauthyBackup(entries),
      exportedAt: '2026-09-20T12:30:00+02:00',
    },
    {
      format: 'tauthy-backup',
      version: 1,
      exportedAt: '2026-09-20T12:30:00.000Z',
      entries: [{ id: 'id', name: 'name', otp: { type: 'hotp', secret: 'ABC234' } }],
    },
  ])('rejects malformed or unsupported v1 data', (backup) => {
    expect(() => parseTauthyBackup(backup)).toThrowError('importFailed')
  })

  it('skips identical existing entries when merging a backup', () => {
    expect(mergeTauthyImport(entries, [entries[0]])).toEqual(entries)
  })

  it('rejects an ID collision with different account contents', () => {
    expect(() =>
      mergeTauthyImport(entries, [{ ...entries[0], name: 'Different account' }]),
    ).toThrowError('importTauthyIdConflict')
  })
})
