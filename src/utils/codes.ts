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

export type ImportFormat = '2fas' | 'aegis' | 'authy' | 'google' | 'tauthy'

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

const encryptedImportAdapters: Partial<Record<ImportFormat, EncryptedImportAdapter>> = {
  aegis: {
    isEncrypted: isEncryptedAegisBackup,
    decrypt: async (json, password) => ({
      ...(json as object),
      db: await decryptAegisBackup(json, password),
    }),
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

export const importFile = async (file: File, format: ImportFormat, password?: string) => {
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

  const importedEntries = parseImportedEntries(json, format)
  const currentVault = await vault.getVault()
  const entries =
    format === 'tauthy'
      ? mergeTauthyImport(currentVault, importedEntries)
      : [...currentVault, ...importedEntries]
  await vault.save(JSON.stringify(entries))
  return json
}

export const importCodes = (event: ChangeEvent<HTMLInputElement>, format: ImportFormat) => {
  const file = event.target.files?.[0]
  if (!file) return Promise.reject(Error('importFailed'))
  return importFile(file, format)
}

export const exportCodes = async () => {
  const entries = await vault.getVault()

  if (entries.length === 0) {
    throw Error('exportEmpty')
  }

  const exportedAt = new Date()
  const timestamp = exportedAt
    .toISOString()
    .replace(/\.\d{3}Z$/, 'Z')
    .replace(/:/g, '-')
  const file = `${JSON.stringify(createTauthyBackup(entries, exportedAt), null, 2)}\n`
  const fileName = `tauthy-export-${timestamp}.json`
  const filePath = await save({
    defaultPath: fileName,
    filters: [{ name: 'JSON', extensions: ['json'] }],
  })

  if (!filePath) {
    throw Error('exportCancelled')
  }

  try {
    await writeTextFile(filePath, file)
  } catch (err) {
    throw Error('exportFailed')
  }

  return 'exportSuccess'
}
