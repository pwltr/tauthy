import { dataDir } from '@tauri-apps/api/path'
import { createDir, copyFile, removeFile, Dir } from '@tauri-apps/api/fs'
import { Stronghold, Store, Location, setPasswordClearInterval } from 'tauri-plugin-stronghold-api'

import { VaultEntry } from '~/types'

const appName = 'tauthy'
const dataDirectory = `${await dataDir()}${appName}`
const vaultName = 'vault.stronghold'
const vaultPath = `${dataDirectory}/${vaultName}`

export const setupVault = async () => {
  // create dataDirectory if it doesn't exist
  await createDir(appName, { dir: Dir.Data, recursive: true })
  return new Vault('')
}

export class Vault {
  stronghold: Stronghold
  store: Store
  location: Location

  constructor(password: string) {
    this.stronghold = new Stronghold(vaultPath, password)
    this.store = this.stronghold.getStore('vault', [])
    this.location = Location.generic('vault', 'record')
  }

  async checkVault() {
    return await this.store.get(this.location)
  }

  async getVault() {
    // TODO: add error handling
    const vault = await this.store.get(this.location)
    const vaultJSON: VaultEntry[] = JSON.parse(vault)
    return vaultJSON
  }

  async save(record: string) {
    console.log('save: record', record)

    const recordJSON = JSON.parse(record)
    console.log('save: recordJSON', recordJSON)

    await this.store.insert(this.location, record)
    await this.stronghold.save()
  }

  async reset() {
    await this.store.insert(this.location, '[]')
    await this.stronghold.save()
  }

  async destroy() {
    await this.stronghold.unload()
    await removeFile(`${appName}/${vaultName}`, { dir: Dir.Data })
  }

  getStatus() {
    return this.stronghold.getStatus()
  }

  onStatusChange() {
    this.stronghold.onStatusChange((status) => {
      console.info('Stronghold status changed: ', status)
    })
  }

  async lock(interval = 1) {
    console.info('locking vault...')
    await setPasswordClearInterval({ secs: interval, nanos: 0 })
    console.info('vault locked.')
  }

  async unlock(password: string) {
    await this.stronghold.reload(password)
    // NOTE: never lock automatically
    await setPasswordClearInterval({ secs: 0, nanos: 0 })
  }

  async changePassword(password: string) {
    // backup current vault
    await copyFile(`${appName}/${vaultName}`, `${appName}/${vaultName}.backup`, {
      dir: Dir.Data,
    })

    // read current vault
    const currentVault = await this.store.get(this.location)

    // delete current vault
    await this.stronghold.unload()
    await removeFile(`${appName}/${vaultName}`, { dir: Dir.Data })

    // create new stronghold with new password
    this.stronghold = new Stronghold(vaultPath, password)
    this.store = this.stronghold.getStore('vault', [])

    // save old record to new stronghold store
    await this.store.insert(this.location, currentVault)
    await this.stronghold.save()

    // delete backup
    await removeFile(`${appName}/${vaultName}.backup`, { dir: Dir.Data })
  }
}
