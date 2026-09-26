import { beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.hoisted(() => vi.fn())
const mockVault = vi.hoisted(() => ({ getVault: vi.fn(), save: vi.fn() }))
const saveFile = vi.hoisted(() => vi.fn())
const writeTextFile = vi.hoisted(() => vi.fn())

vi.mock('@tauri-apps/api/core', () => ({ invoke }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: saveFile }))
vi.mock('@tauri-apps/plugin-fs', () => ({ writeTextFile }))
vi.mock('~/utils/storage', () => ({ vault: mockVault }))

import {
  decryptAegisBackup,
  decryptTauthyBackup,
  commitPreparedImport,
  exportCodes,
  generateTOTPs,
  getTOTPRefreshDelay,
  importFile,
  isEncryptedAegisBackup,
  isEncryptedEnteExport,
  isEncryptedImport,
  isEncryptedTauthyBackup,
  isEncryptedTwoFasBackup,
  parseImportedEntries,
  parseOtpAuthUri,
  parseOtpAuthUriList,
  prepareImport,
} from '~/utils/codes'

describe('andOTP plaintext imports', () => {
  const entry = {
    secret: 'JBSWY3DPEHPK3PXP',
    issuer: 'Dropbox',
    label: 'Dropbox',
    type: 'TOTP',
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
  }
  const file = (backup: unknown, size = 100) =>
    ({
      name: 'andotp.json',
      size,
      text: vi.fn().mockResolvedValue(JSON.stringify(backup)),
    }) as unknown as File

  beforeEach(() => {
    invoke.mockReset().mockResolvedValue({ codes: ['123456'] })
    mockVault.getVault.mockReset().mockResolvedValue([])
    mockVault.save.mockReset()
  })

  it('preserves separate issuer/label fields and normalizes secrets', () => {
    expect(
      parseImportedEntries(
        [{ ...entry, secret: ' jbswy3dpehpk3pxp= ', label: 'Work - Dropbox' }],
        'andotp',
      )[0],
    ).toMatchObject({ name: 'Work - Dropbox', issuer: 'Dropbox', secret: entry.secret })
  })

  it('supports legacy labels and omitted standard OTP settings', () => {
    expect(
      parseImportedEntries(
        [{ label: 'Dropbox - Work - Personal', secret: entry.secret }],
        'andotp',
      )[0],
    ).toMatchObject({ name: 'Work - Personal', issuer: 'Dropbox' })
    expect(
      parseImportedEntries([{ label: 'Dropbox', secret: entry.secret }], 'andotp')[0],
    ).toMatchObject({ name: 'Dropbox', issuer: undefined })
    expect(parseImportedEntries([{ ...entry, issuer: '' }], 'andotp')[0].issuer).toBeUndefined()
  })

  it.each([
    { type: 'HOTP' },
    { type: 'STEAM' },
    { type: null },
    { algorithm: 'SHA256' },
    { digits: 8 },
    { period: 60 },
    { period: null },
  ])('rejects explicit unsupported settings: %j', (settings) => {
    expect(() => parseImportedEntries([{ ...entry, ...settings }], 'andotp')).toThrow(
      'importUnsupportedOtp',
    )
  })

  it.each([
    {},
    [],
    [null],
    [{ ...entry, secret: 'invalid!' }],
    [{ ...entry, label: '' }],
    [{ ...entry, issuer: 123 }],
  ])('rejects malformed or empty exports: %j', (backup) => {
    expect(() => parseImportedEntries(backup, 'andotp')).toThrow('importFailed')
  })

  it('reviews without writing, imports on confirmation and skips reimports', async () => {
    const preview = await prepareImport(file([entry]), 'andotp')
    expect(preview.newCount).toBe(1)
    expect(mockVault.save).not.toHaveBeenCalled()
    expect(await commitPreparedImport(preview)).toBe(1)
    expect(mockVault.save).toHaveBeenCalledTimes(1)
    mockVault.getVault.mockResolvedValue(preview.entries)
    expect((await prepareImport(file([entry]), 'andotp')).duplicateCount).toBe(1)
    expect(await commitPreparedImport(preview)).toBe(0)
    expect(mockVault.save).toHaveBeenCalledTimes(1)
  })

  it('bounds files before reading and limits entry counts', async () => {
    const oversized = file([entry], 16 * 1024 * 1024 + 1)
    await expect(prepareImport(oversized, 'andotp')).rejects.toThrow('importEncryptedUnsupported')
    expect(oversized.text).not.toHaveBeenCalled()
    expect(() => parseImportedEntries(Array(501).fill(entry), 'andotp')).toThrow(
      'importOtpAuthTooMany',
    )
  })

  it('validates secrets with the backend before touching the vault', async () => {
    invoke.mockResolvedValue({ codes: [null] })
    await expect(prepareImport(file([entry]), 'andotp')).rejects.toThrow('importFailed')
    expect(mockVault.getVault).not.toHaveBeenCalled()
    expect(mockVault.save).not.toHaveBeenCalled()
  })
})

describe('Bitwarden and Proton imports', () => {
  const uri = 'otpauth://totp/Dropbox:Demo?secret=JBSWY3DPEHPK3PXP&issuer=Dropbox'
  const bitwarden = { encrypted: false, items: [{ name: 'Dropbox', login: { totp: uri } }] }
  const proton = { version: 1, entries: [{ content: { name: 'Dropbox', uri } }] }
  const file = (backup: unknown, size = 100) =>
    ({
      name: 'export.json',
      size,
      text: vi.fn().mockResolvedValue(JSON.stringify(backup)),
    }) as unknown as File

  beforeEach(() => {
    invoke.mockReset()
    mockVault.getVault.mockReset().mockResolvedValue([])
    mockVault.save.mockReset()
    invoke.mockImplementation(async (command, args) => {
      if (command === 'generate_totps') return { codes: args.arguments.map(() => '123456') }
      if (command === 'decrypt_proton_export') return proton
      throw Error('unexpected command')
    })
  })

  it('extracts URI and raw-secret TOTPs without importing other Password Manager data', () => {
    const entries = parseImportedEntries(
      {
        encrypted: false,
        items: [
          ...bitwarden.items,
          {
            name: 'GitHub',
            login: { totp: ' jbswy3dpehpk3pxp= ', password: 'not imported', username: 'demo' },
          },
          { name: 'No TOTP', login: { password: 'not imported', totp: null } },
          { name: 'Secure note', notes: 'not imported' },
        ],
      },
      'bitwarden',
    )
    expect(entries).toHaveLength(2)
    expect(entries[0]).toMatchObject({ name: 'Dropbox', issuer: 'Dropbox' })
    expect(entries[1]).toMatchObject({ name: 'GitHub', secret: 'JBSWY3DPEHPK3PXP' })
    expect(JSON.stringify(entries)).not.toContain('not imported')
  })

  it('preserves Proton custom names, falls back to URI labels and ignores notes', () => {
    expect(parseImportedEntries(proton, 'proton')[0]).toMatchObject({
      name: 'Dropbox',
      issuer: 'Dropbox',
    })
    expect(
      parseImportedEntries(
        { version: 1, entries: [{ content: { uri }, note: 'private' }] },
        'proton',
      )[0],
    ).toMatchObject({ name: 'Demo' })
  })

  it.each(['bitwarden', 'proton'] as const)(
    'prepares %s imports without writing and skips identical reimports',
    async (format) => {
      const backup = format === 'bitwarden' ? bitwarden : proton
      const preview = await prepareImport(file(backup), format)
      expect(preview.newCount).toBe(1)
      expect(mockVault.save).not.toHaveBeenCalled()
      mockVault.getVault.mockResolvedValue(preview.entries)
      expect((await prepareImport(file(backup), format)).duplicateCount).toBe(1)
      expect(await commitPreparedImport(preview)).toBe(0)
      expect(mockVault.save).not.toHaveBeenCalled()
    },
  )

  it('prompts for Proton passwords and preserves backend authentication failures', async () => {
    const encrypted = { version: 1, salt: 'salt', content: 'ciphertext' }
    expect(isEncryptedImport(encrypted, 'proton')).toBe(true)
    await expect(prepareImport(file(encrypted), 'proton')).rejects.toThrow('importPasswordRequired')
    await expect(prepareImport(file(encrypted), 'proton', 'test')).resolves.toMatchObject({
      newCount: 1,
    })
    expect(invoke).toHaveBeenCalledWith('decrypt_proton_export', {
      export: JSON.stringify(encrypted),
      password: 'test',
    })
    invoke.mockRejectedValue('importEncryptedAuthenticationFailed')
    await expect(prepareImport(file(encrypted), 'proton', 'wrong')).rejects.toThrow(
      'importEncryptedAuthenticationFailed',
    )
  })

  it('rejects encrypted Bitwarden, future Proton versions and malformed entries', () => {
    expect(() => parseImportedEntries({ ...bitwarden, encrypted: true }, 'bitwarden')).toThrow(
      'importEncryptedUnsupported',
    )
    expect(() => parseImportedEntries({ ...proton, version: 2 }, 'proton')).toThrow(
      'importEncryptedUnsupported',
    )
    for (const totp of [123, 'not a secret!', 'steam://ABCDE']) {
      expect(() =>
        parseImportedEntries(
          { encrypted: false, items: [{ name: 'Dropbox', login: { totp } }] },
          'bitwarden',
        ),
      ).toThrow()
    }
    expect(() => parseImportedEntries({ version: 1, entries: [null] }, 'proton')).toThrow(
      'importFailed',
    )
    expect(() =>
      parseImportedEntries({ version: 1, entries: [{ content: { uri, name: 123 } }] }, 'proton'),
    ).toThrow('importFailed')
  })

  it.each(['bitwarden', 'proton'] as const)('rejects unsupported OTP settings in %s', (format) => {
    const unsupportedUri = `${uri}&algorithm=SHA256`
    const backup =
      format === 'bitwarden'
        ? { encrypted: false, items: [{ name: 'Dropbox', login: { totp: unsupportedUri } }] }
        : { version: 1, entries: [{ content: { uri: unsupportedUri } }] }
    expect(() => parseImportedEntries(backup, format)).toThrow('importUnsupportedOtp')
  })

  it.each(['bitwarden', 'proton'] as const)(
    'bounds %s files before reading and limits entry count',
    async (format) => {
      const oversized = file({}, 16 * 1024 * 1024 + 1)
      await expect(prepareImport(oversized, format)).rejects.toThrow('importEncryptedUnsupported')
      expect(oversized.text).not.toHaveBeenCalled()
      const backup =
        format === 'bitwarden'
          ? { encrypted: false, items: Array(501).fill(bitwarden.items[0]) }
          : { version: 1, entries: Array(501).fill(proton.entries[0]) }
      expect(() => parseImportedEntries(backup, format)).toThrow('importOtpAuthTooMany')
    },
  )

  it('rejects secrets that cannot generate a code before accessing the vault', async () => {
    invoke.mockResolvedValue({ codes: [null] })
    await expect(prepareImport(file(proton), 'proton')).rejects.toThrow('importFailed')
    expect(mockVault.getVault).not.toHaveBeenCalled()
  })
})

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

describe('Tauthy import and export', () => {
  beforeEach(() => {
    invoke.mockReset()
    mockVault.getVault.mockReset()
    mockVault.save.mockReset()
    saveFile.mockReset()
    writeTextFile.mockReset()
    vi.useRealTimers()
  })

  it('exports the versioned v1 format with an unambiguous filename', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-20T12:30:00.000Z'))
    mockVault.getVault.mockResolvedValue([
      {
        uuid: 'entry-id',
        name: 'alice@example.com',
        issuer: 'Example',
        secret: 'ABC234',
      },
    ])
    saveFile.mockResolvedValue('/tmp/tauthy.json')
    writeTextFile.mockResolvedValue(undefined)

    await expect(exportCodes()).resolves.toBe('exportSuccess')

    expect(saveFile).toHaveBeenCalledWith({
      defaultPath: 'tauthy-export-2026-09-20T12-30-00Z.json',
      filters: [{ name: 'JSON', extensions: ['json'] }],
    })
    const exported = JSON.parse(writeTextFile.mock.calls[0][1])
    expect(exported).toMatchObject({
      format: 'tauthy-backup',
      version: 1,
      exportedAt: '2026-09-20T12:30:00.000Z',
      entries: [
        {
          id: 'entry-id',
          name: 'alice@example.com',
          issuer: 'Example',
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

  it('exports the v1 document inside an encrypted envelope', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-20T12:30:00.000Z'))
    mockVault.getVault.mockResolvedValue([
      { uuid: 'entry-id', name: 'alice@example.com', secret: 'ABC234' },
    ])
    saveFile.mockResolvedValue('/tmp/tauthy.tauthy')
    const envelope = {
      format: 'tauthy-backup-encrypted',
      version: 1,
      ciphertext: 'encrypted',
    }
    invoke.mockResolvedValue(envelope)

    await expect(exportCodes('backup password')).resolves.toBe('exportSuccess')

    expect(saveFile).toHaveBeenCalledWith({
      defaultPath: 'tauthy-export-2026-09-20T12-30-00Z.tauthy',
      filters: [{ name: 'Tauthy encrypted backup', extensions: ['tauthy'] }],
    })
    expect(invoke).toHaveBeenCalledWith('encrypt_tauthy_backup', {
      backup: expect.objectContaining({ format: 'tauthy-backup', version: 1 }),
      password: 'backup password',
    })
    expect(JSON.parse(writeTextFile.mock.calls[0][1])).toEqual(envelope)
  })

  it('imports v1 without duplicating an identical existing entry', async () => {
    const entry = {
      uuid: 'entry-id',
      name: 'alice@example.com',
      issuer: 'Example',
      secret: 'ABC234',
    }
    const backup = {
      format: 'tauthy-backup',
      version: 1,
      exportedAt: '2026-09-20T12:30:00.000Z',
      entries: [
        {
          id: entry.uuid,
          name: entry.name,
          issuer: entry.issuer,
          otp: { type: 'totp', secret: entry.secret, algorithm: 'SHA1', digits: 6, period: 30 },
        },
      ],
    }
    const file = { text: vi.fn().mockResolvedValue(JSON.stringify(backup)) } as unknown as File
    mockVault.getVault.mockResolvedValue([entry])
    mockVault.save.mockResolvedValue(undefined)

    await importFile(file, 'tauthy')

    expect(mockVault.save).not.toHaveBeenCalled()
  })

  it('detects, decrypts, and imports an encrypted Tauthy backup', async () => {
    const envelope = { format: 'tauthy-backup-encrypted', version: 1, ciphertext: 'encrypted' }
    const backup = {
      format: 'tauthy-backup',
      version: 1,
      exportedAt: '2026-09-20T12:30:00.000Z',
      entries: [
        {
          id: 'entry-id',
          name: 'alice@example.com',
          otp: { type: 'totp', secret: 'ABC234', algorithm: 'SHA1', digits: 6, period: 30 },
        },
      ],
    }
    const file = { text: vi.fn().mockResolvedValue(JSON.stringify(envelope)) } as unknown as File
    invoke.mockResolvedValue(backup)
    mockVault.getVault.mockResolvedValue([])

    expect(isEncryptedTauthyBackup(envelope)).toBe(true)
    expect(isEncryptedImport(envelope, 'tauthy')).toBe(true)
    await expect(decryptTauthyBackup(envelope, 'backup password')).resolves.toEqual(backup)
    await importFile(file, 'tauthy', 'backup password')

    expect(invoke).toHaveBeenCalledWith('decrypt_tauthy_backup', {
      backup: JSON.stringify(envelope),
      password: 'backup password',
    })
    expect(mockVault.save).toHaveBeenCalledWith(
      JSON.stringify([{ uuid: 'entry-id', name: 'alice@example.com', secret: 'ABC234' }]),
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

describe('otpauth URI-list imports', () => {
  const first = 'otpauth://totp/Example:alice?secret=JBSWY3DPEHPK3PXP&issuer=Example'
  const second = 'otpauth://totp/Other:bob?secret=MZXW6YTBOI&issuer=Other'
  const file = (text: string, size = text.length) =>
    ({ size, text: vi.fn().mockResolvedValue(text) }) as unknown as File

  beforeEach(() => {
    invoke.mockReset()
    invoke.mockImplementation(async (command: string, options: { arguments: string[] }) =>
      command === 'generate_totps'
        ? { codes: options.arguments.map(() => '123456'), expiresAtMs: 30_000 }
        : undefined,
    )
    mockVault.getVault.mockReset()
    mockVault.save.mockReset()
  })

  it('parses a UTF-8 list with blank lines and Windows line endings', () => {
    expect(parseOtpAuthUriList(`\uFEFF${first}\r\n\r\n${second}\r\n`)).toMatchObject([
      { issuer: 'Example', name: 'alice', secret: 'JBSWY3DPEHPK3PXP' },
      { issuer: 'Other', name: 'bob', secret: 'MZXW6YTBOI' },
    ])
  })

  it('rejects malformed, unsupported, or invalid-secret lines without a partial import', async () => {
    mockVault.getVault.mockResolvedValue([])
    for (const badLine of [
      'not a URI',
      'otpauth://hotp/Other:bob?secret=ABC234',
      'otpauth://totp/Other:bob?secret=BAD!&issuer=Other',
    ]) {
      await expect(prepareImport(file(`${first}\n${badLine}`), 'otpauth')).rejects.toThrow()
    }
    expect(mockVault.save).not.toHaveBeenCalled()
  })

  it('bounds file size and account count before committing', async () => {
    await expect(prepareImport(file(first, 1024 * 1024 + 1), 'otpauth')).rejects.toThrowError(
      'importOtpAuthTooLarge',
    )
    expect(() => parseOtpAuthUriList(Array(501).fill(first).join('\n'))).toThrowError(
      'importOtpAuthTooMany',
    )
    expect(mockVault.save).not.toHaveBeenCalled()
  })

  it('rejects secrets that the code generator cannot decode', async () => {
    invoke.mockResolvedValueOnce({ codes: [null], expiresAtMs: 30_000 })
    await expect(prepareImport(file(first), 'otpauth')).rejects.toThrowError('importFailed')
    expect(mockVault.save).not.toHaveBeenCalled()
  })

  it('previews duplicates without saving, then merges only new accounts on confirmation', async () => {
    const existing = {
      uuid: 'existing',
      name: 'alice',
      issuer: 'Example',
      secret: 'JBSWY3DPEHPK3PXP',
    }
    mockVault.getVault.mockResolvedValueOnce([existing]).mockResolvedValueOnce([existing])
    const preview = await prepareImport(file(`${first}\n${second}\n${second}`), 'otpauth')

    expect(preview.entries).toHaveLength(3)
    expect(preview.newCount).toBe(1)
    expect(preview.duplicateCount).toBe(2)
    expect(mockVault.save).not.toHaveBeenCalled()

    expect(await commitPreparedImport(preview)).toBe(1)
    expect(JSON.parse(mockVault.save.mock.calls[0][0])).toMatchObject([
      existing,
      { name: 'bob', issuer: 'Other', secret: 'MZXW6YTBOI' },
    ])
  })

  it('rechecks the current vault on confirmation and skips saving when all accounts exist', async () => {
    const entry = parseOtpAuthUri(first)
    mockVault.getVault.mockResolvedValue([entry])
    expect(
      await commitPreparedImport({
        format: 'otpauth',
        sourceName: 'accounts.txt',
        entries: [entry],
        newCount: 1,
        duplicateCount: 0,
        duplicateIndices: [],
      }),
    ).toBe(0)
    expect(mockVault.save).not.toHaveBeenCalled()
  })
})

describe('shared import review', () => {
  const account = { uuid: 'entry-id', name: 'alice', issuer: 'Example', secret: 'JBSWY3DPEHPK3PXP' }
  const file = (contents: unknown) =>
    ({
      name: 'backup.json',
      text: vi.fn().mockResolvedValue(JSON.stringify(contents)),
    }) as unknown as File
  const backupCases = [
    [
      '2fas',
      { services: [{ name: 'Example', secret: account.secret, otp: { account: account.name } }] },
    ],
    [
      'aegis',
      {
        db: {
          entries: [
            {
              uuid: account.uuid,
              type: 'totp',
              name: account.name,
              issuer: account.issuer,
              info: { secret: account.secret, algo: 'SHA1', digits: 6, period: 30 },
            },
          ],
        },
      },
    ],
    ['authy', [{ name: account.name, secret: account.secret }]],
    [
      'tauthy',
      {
        format: 'tauthy-backup',
        version: 1,
        exportedAt: '2026-09-20T12:30:00.000Z',
        entries: [
          {
            id: account.uuid,
            name: account.name,
            issuer: account.issuer,
            otp: { type: 'totp', secret: account.secret, algorithm: 'SHA1', digits: 6, period: 30 },
          },
        ],
      },
    ],
  ] as const

  beforeEach(() => {
    invoke.mockReset()
    mockVault.getVault.mockReset()
    mockVault.save.mockReset()
    mockVault.getVault.mockResolvedValue([])
  })

  it.each(backupCases)(
    'previews %s without writing, then commits on confirmation',
    async (format, backup) => {
      const preview = await prepareImport(file(backup), format)

      expect(preview.format).toBe(format)
      expect(preview.newCount).toBe(1)
      expect(mockVault.save).not.toHaveBeenCalled()

      expect(await commitPreparedImport(preview)).toBe(1)
      expect(JSON.parse(mockVault.save.mock.calls[0][0])).toHaveLength(1)
    },
  )

  it('detects duplicates for legacy formats and rechecks the vault before committing', async () => {
    mockVault.getVault
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ ...account, issuer: undefined }])
    const preview = await prepareImport(
      file([{ name: account.name, secret: account.secret }]),
      'authy',
    )

    expect(preview.newCount).toBe(1)
    expect(await commitPreparedImport(preview)).toBe(0)
    expect(mockVault.save).not.toHaveBeenCalled()
  })

  it('rejects a different Aegis account with an existing ID before review', async () => {
    mockVault.getVault.mockResolvedValue([account])
    const backup = {
      db: {
        entries: [
          {
            uuid: account.uuid,
            type: 'totp',
            name: 'different',
            issuer: account.issuer,
            info: { secret: account.secret, algo: 'SHA1', digits: 6, period: 30 },
          },
        ],
      },
    }
    await expect(prepareImport(file(backup), 'aegis')).rejects.toThrowError('importIdConflict')
    expect(mockVault.save).not.toHaveBeenCalled()
  })

  it('decrypts a protected Tauthy backup before review without saving', async () => {
    const encrypted = { format: 'tauthy-backup-encrypted', version: 1 }
    invoke.mockResolvedValue(backupCases[3][1])
    await expect(prepareImport(file(encrypted), 'tauthy')).rejects.toThrowError(
      'importPasswordRequired',
    )
    const preview = await prepareImport(file(encrypted), 'tauthy', 'password')
    expect(preview.newCount).toBe(1)
    expect(mockVault.save).not.toHaveBeenCalled()
  })
})

describe('2FAS imports', () => {
  beforeEach(() => {
    invoke.mockReset()
    mockVault.getVault.mockReset()
    mockVault.save.mockReset()
  })

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

  it('recognizes password-protected backups and requests a password', () => {
    expect(isEncryptedTwoFasBackup({ servicesEncrypted: 'ciphertext:salt:iv' })).toBe(true)
    expect(isEncryptedImport({ services: [] }, '2fas')).toBe(false)
    expect(() =>
      parseImportedEntries({ servicesEncrypted: 'ciphertext:salt:iv' }, '2fas'),
    ).toThrowError('importPasswordRequired')
  })

  it('decrypts into the existing import review without saving first', async () => {
    const backup = { services: [], servicesEncrypted: 'ciphertext:salt:iv' }
    const file = {
      name: 'accounts.2fas',
      size: 100,
      text: vi.fn().mockResolvedValue(JSON.stringify(backup)),
    } as unknown as File
    invoke.mockResolvedValue({
      services: [
        {
          name: 'Dropbox',
          secret: 'JBSWY3DPEHPK3PXP',
          otp: { account: 'alice@example.com', issuer: 'Dropbox' },
        },
      ],
    })
    mockVault.getVault.mockResolvedValue([])

    await expect(prepareImport(file, '2fas')).rejects.toThrowError('importPasswordRequired')
    const preview = await prepareImport(file, '2fas', 'password')
    expect(invoke).toHaveBeenCalledWith('decrypt_twofas_backup', {
      backup: JSON.stringify(backup),
      password: 'password',
    })
    expect(preview.entries).toMatchObject([
      { name: 'alice@example.com', issuer: 'Dropbox', secret: 'JBSWY3DPEHPK3PXP' },
    ])
    expect(preview.newCount).toBe(1)
    expect(mockVault.save).not.toHaveBeenCalled()
  })

  it('preserves authentication errors for password retry and rejects oversized files', async () => {
    const backup = { servicesEncrypted: 'ciphertext:salt:iv' }
    const file = {
      name: 'accounts.2fas',
      size: 100,
      text: vi.fn().mockResolvedValue(JSON.stringify(backup)),
    } as unknown as File
    invoke.mockRejectedValue('importEncryptedAuthenticationFailed')
    await expect(prepareImport(file, '2fas', 'wrong')).rejects.toThrowError(
      'importEncryptedAuthenticationFailed',
    )
    vi.mocked(file.text).mockClear()
    const largeFile = { ...file, size: 90 * 1024 * 1024 + 1 } as File
    await expect(prepareImport(largeFile, '2fas', 'password')).rejects.toThrowError(
      'importEncryptedUnsupported',
    )
    expect(largeFile.text).not.toHaveBeenCalled()
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

describe('Ente Auth encrypted exports', () => {
  const backup = {
    version: 1,
    kdfParams: { memLimit: 8388608, opsLimit: 3, salt: 'salt' },
    encryptedData: 'ciphertext',
    encryptionNonce: 'header',
  }
  const file = (contents: unknown, size = 200) =>
    ({
      name: 'ente-export.json',
      size,
      text: vi.fn().mockResolvedValue(JSON.stringify(contents)),
    }) as unknown as File

  beforeEach(() => {
    invoke.mockReset()
    mockVault.getVault.mockReset()
    mockVault.save.mockReset()
  })

  it('requires a password and previews decrypted accounts without saving', async () => {
    expect(isEncryptedEnteExport(backup)).toBe(true)
    expect(isEncryptedImport(backup, 'ente')).toBe(true)
    invoke.mockImplementation(async (command: string) => {
      if (command === 'decrypt_ente_export') {
        return 'otpauth://totp/Example:alice?secret=JBSWY3DPEHPK3PXP&issuer=Example'
      }
      if (command === 'generate_totps') return { codes: ['123456'], expiresAtMs: 30_000 }
      throw Error('unexpected command')
    })
    mockVault.getVault.mockResolvedValue([])

    await expect(prepareImport(file(backup), 'ente')).rejects.toThrowError('importPasswordRequired')
    const preview = await prepareImport(file(backup), 'ente', 'password')
    expect(invoke).toHaveBeenCalledWith('decrypt_ente_export', {
      export: JSON.stringify(backup),
      password: 'password',
    })
    expect(preview.entries).toMatchObject([
      { name: 'alice', issuer: 'Example', secret: 'JBSWY3DPEHPK3PXP' },
    ])
    expect(preview.newCount).toBe(1)
    expect(mockVault.save).not.toHaveBeenCalled()
  })

  it('preserves authentication errors and rejects malformed or oversized exports', async () => {
    invoke.mockRejectedValue('importEncryptedAuthenticationFailed')
    await expect(prepareImport(file(backup), 'ente', 'wrong')).rejects.toThrowError(
      'importEncryptedAuthenticationFailed',
    )
    await expect(prepareImport(file({}), 'ente', 'password')).rejects.toThrowError(
      'importEncryptedUnsupported',
    )
    const oversized = file(backup, 4 * 1024 * 1024 + 1)
    await expect(prepareImport(oversized, 'ente', 'password')).rejects.toThrowError(
      'importEncryptedUnsupported',
    )
    expect(oversized.text).not.toHaveBeenCalled()
    expect(mockVault.save).not.toHaveBeenCalled()
  })
})
