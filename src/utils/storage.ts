import { invoke } from '@tauri-apps/api/core'
import { dataDir, join } from '@tauri-apps/api/path'
import { exists, mkdir, remove } from '@tauri-apps/plugin-fs'

import { VaultEntry } from '~/types'
import { SYNC_COMPLETE_EVENT, syncInBackground } from '~/utils/sync'

export interface VaultStatus {
  status: 'locked' | 'unlocked'
  lifecycle?:
    | 'new'
    | 'legacy'
    | 'legacyMigrationPending'
    | 'transactionPending'
    | 'active'
    | 'deleting'
    | 'deleted'
  protectionHint?: 'password' | 'deviceCredential' | null
  operation?: string | null
  phase?: string | null
  migrationDeferred?: string | null
}

export const VAULT_PROTECTION_EVENT = 'tauthy:vault-protection'

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
  const backend = await invoke<string>('vault_backend')
  if (backend === 'fileV1') {
    // Initialize exactly once before status/unlock. Failures are retained and
    // shown by Main rather than breaking module evaluation or creating data.
    return new Vault(undefined, true)
  }
  await mkdir(dataDirectory, { recursive: true })
  // Compatibility hint for the unchanged legacy build only. File-vault
  // builds never consult this preference as protection or lifecycle truth.
  const passwordIsSet = localStorage.getItem('isPasswordSet') === 'true'
  return new Vault(passwordIsSet ? undefined : '')
}

export class Vault {
  private ready: Promise<void>
  private cachedRecord?: string
  private passwordProtected = false

  constructor(
    password?: string,
    readonly fileBackend = false,
  ) {
    this.passwordProtected = !fileBackend && localStorage.getItem('isPasswordSet') === 'true'
    this.ready = fileBackend
      ? invoke<void>('vault_initialize')
      : password === undefined
        ? Promise.resolve()
        : this.load(password)
    // Attach a handler immediately; Main will still receive the original error.
    void this.ready.catch(() => undefined)
  }

  hasPassword() {
    return this.passwordProtected
  }

  private setProtection(protectedByPassword: boolean) {
    this.passwordProtected = protectedByPassword
    window.dispatchEvent(new Event(VAULT_PROTECTION_EVENT))
  }

  async prepare(retry = false) {
    if (retry && this.fileBackend) this.ready = invoke<void>('vault_initialize')
    await this.ready
    const status = await this.getStatus()
    if (!this.fileBackend) return status
    if (status.protectionHint != null) this.setProtection(status.protectionHint === 'password')
    if (status.lifecycle === 'new' || status.lifecycle === 'deleted') return status
    if (status.status === 'locked' && status.protectionHint === 'deviceCredential') {
      await this.unlock('')
      return this.getStatus()
    }
    // Legacy protection is unknown. Explain migration and let the user submit
    // their existing password (or leave it empty) before any migration effect.
    return status
  }

  async create(password?: string) {
    await this.ready
    if (this.fileBackend)
      await invoke('vault_create', { password: password || null, confirmed: true })
    else await this.unlock(password ?? '')
    this.setProtection(!!password)
    await this.reset()
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
    try {
      await invoke('vault_save', { record })
    } catch (error) {
      this.cachedRecord = undefined
      throw error
    }
    this.cachedRecord = record
    // Sync is deliberately best-effort. A missing cloud folder or network
    // failure must never turn a successful local vault edit into a failure.
    void syncInBackground()
  }

  async reset() {
    await this.save('[]')
  }

  async destroy() {
    await this.ready
    if (this.fileBackend) {
      await invoke('vault_delete', { confirmed: true })
      this.cachedRecord = undefined
      this.setProtection(false)
      return
    }
    await this.lock()
    await Promise.all(
      [vaultPath, backupPath, migrationPath, migrationBackupPath, passwordMigrationPath].map(
        removeIfExists,
      ),
    )
    localStorage.setItem('isPasswordSet', 'false')
    this.setProtection(false)
  }

  async getStatus() {
    await this.ready
    return await invoke<VaultStatus>('vault_status')
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

  async unlock(password: string, targetPassword?: string) {
    // A failed unlock must not poison the startup promise and prevent retries.
    if (this.fileBackend) {
      await this.ready
      const status = await this.getStatus()
      const command = status.lifecycle === 'legacy' ? 'vault_migrate' : 'vault_load'
      this.cachedRecord = undefined
      await invoke(
        command,
        targetPassword === undefined ? { password } : { password, targetPassword },
      )
      const opened = await this.getStatus()
      this.setProtection(opened.protectionHint === 'password')
      return
    }
    this.cachedRecord = undefined
    this.ready = this.load(password)
    await this.ready
  }

  async changePassword(password: string, currentPassword?: string) {
    await this.ready
    this.cachedRecord = undefined
    await invoke(
      'vault_change_password',
      this.fileBackend
        ? { password: password || null, currentPassword: currentPassword ?? null, confirmed: true }
        : { password },
    )
    if (!this.fileBackend) localStorage.setItem('isPasswordSet', String(!!password))
    this.setProtection(!!password)
  }
}

export const vault = await setupVault()

window.addEventListener(SYNC_COMPLETE_EVENT, () => vault.invalidateCache())
