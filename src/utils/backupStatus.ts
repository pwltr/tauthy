import type { VaultEntry } from '~/types'

export const BACKUP_STATUS_EVENT = 'tauthy:backup-status'
export const VAULT_DATA_EVENT = 'tauthy:vault-data'
export const BACKUP_STATUS_KEY = 'backupStatusV1'
export const WEEK_MS = 7 * 24 * 60 * 60 * 1000

type Metadata = {
  firstSeenAt?: number
  exportedAt?: number
  fingerprint?: string
  encrypted?: boolean
  snoozedUntil?: number
  dismissedFingerprint?: string
}

// Only local export receipts and a content digest persist here, never account
// names, secrets, backup paths or passwords. Receipts do not prove file retention.
const read = (): Metadata => {
  try {
    const value = JSON.parse(localStorage.getItem(BACKUP_STATUS_KEY) ?? '{}')
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    const time = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0
    const digest = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v)
    return {
      firstSeenAt: time(value.firstSeenAt) ? value.firstSeenAt : undefined,
      exportedAt: time(value.exportedAt) ? value.exportedAt : undefined,
      fingerprint: digest(value.fingerprint) ? value.fingerprint : undefined,
      encrypted: typeof value.encrypted === 'boolean' ? value.encrypted : undefined,
      snoozedUntil: time(value.snoozedUntil) ? value.snoozedUntil : undefined,
      dismissedFingerprint: digest(value.dismissedFingerprint)
        ? value.dismissedFingerprint
        : undefined,
    }
  } catch {
    return {}
  }
}

const write = (value: Metadata) => {
  try {
    localStorage.setItem(BACKUP_STATUS_KEY, JSON.stringify(value))
    window.dispatchEvent(new Event(BACKUP_STATUS_EVENT))
  } catch {
    // Reminder preferences must never fail a vault edit or successful export.
  }
}

export const backupFingerprint = async (entries: VaultEntry[]) => {
  const canonical = entries
    .map(({ uuid, name, secret, issuer, group, icon }) => [
      uuid,
      name,
      secret,
      issuer ?? '',
      group ?? '',
      icon ?? '',
    ])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(canonical)),
  )
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export const recordBackupExport = async (
  entries: VaultEntry[],
  encrypted: boolean,
  now = Date.now(),
) => {
  write({
    firstSeenAt: read().firstSeenAt ?? now,
    exportedAt: now,
    fingerprint: await backupFingerprint(entries),
    encrypted,
  })
}

export const resetBackupStatus = () => {
  write({})
}

export const getBackupStatus = async (entries: VaultEntry[], now = Date.now()) => {
  const fingerprint = await backupFingerprint(entries)
  let metadata = read()
  if (entries.length > 0 && metadata.firstSeenAt === undefined) {
    metadata = { ...metadata, firstSeenAt: now }
    write(metadata)
  }
  const changed = metadata.fingerprint !== fingerprint
  return {
    exportedAt: metadata.exportedAt,
    encrypted: metadata.encrypted,
    state: metadata.exportedAt === undefined ? 'never' : changed ? 'changed' : 'current',
    reminder:
      entries.length > 0 &&
      changed &&
      now - (metadata.exportedAt ?? metadata.firstSeenAt ?? now) >= WEEK_MS &&
      now >= (metadata.snoozedUntil ?? 0) &&
      metadata.dismissedFingerprint !== fingerprint,
    dismiss: () => write({ ...read(), dismissedFingerprint: fingerprint }),
    snooze: () => write({ ...read(), snoozedUntil: now + WEEK_MS }),
  }
}

export type BackupStatus = Awaited<ReturnType<typeof getBackupStatus>>
