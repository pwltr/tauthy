import { beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.hoisted(() => vi.fn())
const mockVault = vi.hoisted(() => ({ getVault: vi.fn(), save: vi.fn() }))

vi.mock('@tauri-apps/api/core', () => ({ invoke }))
vi.mock('~/utils/storage', () => ({ vault: mockVault }))

import {
  decryptAegisBackup,
  generateTOTPs,
  getTOTPRefreshDelay,
  importFile,
  isEncryptedAegisBackup,
  isEncryptedImport,
  parseImportedEntries,
  parseOtpAuthUri,
} from '~/utils/codes'

describe('Aegis imports', () => {
  beforeEach(() => {
    invoke.mockReset()
    mockVault.getVault.mockReset()
    mockVault.save.mockReset()
  })

  it('detects encrypted vaults and delegates authenticated decryption to Rust', async () => {
    const database = { version: 3, entries: [], groups: [] }
    invoke.mockResolvedValue(database)
    const backup = { version: 1, header: { slots: [] }, db: 'ciphertext' }

    expect(isEncryptedAegisBackup(backup)).toBe(true)
    expect(isEncryptedAegisBackup({ db: database })).toBe(false)
    expect(isEncryptedImport(backup, 'aegis')).toBe(true)
    expect(isEncryptedImport(backup, 'tauthy')).toBe(false)
    await expect(decryptAegisBackup(backup, 'password')).resolves.toBe(database)
    expect(invoke).toHaveBeenCalledWith('decrypt_aegis_vault', {
      vault: JSON.stringify(backup),
      password: 'password',
    })
  })

  it('preserves backend decryption errors for actionable UI feedback', async () => {
    invoke.mockRejectedValue('importEncryptedWrongPassword')

    await expect(
      decryptAegisBackup({ version: 1, header: {}, db: 'ciphertext' }, 'wrong'),
    ).rejects.toThrowError('importEncryptedWrongPassword')
  })

  it('imports current Aegis groups by UUID', () => {
    const entries = parseImportedEntries(
      {
        db: {
          version: 3,
          groups: [{ uuid: 'personal-id', name: 'Personal' }],
          entries: [
            {
              type: 'totp',
              uuid: 'entry-id',
              name: 'alice@example.com',
              issuer: 'Example',
              groups: ['personal-id'],
              info: { secret: 'ABC234', algo: 'SHA1', digits: 6, period: 30 },
            },
          ],
        },
      },
      'aegis',
    )

    expect(entries[0]).toMatchObject({
      uuid: 'entry-id',
      name: 'alice@example.com',
      issuer: 'Example',
      group: 'Personal',
      secret: 'ABC234',
    })
  })

  it('requires a password before parsing encrypted Aegis data', () => {
    expect(() => parseImportedEntries({ db: 'ciphertext' }, 'aegis')).toThrowError(
      'importPasswordRequired',
    )
  })

  it('decrypts, parses, and saves an encrypted Aegis import', async () => {
    const backup = { version: 1, header: { slots: [] }, db: 'ciphertext' }
    const file = { text: vi.fn().mockResolvedValue(JSON.stringify(backup)) } as unknown as File
    invoke.mockResolvedValue({
      version: 3,
      entries: [
        {
          type: 'totp',
          uuid: 'entry-id',
          name: 'alice',
          issuer: 'Example',
          info: { secret: 'ABC234', algo: 'SHA1', digits: 6, period: 30 },
        },
      ],
      groups: [],
    })
    mockVault.getVault.mockResolvedValue([])
    mockVault.save.mockResolvedValue(undefined)

    await importFile(file, 'aegis', 'password')

    expect(mockVault.save).toHaveBeenCalledWith(
      JSON.stringify([
        {
          uuid: 'entry-id',
          name: 'alice',
          issuer: 'Example',
          secret: 'ABC234',
        },
      ]),
    )
  })
})

describe('TOTP refresh timing', () => {
  beforeEach(() => invoke.mockReset())

  it('uses the backend expiry to schedule the next refresh', () => {
    expect(getTOTPRefreshDelay(28_000, 20_000)).toBe(8_000)
    expect(getTOTPRefreshDelay(28_000, 27_999)).toBe(1)
    expect(getTOTPRefreshDelay(28_000, 28_001)).toBe(1)
  })

  it('preserves codes and their shared expiry from the backend', async () => {
    invoke.mockResolvedValue({ codes: ['123456', null], expiresAtMs: 28_000 })

    await expect(generateTOTPs(['valid', 'invalid'])).resolves.toEqual({
      codes: ['123456', null],
      expiresAtMs: 28_000,
    })
  })

  it('retries quickly after a backend failure', async () => {
    const before = Date.now()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    invoke.mockRejectedValueOnce(new Error('backend unavailable'))

    const result = await generateTOTPs(['secret'])
    consoleError.mockRestore()

    expect(result.codes).toEqual([null])
    expect(result.expiresAtMs).toBeGreaterThanOrEqual(before + 1000)
    expect(result.expiresAtMs).toBeLessThanOrEqual(Date.now() + 1000)
  })
})

describe('otpauth URI parsing', () => {
  it('parses the account, issuer, secret, and default TOTP settings', () => {
    expect(
      parseOtpAuthUri(
        'otpauth://totp/Example%20Co:person%2Btest%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=Example%20Co',
      ),
    ).toMatchObject({
      name: 'person+test@example.com',
      issuer: 'Example Co',
      secret: 'JBSWY3DPEHPK3PXP',
    })
  })

  it('uses the label issuer when the query parameter is absent', () => {
    expect(parseOtpAuthUri('otpauth://totp/Example:alice?secret=ABC234')).toMatchObject({
      name: 'alice',
      issuer: 'Example',
    })
  })

  it.each([
    'otpauth://hotp/Example:alice?secret=ABC234&counter=1',
    'otpauth://totp/Example:alice?secret=ABC234&algorithm=SHA256',
    'otpauth://totp/Example:alice?secret=ABC234&digits=8',
    'otpauth://totp/Example:alice?secret=ABC234&period=60',
  ])('rejects unsupported OTP settings in %s', (uri) => {
    expect(() => parseOtpAuthUri(uri)).toThrowError('importUnsupportedOtp')
  })

  it.each(['not a URI', 'otpauth://totp/Example', 'otpauth://totp/?secret=ABC234'])(
    'rejects malformed OTP data in %s',
    (uri) => {
      expect(() => parseOtpAuthUri(uri)).toThrowError('importFailed')
    },
  )
})

describe('2FAS imports', () => {
  it('imports linked and manually entered services and preserves groups', () => {
    const entries = parseImportedEntries(
      {
        services: [
          {
            name: 'GitHub',
            secret: 'ABC234',
            groupId: 'work',
            otp: {
              link: 'otpauth://totp/GitHub:octocat?secret=ABC234&issuer=GitHub',
              tokenType: 'TOTP',
              source: 'Link',
            },
          },
          {
            name: 'Personal',
            secret: 'DEF567',
            otp: {
              account: 'alice@example.com',
              algorithm: 'SHA1',
              digits: 6,
              period: 30,
              tokenType: 'TOTP',
              source: 'Manual',
            },
          },
        ],
        groups: [{ id: 'work', name: 'Work' }],
        schemaVersion: 4,
      },
      '2fas',
    )

    expect(entries).toHaveLength(2)
    expect(entries[0]).toMatchObject({
      name: 'octocat',
      issuer: 'GitHub',
      group: 'Work',
      secret: 'ABC234',
    })
    expect(entries[1]).toMatchObject({
      name: 'alice@example.com',
      issuer: 'Personal',
      secret: 'DEF567',
    })
  })

  it('rejects password-protected backups with an actionable error', () => {
    expect(() =>
      parseImportedEntries({ servicesEncrypted: 'ciphertext:salt:iv' }, '2fas'),
    ).toThrowError('import2FasEncrypted')
  })

  it('rejects the whole backup when an entry would generate the wrong code', () => {
    expect(() =>
      parseImportedEntries(
        {
          services: [
            {
              name: 'Supported',
              secret: 'ABC234',
              otp: { tokenType: 'TOTP', algorithm: 'SHA1', digits: 6, period: 30 },
            },
            {
              name: 'Unsupported',
              secret: 'DEF567',
              otp: { tokenType: 'HOTP', algorithm: 'SHA1', digits: 6, period: 30 },
            },
          ],
        },
        '2fas',
      ),
    ).toThrowError('importUnsupportedOtp')
  })

  it('rejects inconsistent linked and stored secrets', () => {
    expect(() =>
      parseImportedEntries(
        {
          services: [
            {
              name: 'Example',
              secret: 'ABC234',
              otp: {
                link: 'otpauth://totp/Example:alice?secret=DEF567&issuer=Example',
                tokenType: 'TOTP',
              },
            },
          ],
        },
        '2fas',
      ),
    ).toThrowError('importFailed')
  })

  it.each([{}, { services: [] }, { services: [{ name: 'Missing secret', otp: {} }] }])(
    'rejects malformed backups',
    (backup) => {
      expect(() => parseImportedEntries(backup, '2fas')).toThrowError('importFailed')
    },
  )
})
