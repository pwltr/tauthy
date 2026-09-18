import { invoke } from '@tauri-apps/api/core'
import { dataDir, join } from '@tauri-apps/api/path'
import { copyFile, exists, mkdir, remove } from '@tauri-apps/plugin-fs'

import { VaultEntry } from '~/types'

const appName = import.meta.env.DEV ? 'tauthy-dev' : 'tauthy'
const vaultName = 'vault.stronghold'
const dataDirectory = await join(await dataDir(), appName)
const vaultPath = await join(dataDirectory, vaultName)
const backupPath = await join(dataDirectory, `${vaultName}.backup`)
const migrationPath = await join(dataDirectory, `${vaultName}.migrating`)
const migrationBackupPath = await join(dataDirectory, `${vaultName}.v2-backup`)

const removeIfExists = async (path: string) => {
  if (await exists(path)) await remove(path)
}

export const setupVault = async () => {
  await mkdir(dataDirectory, { recursive: true })
  return new Vault('')
}

export class Vault {
  private ready: Promise<void>

  constructor(password: string) {
    this.ready = this.load(password)
  }

  private load(password: string) {
    return invoke<void>('vault_load', { password })
  }

  async checkVault() {
    await this.ready
    return await invoke<string>('vault_get')
  }

  async getVault() {
    const vault = await this.checkVault()
    const vaultJSON: VaultEntry[] = JSON.parse(vault)
    return vaultJSON
  }

  async save(record: string) {
    await this.ready
    await invoke('vault_save', { record })
  }

  async reset() {
    await this.save('[]')
  }

  async destroy() {
    await this.lock()
    await Promise.all(
      [vaultPath, backupPath, migrationPath, migrationBackupPath].map(removeIfExists),
    )
  }

  async getStatus() {
    return await invoke('vault_status')
  }

  onStatusChange() {
    // The compatibility layer locks explicitly, so no status event is emitted.
  }

  async lock() {
    console.info('locking vault...')
    await invoke('vault_unload')
    console.info('vault locked.')
  }

  async unlock(password: string) {
    this.ready = this.load(password)
    await this.ready
  }

  async changePassword(password: string) {
    await copyFile(vaultPath, backupPath)
    const currentVault = await this.checkVault()

    try {
      await this.lock()
      await remove(vaultPath)

      await this.unlock(password)
      await this.save(currentVault)

      await remove(backupPath)
    } catch (error) {
      try {
        await this.lock()
      } catch {
        // The replacement may not have initialized far enough to unload.
      }

      try {
        await remove(vaultPath)
      } catch {
        // There may be no partial replacement to remove.
      }

      await copyFile(backupPath, vaultPath)
      throw error
    }
  }
}

export const vault = await setupVault()
