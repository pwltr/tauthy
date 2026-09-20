import type { TauthyBackupEntryV1, TauthyBackupV1, VaultEntry } from '~/types'
import { generateUUID } from '~/utils/helpers'

export const TAUTHY_BACKUP_FORMAT = 'tauthy-backup'
export const TAUTHY_BACKUP_VERSION = 1
const MAX_ICON_BASE64_LENGTH = 512 * 1024

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isOptionalString = (value: unknown) => value === undefined || typeof value === 'string'

const optionalValue = (value: string | undefined) => (value ? value : undefined)

const isValidIcon = (value: unknown): value is NonNullable<TauthyBackupEntryV1['icon']> => {
  if (!isRecord(value) || value.mimeType !== 'image/svg+xml') return false
  if (
    typeof value.base64 !== 'string' ||
    value.base64.length === 0 ||
    value.base64.length > MAX_ICON_BASE64_LENGTH
  ) {
    return false
  }

  return /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.base64)
}

const isIsoUtcTimestamp = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    return false
  }

  try {
    return new Date(value).toISOString() === value
  } catch {
    return false
  }
}

const validateVaultEntry = (entry: unknown): entry is VaultEntry => {
  if (!isRecord(entry)) return false

  return (
    typeof entry.uuid === 'string' &&
    entry.uuid.length > 0 &&
    typeof entry.name === 'string' &&
    entry.name.length > 0 &&
    typeof entry.secret === 'string' &&
    entry.secret.length > 0 &&
    isOptionalString(entry.issuer) &&
    isOptionalString(entry.group) &&
    isOptionalString(entry.icon)
  )
}

const validateBackupEntry = (entry: unknown): entry is TauthyBackupEntryV1 => {
  if (!isRecord(entry) || !isRecord(entry.otp)) return false

  return (
    typeof entry.id === 'string' &&
    entry.id.length > 0 &&
    typeof entry.name === 'string' &&
    entry.name.length > 0 &&
    isOptionalString(entry.issuer) &&
    isOptionalString(entry.group) &&
    (entry.icon === undefined || isValidIcon(entry.icon)) &&
    entry.otp.type === 'totp' &&
    typeof entry.otp.secret === 'string' &&
    entry.otp.secret.length > 0 &&
    entry.otp.algorithm === 'SHA1' &&
    entry.otp.digits === 6 &&
    entry.otp.period === 30
  )
}

const assertUniqueIds = (entries: Array<{ uuid: string }>) => {
  const ids = new Set<string>()
  for (const entry of entries) {
    if (ids.has(entry.uuid)) throw Error('importTauthyDuplicateIds')
    ids.add(entry.uuid)
  }
}

const repairDuplicateIds = (entries: VaultEntry[]) => {
  const ids = new Set<string>()
  return entries.map((entry) => {
    let uuid = entry.uuid
    while (ids.has(uuid)) uuid = generateUUID()
    ids.add(uuid)
    return uuid === entry.uuid ? entry : { ...entry, uuid }
  })
}

const backupEntry = (entry: VaultEntry): TauthyBackupEntryV1 => ({
  id: entry.uuid,
  name: entry.name,
  ...(optionalValue(entry.issuer) && { issuer: entry.issuer }),
  ...(optionalValue(entry.group) && { group: entry.group }),
  ...(entry.icon ? { icon: { mimeType: 'image/svg+xml' as const, base64: entry.icon } } : {}),
  otp: {
    type: 'totp',
    secret: entry.secret,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
  },
})

export const createTauthyBackup = (
  entries: VaultEntry[],
  exportedAt = new Date(),
): TauthyBackupV1 => ({
  format: TAUTHY_BACKUP_FORMAT,
  version: TAUTHY_BACKUP_VERSION,
  exportedAt: exportedAt.toISOString(),
  entries: repairDuplicateIds(entries).map(backupEntry),
})

export const parseTauthyBackup = (value: unknown): VaultEntry[] => {
  if (Array.isArray(value)) {
    if (value.length === 0 || !value.every(validateVaultEntry)) throw Error('importFailed')
    const entries = value.map((entry) => ({
      uuid: entry.uuid,
      name: entry.name,
      secret: entry.secret,
      issuer: optionalValue(entry.issuer),
      group: optionalValue(entry.group),
      icon: optionalValue(entry.icon),
    }))
    return repairDuplicateIds(entries)
  }

  if (!isRecord(value) || value.format !== TAUTHY_BACKUP_FORMAT) throw Error('importFailed')
  if (
    typeof value.version === 'number' &&
    Number.isInteger(value.version) &&
    value.version > TAUTHY_BACKUP_VERSION
  ) {
    throw Error('importTauthyNewerVersion')
  }
  if (
    value.version !== TAUTHY_BACKUP_VERSION ||
    !isIsoUtcTimestamp(value.exportedAt) ||
    !Array.isArray(value.entries) ||
    value.entries.length === 0 ||
    !value.entries.every(validateBackupEntry)
  ) {
    throw Error('importFailed')
  }

  const entries = value.entries.map((entry) => ({
    uuid: entry.id,
    name: entry.name,
    secret: entry.otp.secret,
    issuer: optionalValue(entry.issuer),
    group: optionalValue(entry.group),
    icon: entry.icon?.base64,
  }))
  assertUniqueIds(entries)
  return entries
}

const entriesEqual = (left: VaultEntry, right: VaultEntry) =>
  left.uuid === right.uuid &&
  left.name === right.name &&
  left.secret === right.secret &&
  optionalValue(left.issuer) === optionalValue(right.issuer) &&
  optionalValue(left.group) === optionalValue(right.group) &&
  optionalValue(left.icon) === optionalValue(right.icon)

export const mergeTauthyImport = (current: VaultEntry[], imported: VaultEntry[]) => {
  const currentById = new Map(current.map((entry) => [entry.uuid, entry]))
  const additions = imported.filter((entry) => {
    const existing = currentById.get(entry.uuid)
    if (!existing) return true
    if (!entriesEqual(existing, entry)) throw Error('importTauthyIdConflict')
    return false
  })

  return [...current, ...additions]
}
