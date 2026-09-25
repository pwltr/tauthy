import { ChangeEvent } from 'react'
import { save } from '@tauri-apps/plugin-dialog'
import { invoke } from '@tauri-apps/api/core'
import { writeTextFile } from '@tauri-apps/plugin-fs'

import { vault } from '~/utils/storage'
import { createTauthyBackup, mergeTauthyImport, parseTauthyBackup } from '~/utils/tauthyBackup'
import { generateUUID } from '~/utils'
import type {
  FormData,
  VaultEntry,
  AegisDatabase,
  AuthyEntry,
  TwoFasBackup,
  TwoFasService,
} from '~/types'

export type ImportFormat = '2fas' | 'aegis' | 'authy' | 'google' | 'tauthy' | 'otpauth'

export type ImportPreview = {
  format: ImportFormat
  sourceName: string
  entries: VaultEntry[]
  newCount: number
  duplicateCount: number
  duplicateIndices: number[]
}

const MAX_OTP_AUTH_FILE_SIZE = 1024 * 1024
const MAX_OTP_AUTH_ENTRIES = 500

export type GeneratedTOTPs = {
  codes: Array<string | null>
  expiresAtMs: number
}

type EncryptedImportAdapter = {
  isEncrypted: (json: unknown) => boolean
  decrypt: (json: unknown, password: string) => Promise<unknown>
}

export const isEncryptedAegisBackup = (json: unknown) =>
  typeof (json as { db?: unknown })?.db === 'string'

export const decryptAegisBackup = async (json: unknown, password: string) => {
  if (!isEncryptedAegisBackup(json)) {
    throw Error('importFailed')
  }

  try {
    return await invoke<AegisDatabase>('decrypt_aegis_vault', {
      vault: JSON.stringify(json),
      password,
    })
  } catch (err) {
    if (typeof err === 'string') throw Error(err)
    throw Error('importFailed')
  }
}

export const isEncryptedTauthyBackup = (json: unknown) =>
  (json as { format?: unknown })?.format === 'tauthy-backup-encrypted'

export const decryptTauthyBackup = async (json: unknown, password: string) => {
  if (!isEncryptedTauthyBackup(json)) throw Error('importFailed')

  try {
    return await invoke<unknown>('decrypt_tauthy_backup', {
      backup: JSON.stringify(json),
      password,
    })
  } catch (err) {
    if (typeof err === 'string') throw Error(err)
    throw Error('importFailed')
  }
}

const encryptedImportAdapters: Partial<Record<ImportFormat, EncryptedImportAdapter>> = {
  aegis: {
    isEncrypted: isEncryptedAegisBackup,
    decrypt: async (json, password) => ({
      ...(json as object),
      db: await decryptAegisBackup(json, password),
    }),
  },
  tauthy: {
    isEncrypted: isEncryptedTauthyBackup,
    decrypt: decryptTauthyBackup,
  },
}

export const isEncryptedImport = (json: unknown, format: ImportFormat) =>
  encryptedImportAdapters[format]?.isEncrypted(json) ?? false

const decryptImport = async (json: unknown, format: ImportFormat, password: string) => {
  const adapter = encryptedImportAdapters[format]
  if (!adapter) throw Error('importEncryptedUnsupported')
  return adapter.decrypt(json, password)
}

export const getTOTPRefreshDelay = (expiresAtMs: number, now = Date.now()) =>
  Math.max(expiresAtMs - now, 1)

const supportedOtpSettings = (algorithm: unknown, digits: unknown, period: unknown) =>
  typeof algorithm === 'string' &&
  algorithm.toUpperCase() === 'SHA1' &&
  digits === 6 &&
  period === 30

const decodeOtpLabel = (pathname: string) => {
  try {
    return decodeURIComponent(pathname.replace(/^\//, ''))
  } catch {
    throw Error('importFailed')
  }
}

const normalizedSecret = (secret: string) =>
  secret.replace(/\s/g, '').toUpperCase().replace(/=+$/, '')

export const parseOtpAuthUri = (value: string): VaultEntry => {
  let uri: URL

  try {
    uri = new URL(value)
  } catch {
    throw Error('importFailed')
  }

  if (uri.protocol !== 'otpauth:' || uri.hostname.toLowerCase() !== 'totp') {
    throw Error('importUnsupportedOtp')
  }

  const secret = uri.searchParams.get('secret')?.trim()
  const label = decodeOtpLabel(uri.pathname).trim()
  if (!secret || !label) {
    throw Error('importFailed')
  }

  const algorithm = uri.searchParams.get('algorithm') ?? 'SHA1'
  const digits = Number(uri.searchParams.get('digits') ?? 6)
  const period = Number(uri.searchParams.get('period') ?? 30)
  if (!supportedOtpSettings(algorithm, digits, period)) {
    throw Error('importUnsupportedOtp')
  }

  const separator = label.indexOf(':')
  const labelIssuer = separator >= 0 ? label.slice(0, separator).trim() : ''
  const account = separator >= 0 ? label.slice(separator + 1).trim() : label
  const issuer = uri.searchParams.get('issuer')?.trim() || labelIssuer

  return {
    uuid: generateUUID(),
    name: account || label,
    issuer: issuer || undefined,
    secret,
  }
}

export const parseOtpAuthUriList = (text: string): VaultEntry[] => {
  const lines = text.replace(/^\uFEFF/, '').split(/\r\n|\r|\n/)
  const entries = lines
    .filter((line) => line.trim())
    .map((line) => {
      const entry = parseOtpAuthUri(line.trim())
      if (!/^[A-Z2-7]+$/.test(normalizedSecret(entry.secret))) throw Error('importFailed')
      return entry
    })
  if (entries.length === 0) throw Error('importFailed')
  if (entries.length > MAX_OTP_AUTH_ENTRIES) throw Error('importOtpAuthTooMany')
  return entries
}

const importEntryKey = (entry: VaultEntry) =>
  JSON.stringify([
    normalizedSecret(entry.secret),
    entry.issuer?.trim().toLowerCase() ?? '',
    entry.name.trim().toLowerCase(),
    entry.group?.trim().toLowerCase() ?? '',
    entry.icon ?? '',
  ])

const parseOtpAuthImport = async (file: File) => {
  if (file.size > MAX_OTP_AUTH_FILE_SIZE) throw Error('importOtpAuthTooLarge')
  const entries = parseOtpAuthUriList(await file.text())
  try {
    const { codes } = await invoke<GeneratedTOTPs>('generate_totps', {
      arguments: entries.map((entry) => entry.secret),
    })
    if (codes.length !== entries.length || codes.some((code) => code === null)) {
      throw Error('importFailed')
    }
  } catch {
    throw Error('importFailed')
  }
  return entries
}

const planImport = (current: VaultEntry[], imported: VaultEntry[], format: ImportFormat) => {
  if (format === 'tauthy') {
    const merged = mergeTauthyImport(current, imported)
    const existingIds = new Set(current.map((entry) => entry.uuid))
    const duplicateIndices = imported.flatMap((entry, index) =>
      existingIds.has(entry.uuid) ? [index] : [],
    )
    return { merged, duplicateIndices }
  }

  const seenKeys = new Set(current.map(importEntryKey))
  const seenIds = new Set(current.map((entry) => entry.uuid))
  const additions: VaultEntry[] = []
  const duplicateIndices: number[] = []
  imported.forEach((entry, index) => {
    const key = importEntryKey(entry)
    if (seenKeys.has(key)) {
      duplicateIndices.push(index)
      return
    }
    if (seenIds.has(entry.uuid)) throw Error('importIdConflict')
    seenKeys.add(key)
    seenIds.add(entry.uuid)
    additions.push(entry)
  })
  return { merged: [...current, ...additions], duplicateIndices }
}

const twoFasServiceToUri = (service: TwoFasService) => {
  const otp = service.otp
  if (!otp || !service.secret?.trim()) {
    throw Error('importFailed')
  }

  if ((otp.tokenType ?? 'TOTP').toUpperCase() !== 'TOTP') {
    throw Error('importUnsupportedOtp')
  }

  if (otp.link?.trim()) {
    return otp.link
  }

  const issuer = otp.issuer?.trim() || service.name?.trim()
  const account = otp.account?.trim() || otp.label?.trim() || service.name?.trim()
  if (!account) {
    throw Error('importFailed')
  }

  const uri = new URL(`otpauth://totp/${encodeURIComponent(account)}`)
  uri.searchParams.set('secret', service.secret.trim())
  if (issuer) uri.searchParams.set('issuer', issuer)
  uri.searchParams.set('algorithm', otp.algorithm ?? 'SHA1')
  uri.searchParams.set('digits', String(otp.digits ?? 6))
  uri.searchParams.set('period', String(otp.period ?? 30))
  return uri.toString()
}

export const parseImportedEntries = (json: unknown, format: ImportFormat): VaultEntry[] => {
  let importedEntries: VaultEntry[] = []

  if (format === '2fas') {
    const backup = json as TwoFasBackup
    if (typeof backup?.servicesEncrypted === 'string') {
      throw Error('import2FasEncrypted')
    }
    if (!Array.isArray(backup?.services)) {
      throw Error('importFailed')
    }

    const groupNames = new Map(
      (Array.isArray(backup.groups) ? backup.groups : [])
        .filter((group) => typeof group?.id === 'string' && typeof group?.name === 'string')
        .map((group) => [group.id as string, group.name as string]),
    )

    importedEntries = backup.services.map((service) => {
      const entry = parseOtpAuthUri(twoFasServiceToUri(service))
      if (
        typeof service.secret !== 'string' ||
        normalizedSecret(entry.secret) !== normalizedSecret(service.secret)
      ) {
        throw Error('importFailed')
      }

      return {
        ...entry,
        group: service.groupId ? groupNames.get(service.groupId) : undefined,
      }
    })
  }

  if (format === 'aegis') {
    const backup = json as { db?: AegisDatabase | string }
    if (typeof backup?.db === 'string') {
      throw Error('importPasswordRequired')
    }

    if (!Array.isArray(backup?.db?.entries)) {
      throw Error('importFailed')
    }

    const entries = backup.db.entries
    const groupNames = new Map(
      (Array.isArray(backup.db.groups) ? backup.db.groups : [])
        .filter((group) => typeof group?.uuid === 'string' && typeof group?.name === 'string')
        .map((group) => [group.uuid as string, group.name as string]),
    )
    const containsUnsupportedEntries = entries.some(
      (entry) =>
        entry.type !== 'totp' ||
        !supportedOtpSettings(entry.info?.algo, entry.info?.digits, entry.info?.period),
    )

    if (containsUnsupportedEntries) {
      throw Error('importUnsupportedOtp')
    }

    importedEntries = entries.map((entry) => {
      const currentGroup = entry.groups?.map((group) => groupNames.get(group)).find(Boolean)
      return {
        uuid: entry.uuid,
        name: entry.name,
        issuer: entry.issuer,
        group: currentGroup || entry.group,
        secret: entry.info.secret,
        icon: entry.icon,
      }
    })
  }

  if (format === 'authy') {
    if (!Array.isArray(json)) throw Error('importFailed')
    const entries = json as AuthyEntry[]
    importedEntries = entries.map((entry) => ({
      uuid: generateUUID(),
      name: entry.name,
      secret: entry.secret,
    }))
  }

  if (format === 'tauthy') {
    importedEntries = parseTauthyBackup(json)
  }

  if (importedEntries.length === 0) {
    throw Error('importFailed')
  }

  return importedEntries
}

export const generateTOTPs = async (secrets: string[]) => {
  try {
    return await invoke<GeneratedTOTPs>('generate_totps', { arguments: secrets })
  } catch (err) {
    console.error('error from backend:', err)
    return {
      codes: secrets.map(() => null),
      expiresAtMs: Date.now() + 1000,
    }
  }
}

export const createCode = async (formData: FormData) => {
  const entry = {
    ...formData,
    uuid: generateUUID(),
  }

  const currentVault = await vault.getVault()
  const newVault = currentVault ? [...currentVault, entry] : [entry]

  try {
    await vault.save(JSON.stringify(newVault))
  } catch (err) {
    console.error(err)
  }
}

export const editCode = async (uuid: string, formData: FormData) => {
  const currentVault = await vault.getVault()
  const entry = currentVault.find((entry: VaultEntry) => entry.uuid === uuid)
  const filteredVault = currentVault.filter((entry: VaultEntry) => entry.uuid !== uuid)
  if (!entry) throw Error(`No entry found for uuid ${uuid}`)
  const newVault = [...filteredVault, { ...entry, ...formData }]

  try {
    await vault.save(JSON.stringify(newVault))
  } catch (err) {
    console.error(err)
  }
}

export const deleteCode = async (id: string) => {
  const currentVault = await vault.getVault()
  const filteredVault = currentVault.filter((entry: VaultEntry) => entry.uuid !== id)

  try {
    await vault.save(JSON.stringify(filteredVault))
  } catch (err) {
    console.error(err)
  }
}

const parseImportFile = async (file: File, format: ImportFormat, password?: string) => {
  if (format === 'otpauth') return parseOtpAuthImport(file)

  let json: unknown
  try {
    json = JSON.parse(await file.text())
  } catch (err) {
    console.error('error when trying to parse json:', err)
    throw Error('importFailed')
  }

  if (isEncryptedImport(json, format)) {
    if (password === undefined) throw Error('importPasswordRequired')
    json = await decryptImport(json, format, password)
  }

  return parseImportedEntries(json, format)
}

export const prepareImport = async (
  file: File,
  format: ImportFormat,
  password?: string,
): Promise<ImportPreview> => {
  const entries = await parseImportFile(file, format, password)
  const currentVault = await vault.getVault()
  const { duplicateIndices } = planImport(currentVault, entries, format)
  return {
    format,
    sourceName: file.name,
    entries,
    newCount: entries.length - duplicateIndices.length,
    duplicateCount: duplicateIndices.length,
    duplicateIndices,
  }
}

export const commitPreparedImport = async (preview: ImportPreview) => {
  const currentVault = await vault.getVault()
  const { merged } = planImport(currentVault, preview.entries, preview.format)
  const addedCount = merged.length - currentVault.length
  if (addedCount > 0) await vault.save(JSON.stringify(merged))
  return addedCount
}

export const importFile = async (file: File, format: ImportFormat, password?: string) => {
  const preview = await prepareImport(file, format, password)
  await commitPreparedImport(preview)
  return preview
}

export const importCodes = (event: ChangeEvent<HTMLInputElement>, format: ImportFormat) => {
  const file = event.target.files?.[0]
  if (!file) return Promise.reject(Error('importFailed'))
  return importFile(file, format)
}

export const exportCodes = async (password?: string) => {
  const entries = await vault.getVault()

  if (entries.length === 0) {
    throw Error('exportEmpty')
  }

  const exportedAt = new Date()
  const timestamp = exportedAt
    .toISOString()
    .replace(/\.\d{3}Z$/, 'Z')
    .replace(/:/g, '-')
  let backup: unknown = createTauthyBackup(entries, exportedAt)
  const encrypted = password !== undefined
  const fileName = encrypted
    ? `tauthy-export-${timestamp}.tauthy`
    : `tauthy-export-${timestamp}.json`
  const filePath = await save({
    defaultPath: fileName,
    filters: encrypted
      ? [{ name: 'Tauthy encrypted backup', extensions: ['tauthy'] }]
      : [{ name: 'JSON', extensions: ['json'] }],
  })

  if (!filePath) {
    throw Error('exportCancelled')
  }

  try {
    if (encrypted) {
      backup = await invoke<unknown>('encrypt_tauthy_backup', { backup, password })
    }
    const file = `${JSON.stringify(backup, null, 2)}\n`
    await writeTextFile(filePath, file)
  } catch (err) {
    throw Error('exportFailed')
  }

  return 'exportSuccess'
}
