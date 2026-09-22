import { invoke } from '@tauri-apps/api/core'
import { dataDir, join } from '@tauri-apps/api/path'
import { exists, mkdir, remove } from '@tauri-apps/plugin-fs'

import { VaultEntry } from '~/types'
import { SYNC_COMPLETE_EVENT, syncNow } from '~/utils/sync'

const appName = import.meta.env.DEV ? 'tauthy-dev' : 'tauthy'
const vaultName = 'vault.stronghold'
const dataDirectory = await join(await dataDir(), appName)
const vaultPath = await join(dataDirectory, vaultName)
const backupPath = await join(dataDirectory, `${vaultName}.backup`)
const migrationPath = await join(dataDirectory, `${vaultName}.migrating`)
const migrationBackupPath = await join(dataDirectory, `${vaultName}.v2-backup`)
const passwordMigrationPath = await join(dataDirectory, `${vaultName}.password-migrating`)

const removeIfExists = async (path: string) => {
  if (await exists(path)) await remove(path)
}

export const setupVault = async () => {
  await mkdir(dataDirectory, { recursive: true })
  const passwordIsSet = localStorage.getItem('isPasswordSet') === 'true'
  return new Vault(passwordIsSet ? undefined : '')
}

export class Vault {
  private ready: Promise<void>
  private cachedRecord?: string

  constructor(password?: string) {
    this.ready = password === undefined ? Promise.resolve() : this.load(password)
  }

  private load(password: string) {
    return invoke<void>('vault_load', { password })
  }

  async checkVault() {
    if (this.cachedRecord !== undefined) return this.cachedRecord

    await this.ready
    this.cachedRecord = await invoke<string>('vault_get')
    return this.cachedRecord
  }

  async getVault() {
    const vault = await this.checkVault()
    const vaultJSON: VaultEntry[] = JSON.parse(vault)
    return vaultJSON
  }

  invalidateCache() {
    this.cachedRecord = undefined
  }

  async save(record: string) {
    await this.ready
    await invoke('vault_save', { record })
    this.cachedRecord = record
    // Sync is deliberately best-effort. A missing cloud folder or network
    // failure must never turn a successful local vault edit into a failure.
    void syncNow().catch(() => {})
  }

  async reset() {
    await this.save('[]')
  }

  async destroy() {
    await this.lock()
    await Promise.all(
      [vaultPath, backupPath, migrationPath, migrationBackupPath, passwordMigrationPath].map(
        removeIfExists,
      ),
    )
  }

  async getStatus() {
    return await invoke<{ status: 'locked' | 'unlocked' }>('vault_status')
  }

  async isUnlocked() {
    return (await this.getStatus()).status === 'unlocked'
  }

  onStatusChange() {
    // The compatibility layer locks explicitly, so no status event is emitted.
  }

  async lock() {
    console.info('locking vault...')
    await invoke('vault_unload')
    this.cachedRecord = undefined
    console.info('vault locked.')
  }

  async unlock(password: string) {
    this.cachedRecord = undefined
    this.ready = this.load(password)
    await this.ready
  }

  async changePassword(password: string) {
    await this.ready
    await invoke('vault_change_password', { password })
  }
}

export const vault = await setupVault()

window.addEventListener(SYNC_COMPLETE_EVENT, () => vault.invalidateCache())
