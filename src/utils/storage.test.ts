import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), remove: vi.fn(), sync: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }))
vi.mock('@tauri-apps/api/path', () => ({
  dataDir: async () => '/test',
  join: async (...parts: string[]) => parts.join('/'),
}))
vi.mock('@tauri-apps/plugin-fs', () => ({
  exists: async () => true,
  mkdir: async () => undefined,
  remove: mocks.remove,
}))
vi.mock('~/utils/sync', () => ({ SYNC_COMPLETE_EVENT: 'test:sync', syncInBackground: mocks.sync }))

describe('file-vault frontend dispatcher', () => {
  beforeEach(() => {
    vi.resetModules()
    localStorage.clear()
    mocks.remove.mockReset()
    mocks.sync.mockReset()
    mocks.invoke.mockReset()
    mocks.invoke.mockImplementation(async (command) => {
      if (command === 'vault_backend') return 'fileV1'
      if (command === 'vault_status')
        return { status: 'locked', lifecycle: 'active', protectionHint: 'password' }
      if (command === 'vault_get') return '[]'
    })
  })

  it('initializes before inspection, never trusts the old password preference, and does not auto-create', async () => {
    localStorage.setItem('isPasswordSet', 'false')
    const { vault } = await import('./storage')
    expect(await vault.prepare()).toMatchObject({ status: 'locked' })
    expect(vault.hasPassword()).toBe(true)
    expect(mocks.invoke.mock.calls.map(([command]) => command)).toEqual([
      'vault_backend',
      'vault_initialize',
      'vault_status',
    ])
  })

  it('does not turn missing/invalid active files into a new vault', async () => {
    const { vault } = await import('./storage')
    mocks.invoke.mockImplementation(async (command) => {
      if (command === 'vault_status') throw { code: 'vaultMissing' }
    })
    await expect(vault.prepare()).rejects.toEqual({ code: 'vaultMissing' })
    expect(mocks.invoke).not.toHaveBeenCalledWith('vault_create', expect.anything())
  })

  it('creates only explicitly and initializes the first account record', async () => {
    const { vault } = await import('./storage')
    await vault.create('test password')
    expect(mocks.invoke).toHaveBeenCalledWith('vault_create', {
      password: 'test password',
      confirmed: true,
    })
    expect(mocks.invoke).toHaveBeenCalledWith('vault_save', { record: '[]' })
  })

  it('retries wrong-password unlock without a poisoned startup promise', async () => {
    const { vault } = await import('./storage')
    let failed = false
    mocks.invoke.mockImplementation(async (command) => {
      if (command === 'vault_status')
        return { status: 'locked', lifecycle: 'active', protectionHint: 'password' }
      if (command === 'vault_load' && !failed) {
        failed = true
        throw { code: 'vaultAuthenticationFailed' }
      }
    })
    await expect(vault.unlock('wrong')).rejects.toEqual({ code: 'vaultAuthenticationFailed' })
    await vault.unlock('correct')
    expect(mocks.invoke).toHaveBeenCalledWith('vault_load', { password: 'correct' })
  })

  it('automatically unlocks device protection but does not submit it as a password change', async () => {
    const { vault } = await import('./storage')
    mocks.invoke.mockImplementation(async (command) => {
      if (command === 'vault_status')
        return { status: 'locked', lifecycle: 'active', protectionHint: 'deviceCredential' }
    })
    await vault.prepare()
    expect(mocks.invoke).toHaveBeenCalledWith('vault_load', { password: '' })
    expect(vault.hasPassword()).toBe(false)
  })

  it('uses migration rather than ordinary load for the authoritative legacy vault', async () => {
    const { vault } = await import('./storage')
    mocks.invoke.mockImplementation(async (command) => {
      if (command === 'vault_status') return { status: 'locked', lifecycle: 'legacy' }
    })
    await vault.unlock('old password')
    expect(mocks.invoke).toHaveBeenCalledWith('vault_migrate', { password: 'old password' })
    expect(mocks.invoke).not.toHaveBeenCalledWith('vault_load', expect.anything())
  })

  it('resumes a journaled migration with load, never begins a second migration', async () => {
    const { vault } = await import('./storage')
    mocks.invoke.mockImplementation(async (command) => {
      if (command === 'vault_status')
        return { status: 'locked', lifecycle: 'legacyMigrationPending' }
    })
    await vault.unlock('password')
    expect(mocks.invoke).toHaveBeenCalledWith('vault_load', { password: 'password' })
    expect(mocks.invoke).not.toHaveBeenCalledWith('vault_migrate', expect.anything())
  })

  it('does not perform credential creation before the user confirms a legacy migration', async () => {
    const { vault } = await import('./storage')
    mocks.invoke.mockImplementation(async (command) => {
      if (command === 'vault_status') return { status: 'locked', lifecycle: 'legacy' }
    })
    await vault.prepare()
    expect(mocks.invoke).not.toHaveBeenCalledWith('vault_migrate', expect.anything())
  })

  it('discards cached records when a failed save revokes the backend session', async () => {
    const { vault } = await import('./storage')
    expect(await vault.checkVault()).toBe('[]')
    mocks.invoke.mockImplementation(async () => {
      throw { code: 'vaultLocked' }
    })
    await expect(vault.save('new')).rejects.toEqual({ code: 'vaultLocked' })
    await expect(vault.checkVault()).rejects.toEqual({ code: 'vaultLocked' })
  })

  it('deletes through the journaled backend only; does not remove files or recreate', async () => {
    const { vault } = await import('./storage')
    await vault.destroy()
    expect(mocks.invoke).toHaveBeenCalledWith('vault_delete', { confirmed: true })
    expect(mocks.remove).not.toHaveBeenCalled()
    expect(mocks.invoke).not.toHaveBeenCalledWith('vault_create', expect.anything())
  })

  it('passes the current password and explicit confirmation to rotation, with null for device protection', async () => {
    const { vault } = await import('./storage')
    await vault.changePassword('', 'old password')
    expect(mocks.invoke).toHaveBeenCalledWith('vault_change_password', {
      password: null,
      currentPassword: 'old password',
      confirmed: true,
    })
    expect(localStorage.getItem('isPasswordSet')).toBeNull()
  })

  it('passes explicit replacement and sync-disconnect confirmation and does not rewrite the cloud', async () => {
    const { vault } = await import('./storage')
    await vault.importForeign({
      path: '/foreign.tauthy',
      foreignPassword: 'foreign',
      currentPassword: 'current',
      password: 'new',
      recovery: false,
    })
    expect(mocks.invoke).toHaveBeenCalledWith('vault_import_foreign', {
      path: '/foreign.tauthy',
      foreignPassword: 'foreign',
      currentPassword: 'current',
      password: 'new',
      recovery: false,
      confirmed: true,
      disconnectSync: true,
    })
    expect(mocks.remove).not.toHaveBeenCalled()
    expect(mocks.sync).not.toHaveBeenCalled()
  })

  it('keeps initialization errors visible and retries only on request', async () => {
    mocks.invoke.mockImplementation(async (command) => {
      if (command === 'vault_backend') return 'fileV1'
      if (command === 'vault_initialize') throw { code: 'vaultIo' }
    })
    const { vault } = await import('./storage')
    await expect(vault.prepare()).rejects.toEqual({ code: 'vaultIo' })
    mocks.invoke.mockImplementation(async (command) => {
      if (command === 'vault_status') return { status: 'locked', lifecycle: 'new' }
    })
    expect(await vault.prepare(true)).toMatchObject({ lifecycle: 'new' })
  })
})
