import { describe, expect, it } from 'vitest'

import {
  addGoogleTransferPart,
  completeGoogleTransfer,
  parseGoogleMigrationUri,
  scanGoogleQrImage,
} from '~/utils/googleAuthenticator'

const varint = (value: number) => {
  const result: number[] = []
  while (value >= 128) {
    result.push((value & 127) | 128)
    value = Math.floor(value / 128)
  }
  result.push(value)
  return result
}

const numberField = (field: number, value: number) => [field << 3, ...varint(value)]
const bytesField = (field: number, value: number[]) => [
  (field << 3) | 2,
  ...varint(value.length),
  ...value,
]
const stringField = (field: number, value: string) =>
  bytesField(field, Array.from(new TextEncoder().encode(value)))

const account = (overrides: { type?: number; algorithm?: number; digits?: number } = {}) => [
  ...bytesField(1, [72, 101, 108, 108, 111]),
  ...stringField(2, 'Dropbox:alice'),
  ...numberField(4, overrides.algorithm ?? 1),
  ...numberField(5, overrides.digits ?? 1),
  ...numberField(6, overrides.type ?? 2),
  ...stringField(8, 'unknown-field-is-ignored'),
]

const uri = (
  entries: number[][] = [account()],
  options: {
    size?: number
    index?: number
    id?: number
    version?: number
    omitIndex?: boolean
    omitId?: boolean
  } = {},
) => {
  const bytes = [
    ...entries.flatMap((entry) => bytesField(1, entry)),
    ...numberField(2, options.version ?? 1),
    ...numberField(3, options.size ?? 1),
    ...(options.omitIndex ? [] : numberField(4, options.index ?? 0)),
    ...(options.omitId ? [] : numberField(5, options.id ?? 123)),
  ]
  return `otpauth-migration://offline?data=${encodeURIComponent(
    btoa(String.fromCharCode(...bytes)),
  )}`
}

describe('Google Authenticator transfer decoding', () => {
  it('decodes standard TOTP secrets and issuer-prefixed names', () => {
    const part = parseGoogleMigrationUri(uri())
    expect(part).toMatchObject({ batchId: 123, batchSize: 1, batchIndex: 0 })
    expect(part.accounts).toEqual([{ name: 'alice', issuer: 'Dropbox', secret: 'JBSWY3DP' }])
    expect(completeGoogleTransfer(addGoogleTransferPart(undefined, part))).toEqual(part.accounts)
  })

  it('accepts unspecified SHA-1/6-digit defaults', () => {
    expect(
      parseGoogleMigrationUri(uri([account({ algorithm: 0, digits: 0 })])).accounts,
    ).toHaveLength(1)
  })

  it('accepts omitted zero-valued batch fields', () => {
    expect(
      parseGoogleMigrationUri(uri([account()], { omitIndex: true, omitId: true })),
    ).toMatchObject({ batchIndex: 0, batchId: 0 })
  })

  it.each([{ type: 1 }, { type: 0 }, { algorithm: 2 }, { algorithm: 3 }, { digits: 2 }])(
    'rejects unsupported OTP settings without changing them: %j',
    (settings) => {
      expect(() => parseGoogleMigrationUri(uri([account(settings)]))).toThrow(
        'importUnsupportedOtp',
      )
    },
  )

  it('collects multiple QR codes out of order and ignores an identical rescan', () => {
    const first = parseGoogleMigrationUri(uri([account()], { size: 2, index: 0 }))
    const second = parseGoogleMigrationUri(
      uri([[...account(), ...stringField(3, 'Dropbox')]], { size: 2, index: 1 }),
    )
    const partial = addGoogleTransferPart(undefined, second)
    expect(completeGoogleTransfer(partial)).toBeUndefined()
    expect(addGoogleTransferPart(partial, second).parts.size).toBe(1)
    expect(completeGoogleTransfer(addGoogleTransferPart(partial, first))).toHaveLength(2)
  })

  it('refuses different exports and conflicting repeats of one batch index', () => {
    const first = parseGoogleMigrationUri(uri([account()], { size: 2, index: 0 }))
    const transfer = addGoogleTransferPart(undefined, first)
    expect(() =>
      addGoogleTransferPart(
        transfer,
        parseGoogleMigrationUri(uri([account()], { size: 2, index: 1, id: 456 })),
      ),
    ).toThrow('importGoogleDifferentTransfer')
    expect(() =>
      addGoogleTransferPart(
        transfer,
        parseGoogleMigrationUri(uri([account(), account()], { size: 2, index: 0 })),
      ),
    ).toThrow('importGoogleDifferentTransfer')
    expect(transfer.parts.size).toBe(1)
  })

  it.each([
    'not a URI',
    'otpauth://totp/Example?secret=JBSWY3DP',
    'otpauth-migration://offline?data=!',
    'otpauth-migration://user@offline?data=QQ%3D%3D',
    'otpauth-migration://offline?data=AA%3D%3D',
    uri([], { version: 2 }),
    uri([account()], { size: 2, index: 2 }),
  ])('rejects malformed or unsupported transfer payloads', (value) => {
    expect(() => parseGoogleMigrationUri(value)).toThrow('importGoogleInvalidQr')
  })

  it('bounds images before decoding them', async () => {
    await expect(
      scanGoogleQrImage({ size: 10 * 1024 * 1024 + 1, type: 'image/png' } as Blob),
    ).rejects.toThrow('importGoogleTooLarge')
    await expect(scanGoogleQrImage({ size: 100, type: 'text/plain' } as Blob)).rejects.toThrow(
      'importGoogleInvalidImage',
    )
  })
})
