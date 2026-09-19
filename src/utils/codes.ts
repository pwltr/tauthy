import { ChangeEvent } from 'react'
import { save } from '@tauri-apps/plugin-dialog'
import { invoke } from '@tauri-apps/api/core'
import { writeTextFile } from '@tauri-apps/plugin-fs'

import { vault } from '~/utils/storage'
import { generateUUID } from '~/utils'
import type {
  FormData,
  VaultEntry,
  AegisEntry,
  AuthyEntry,
  TwoFasBackup,
  TwoFasService,
} from '~/types'

export type ImportFormat = '2fas' | 'aegis' | 'authy' | 'google' | 'tauthy'

export type GeneratedTOTPs = {
  codes: Array<string | null>
  expiresAtMs: number
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
    const backup = json as { db?: { entries?: AegisEntry[] } | string }
    if (typeof backup?.db === 'string') {
      throw Error('importAegisEncrypted')
    }

    if (!Array.isArray(backup?.db?.entries)) {
      throw Error('importFailed')
    }

    const entries = backup.db.entries
    const containsUnsupportedEntries = entries.some(
      (entry) =>
        entry.type !== 'totp' ||
        !supportedOtpSettings(entry.info?.algo, entry.info?.digits, entry.info?.period),
    )

    if (containsUnsupportedEntries) {
      throw Error('importUnsupportedOtp')
    }

    importedEntries = entries.map((entry) => ({
      uuid: entry.uuid,
      name: entry.name,
      issuer: entry.issuer,
      group: entry.group,
      secret: entry.info.secret,
      icon: entry.icon,
    }))
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
    if (!Array.isArray(json)) throw Error('importFailed')
    const entries = json as VaultEntry[]
    importedEntries = entries.map((entry) => ({
      uuid: entry.uuid,
      name: entry.name,
      issuer: entry.issuer,
      group: entry.group,
      secret: entry.secret,
      icon: entry.icon,
    }))
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

export const importCodes = (event: ChangeEvent<HTMLInputElement>, format: ImportFormat) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (() => {
      return async function (event) {
        try {
          const currentVault = await vault.getVault()
          const json = JSON.parse(event.target?.result as string)

          const importedEntries = parseImportedEntries(json, format)

          const entries = [...currentVault, ...importedEntries]

          if (entries) {
            await vault.save(JSON.stringify(entries))
            resolve(json)
          } else {
            console.error('no entries found')
            reject('no entries found')
          }
        } catch (err) {
          console.error('error when trying to parse json:', err)
          reject(err)
        }
      }
    })()
    reader.onerror = reject

    if (event.target.files && event.target.files[0]) {
      reader.readAsText(event.target.files[0])
    }
  })
}

export const exportCodes = async () => {
  const entries = await vault.getVault()

  if (entries.length === 0) {
    throw Error('exportEmpty')
  }

  const date = new Date(Date.now())
    .toLocaleDateString('en-US', {
      year: '2-digit',
      month: '2-digit',
      day: '2-digit',
    })
    .replace(/[^\w\s]/gi, '')

  const file = JSON.stringify(entries)
  const fileName = `tauthy_export_${date}.json`
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
