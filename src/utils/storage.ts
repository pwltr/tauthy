import { dataDir } from '@tauri-apps/api/path'
import { createDir, copyFile, removeFile, Dir } from '@tauri-apps/api/fs'
import { Stronghold, Store, Location } from 'tauri-plugin-stronghold-api'

import { VaultEntry } from '~/types'

const appName = 'tauthy'
const dataDirectory = `${await dataDir()}${appName}`
const vaultName = 'vault.stronghold'
const vaultPath = `${dataDirectory}/${vaultName}`

export const setupVault = async () => {
  // create dataDirectory if it doesn't exist
  await createDir(appName, { dir: Dir.Data, recursive: true })

  const vault = new Vault('')
  // await vault.setup()

  return vault
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
  }

  getStatus() {
    return this.stronghold.getStatus()
  }

  onStatusChange() {
    this.stronghold.onStatusChange((status) => {
      console.info('Stronghold status changed: ', status)
    })
  }

  // async lock() {
  //   console.info('locking vault...')
  //   await setPasswordClearInterval({ secs: 1, nanos: 0 })
  //   console.info('vault locked.')
  // }

  // async unlock(password: string) {
  //   await this.stronghold.reload(password)
  //   // NOTE: never lock automatically
  //   await setPasswordClearInterval({ secs: 0, nanos: 0 })
  // }

  // async changePassword(password: string) {
  //   // backup current vault
  //   // await copyFile(`${appName}/${vaultName}`, `${appName}/${vaultName}.backup`, {
  //   //   dir: Dir.Data,
  //   // })

  //   // read current vault
  //   const currentVault = await this.store.get(this.location)
  //   console.log('currentVault', currentVault)

  //   // delete current vault
  //   // await removeFile(`${appName}/${vaultName}`, { dir: Dir.Data })

  //   // set new password
  //   await this.stronghold.setPassword(password)
  //   await this.stronghold.clearCache()

  //   // create new vault with new password
  //   this.stronghold = new Stronghold(vaultPath, password)
  //   // this.stronghold = new Stronghold(`${vaultPath}-new`, password)

  //   this.store = this.stronghold.getStore('vault', [])
  //   this.location = Location.generic('vault', 'record')
  //   await this.store.insert(this.location, currentVault)
  //   await this.stronghold.save()

  //   // delete backup
  //   // await removeFile(`${appName}/${vaultName}.backup`, { dir: Dir.Data })
  // }

  async debug() {}

  async debug_deleteVault() {
    // delete current vault
    await removeFile(`${appName}/${vaultName}`, { dir: Dir.Data })
  }
}
