import { invoke } from '@tauri-apps/api/core'
import { dataDir, join } from '@tauri-apps/api/path'
import { exists, mkdir, remove } from '@tauri-apps/plugin-fs'

import { VaultEntry } from '~/types'
import { SYNC_COMPLETE_EVENT, syncInBackground } from '~/utils/sync'
import { vaultErrorCode } from '~/utils/vaultErrors'
import { VAULT_DATA_EVENT, resetBackupStatus } from '~/utils/backupStatus'

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
  protectionHint?: 'password' | 'deviceCredential' | 'none' | null
  usingLegacy?: boolean
  operation?: string | null
  phase?: string | null
  migrationDeferred?: string | null
}

export const VAULT_PROTECTION_EVENT = 'tauthy:vault-protection'
export const VAULT_LOCK_EVENT = 'tauthy:vault-lock'

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
  private cachedRecord?: Promise<string>
  private accountSession = 0
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
    if (
      status.status === 'locked' &&
      (status.lifecycle === 'legacy' || status.lifecycle === 'legacyMigrationPending')
    ) {
      // Legacy protection is only known after authentication. Try passwordless
      // startup; protected vaults continue through the ordinary unlock screen.
      // Deferred sessions reopen legacy without retrying credential setup.
      try {
        await this.unlock('')
        return this.getStatus()
      } catch (error) {
        if (vaultErrorCode(error) !== 'vaultAuthenticationFailed') throw error
        return this.getStatus()
      }
    }
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

  async retryMigration(password: string) {
    await this.ready
    this.invalidateCache()
    await invoke('vault_migrate', { password })
    const status = await this.getStatus()
    this.setProtection(status.protectionHint === 'password')
    return status
  }

  private load(password: string) {
    return invoke<void>('vault_load', { password })
  }

  async checkVault() {
    if (this.cachedRecord) return this.cachedRecord
    const read = this.ready.then(() => invoke<string>('vault_get'))
    this.cachedRecord = read
    try {
      return await read
    } catch (error) {
      if (this.cachedRecord === read) this.invalidateCache()
      throw error
    }
  }

  async getVault() {
    const vault = await this.checkVault()
    const vaultJSON: VaultEntry[] = JSON.parse(vault)
    return vaultJSON
  }

  invalidateCache() {
    this.cachedRecord = undefined
  }

  private endAccountSession() {
    this.accountSession += 1
    this.invalidateCache()
    window.dispatchEvent(new Event(VAULT_LOCK_EVENT))
  }

  private accountsChanged() {
    this.invalidateCache()
    window.dispatchEvent(new Event(VAULT_DATA_EVENT))
    // A failed sync must not turn a committed local edit into a failure.
    void syncInBackground()
  }

  async updateEntries<T>(
    update: (current: VaultEntry[]) => { entries: VaultEntry[]; result: T },
  ): Promise<T> {
    const session = this.accountSession
    await this.ready
    try {
      // Sync and other edits may commit between our read and write. Reapply
      // only the requested change when the backend rejects a stale snapshot.
      for (let attempt = 0; attempt < 3 && session === this.accountSession; attempt += 1) {
        const expected = await invoke<string>('vault_get')
        if (session !== this.accountSession) break
        const current: VaultEntry[] = JSON.parse(expected)
        const { entries, result } = update(current)
        if (entries === current) return result
        const saved = await invoke<boolean>('vault_save_if_current', {
          expected,
          record: JSON.stringify(entries),
        })
        if (saved) {
          if (session === this.accountSession) this.accountsChanged()
          return result
        }
      }
      throw Error('Vault changed before the account update could be saved')
    } catch (error) {
      this.invalidateCache()
      throw error
    }
  }

  async save(record: string) {
    await this.ready
    try {
      await invoke('vault_save', { record })
    } catch (error) {
      this.invalidateCache()
      throw error
    }
    this.accountsChanged()
  }

  async reset() {
    await this.save('[]')
  }

  async destroy() {
    this.endAccountSession()
    await this.ready
    if (this.fileBackend) {
      await invoke('vault_delete', { confirmed: true })
      resetBackupStatus()
      this.invalidateCache()
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
    resetBackupStatus()
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
    this.endAccountSession()
    console.info('locking vault...')
    await invoke('vault_unload')
    this.invalidateCache()
    console.info('vault locked.')
  }

  async unlock(password: string, targetPassword?: string) {
    // A failed unlock must not poison the startup promise and prevent retries.
    if (this.fileBackend) {
      await this.ready
      const status = await this.getStatus()
      const command = status.lifecycle === 'legacy' ? 'vault_migrate' : 'vault_load'
      this.invalidateCache()
      await invoke(
        command,
        targetPassword === undefined ? { password } : { password, targetPassword },
      )
      const opened = await this.getStatus()
      this.setProtection(opened.protectionHint === 'password')
      return
    }
    this.invalidateCache()
    this.ready = this.load(password)
    await this.ready
  }

  async changePassword(password: string, currentPassword?: string) {
    await this.ready
    this.invalidateCache()
    await invoke(
      'vault_change_password',
      this.fileBackend
        ? { password: password || null, currentPassword: currentPassword ?? null, confirmed: true }
        : { password },
    )
    if (!this.fileBackend) localStorage.setItem('isPasswordSet', String(!!password))
    this.setProtection(!!password)
  }

  async importForeign(options: {
    path: string
    foreignPassword: string
    currentPassword: string
    password: string
    recovery: boolean
  }) {
    await this.ready
    if (!this.fileBackend) throw { code: 'vaultUnsupportedEnvelope' }
    this.endAccountSession()
    await invoke('vault_import_foreign', {
      ...options,
      currentPassword: options.currentPassword || null,
      password: options.password || null,
      confirmed: true,
      disconnectSync: true,
    })
    this.invalidateCache()
    resetBackupStatus()
    window.dispatchEvent(new Event(VAULT_DATA_EVENT))
    const status = await this.getStatus()
    this.setProtection(status.protectionHint === 'password')
  }
}

export const vault = await setupVault()

window.addEventListener(SYNC_COMPLETE_EVENT, () => vault.invalidateCache())
