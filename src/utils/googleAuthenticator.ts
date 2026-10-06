import jsQR from 'jsqr'

export type GoogleAccount = { name: string; issuer?: string; secret: string }
export type GoogleTransferPart = {
  batchId: number
  batchSize: number
  batchIndex: number
  data: string
  accounts: GoogleAccount[]
}
export type GoogleTransfer = {
  batchId: number
  batchSize: number
  parts: Map<number, GoogleTransferPart>
}

const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const MAX_IMAGE_EDGE = 4096
const MAX_URI_LENGTH = 64 * 1024
const MAX_BATCH_SIZE = 100
const MAX_ACCOUNTS = 500
const MAX_FIELD_BYTES = 4096
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
const decoder = new TextDecoder('utf-8', { fatal: true })

const invalid = (): never => {
  throw Error('importGoogleInvalidQr')
}

// The Google transfer payload is a small, fixed protobuf schema. Read only the
// fields we need and bound every length before decoding or allocating strings.
class WireReader {
  offset = 0

  constructor(readonly bytes: Uint8Array) {}

  get done() {
    return this.offset === this.bytes.length
  }

  varint(): bigint {
    let value = 0n
    for (let i = 0; i < 10; i++) {
      if (this.done) invalid()
      const byte = this.bytes[this.offset++]
      if (i === 9 && byte > 1) invalid()
      value |= BigInt(byte & 0x7f) << BigInt(i * 7)
      if ((byte & 0x80) === 0) return value
    }
    return invalid()
  }

  tag(): [number, number] {
    const tag = this.varint()
    const field = tag >> 3n
    if (field === 0n || field > 0x1fffffffn) invalid()
    return [Number(field), Number(tag & 7n)]
  }

  bytesField(): Uint8Array {
    const length = this.varint()
    if (length > BigInt(this.bytes.length - this.offset)) invalid()
    const end = this.offset + Number(length)
    const value = this.bytes.subarray(this.offset, end)
    this.offset = end
    return value
  }

  skip(wire: number) {
    if (wire === 0) {
      this.varint()
      return
    }
    if (wire === 2) {
      this.bytesField()
      return
    }
    const length = wire === 1 ? 8 : wire === 5 ? 4 : 0
    if (!length || this.offset + length > this.bytes.length) invalid()
    this.offset += length
  }
}

const textField = (bytes: Uint8Array) => {
  if (bytes.length > MAX_FIELD_BYTES) invalid()
  try {
    return decoder.decode(bytes).trim()
  } catch {
    return invalid()
  }
}

const base32 = (bytes: Uint8Array) => {
  let bits = 0
  let value = 0
  let result = ''
  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      result += BASE32[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
    value &= (1 << bits) - 1
  }
  if (bits) result += BASE32[(value << (5 - bits)) & 31]
  return result
}

const parseAccount = (bytes: Uint8Array): GoogleAccount => {
  const reader = new WireReader(bytes)
  let secret: Uint8Array | undefined
  let name: string | undefined
  let issuer: string | undefined
  let algorithm = 0
  let digits = 0
  let type = 0
  const seen = new Set<number>()

  while (!reader.done) {
    const [field, wire] = reader.tag()
    if (field >= 1 && field <= 6) {
      if (seen.has(field) || wire !== (field <= 3 ? 2 : 0)) invalid()
      seen.add(field)
      const value = field <= 3 ? reader.bytesField() : reader.varint()
      if (field === 1) secret = value as Uint8Array
      if (field === 2) name = textField(value as Uint8Array)
      if (field === 3) issuer = textField(value as Uint8Array)
      if (field === 4) algorithm = Number(value)
      if (field === 5) digits = Number(value)
      if (field === 6) type = Number(value)
    } else {
      reader.skip(wire)
    }
  }

  // Google's unspecified algorithm/digit values mean the usual SHA-1/6.
  if (type !== 2 || ![0, 1].includes(algorithm) || ![0, 1].includes(digits)) {
    throw Error('importUnsupportedOtp')
  }
  if (!secret?.length || secret.length > MAX_FIELD_BYTES || !name) {
    throw Error('importGoogleInvalidQr')
  }
  const separator = name.indexOf(':')
  if (separator > 0) {
    const labelIssuer = name.slice(0, separator).trim()
    if (!issuer) issuer = labelIssuer
    if (issuer === labelIssuer) name = name.slice(separator + 1).trim() || name
  }
  return { name, issuer: issuer || undefined, secret: base32(secret) }
}

export const parseGoogleMigrationUri = (value: string): GoogleTransferPart => {
  if (value.length > MAX_URI_LENGTH) invalid()
  let uri: URL
  try {
    uri = new URL(value)
  } catch {
    return invalid()
  }
  if (
    uri.protocol !== 'otpauth-migration:' ||
    uri.hostname !== 'offline' ||
    uri.username ||
    uri.password ||
    uri.pathname ||
    uri.hash
  ) {
    invalid()
  }
  const values = uri.searchParams.getAll('data')
  if (values.length !== 1) invalid()
  const data = values[0].replace(/ /g, '+')
  if (!data || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) invalid()
  let bytes: Uint8Array
  try {
    bytes = Uint8Array.from(atob(data), (character) => character.charCodeAt(0))
  } catch {
    return invalid()
  }
  const reader = new WireReader(bytes)
  const accounts: GoogleAccount[] = []
  let version: number | undefined
  let batchSize: number | undefined
  let batchIndex = 0
  let batchId = 0
  const seen = new Set<number>()

  while (!reader.done) {
    const [field, wire] = reader.tag()
    if (field === 1) {
      if (wire !== 2) invalid()
      if (accounts.length >= MAX_ACCOUNTS) throw Error('importGoogleTooMany')
      accounts.push(parseAccount(reader.bytesField()))
    } else if (field >= 2 && field <= 5) {
      if (wire !== 0 || seen.has(field)) invalid()
      seen.add(field)
      const number = reader.varint()
      if (field === 2) version = Number(number)
      if (field === 3) batchSize = Number(number)
      if (field === 4) batchIndex = Number(number)
      if (field === 5) batchId = Number(BigInt.asIntN(32, number))
    } else {
      reader.skip(wire)
    }
  }

  if (
    version !== 1 ||
    !accounts.length ||
    !batchSize ||
    batchSize > MAX_BATCH_SIZE ||
    batchIndex < 0 ||
    batchIndex >= batchSize
  ) {
    throw Error('importGoogleInvalidQr')
  }
  return { batchId, batchSize, batchIndex, data, accounts }
}

export const addGoogleTransferPart = (
  transfer: GoogleTransfer | undefined,
  part: GoogleTransferPart,
): GoogleTransfer => {
  if (transfer && (transfer.batchId !== part.batchId || transfer.batchSize !== part.batchSize)) {
    throw Error('importGoogleDifferentTransfer')
  }
  const parts = new Map(transfer?.parts)
  const existing = parts.get(part.batchIndex)
  if (existing && existing.data !== part.data) throw Error('importGoogleDifferentTransfer')
  parts.set(part.batchIndex, part)
  if ([...parts.values()].reduce((count, item) => count + item.accounts.length, 0) > MAX_ACCOUNTS) {
    throw Error('importGoogleTooMany')
  }
  return { batchId: part.batchId, batchSize: part.batchSize, parts }
}

export const completeGoogleTransfer = (transfer: GoogleTransfer): GoogleAccount[] | undefined => {
  if (transfer.parts.size !== transfer.batchSize) return undefined
  return Array.from({ length: transfer.batchSize }, (_, index) =>
    transfer.parts.get(index),
  ).flatMap((part) => part?.accounts ?? invalid())
}

export const scanGoogleQrImage = async (image: Blob): Promise<GoogleTransferPart> => {
  if (image.size > MAX_IMAGE_BYTES) throw Error('importGoogleTooLarge')
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(image.type)) {
    throw Error('importGoogleInvalidImage')
  }
  const source = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(Error('importGoogleInvalidImage'))
    reader.readAsDataURL(image)
  })
  const bitmap = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image()
    element.onload = () => resolve(element)
    element.onerror = () => reject(Error('importGoogleInvalidImage'))
    element.src = source
  })
  if (
    !bitmap.naturalWidth ||
    !bitmap.naturalHeight ||
    bitmap.naturalWidth > MAX_IMAGE_EDGE ||
    bitmap.naturalHeight > MAX_IMAGE_EDGE
  ) {
    throw Error('importGoogleTooLarge')
  }
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.naturalWidth
  canvas.height = bitmap.naturalHeight
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw Error('importGoogleInvalidImage')
  context.drawImage(bitmap, 0, 0)
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height)
  const code = jsQR(pixels.data, pixels.width, pixels.height, { inversionAttempts: 'attemptBoth' })
  if (!code) throw Error('importGoogleInvalidQr')
  return parseGoogleMigrationUri(code.data)
}
