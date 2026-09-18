import { ChangeEvent } from 'react'
import { save } from '@tauri-apps/plugin-dialog'
import { invoke } from '@tauri-apps/api/core'
import { writeTextFile } from '@tauri-apps/plugin-fs'

import { vault } from '~/utils/storage'
import { generateUUID } from '~/utils'
import type { FormData, VaultEntry, AegisEntry, AuthyEntry } from '~/types'

export type ImportFormat = 'aegis' | 'authy' | 'google' | 'tauthy'

export type GeneratedTOTPs = {
  codes: Array<string | null>
  expiresAtMs: number
}

export const getTOTPRefreshDelay = (expiresAtMs: number, now = Date.now()) =>
  Math.max(expiresAtMs - now, 1)

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

          let importedEntries: VaultEntry[] = []

          if (format === 'aegis') {
            if (typeof json?.db === 'string') {
              throw Error('importAegisEncrypted')
            }

            if (!Array.isArray(json?.db?.entries)) {
              throw Error('importFailed')
            }

            const entries: AegisEntry[] = json.db.entries
            const containsUnsupportedEntries = entries.some(
              (entry) =>
                entry.type !== 'totp' ||
                entry.info?.algo !== 'SHA1' ||
                entry.info?.digits !== 6 ||
                entry.info?.period !== 30,
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
            const entries: AuthyEntry[] = json
            importedEntries = entries.map((entry) => ({
              uuid: generateUUID(),
              name: entry.name,
              secret: entry.secret,
            }))
          }

          // if (format === "google") {
          //   entries = json;
          // }

          if (format === 'tauthy') {
            const entries: VaultEntry[] = json
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
