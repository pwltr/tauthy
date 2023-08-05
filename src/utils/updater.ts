import { updater } from '@tauri-apps/api'
// import store from '@/store'

export const checkUpdate = async () => {
  try {
    console.log('checking for update')
    const { shouldUpdate } = await updater.checkUpdate()
    console.log('shouldUpdate', shouldUpdate)
    // shouldUpdate && store.setUpdater({ active: true, version: manifest?.version })
    return shouldUpdate
  } catch (error) {
    console.error(error)
  }
  return false
}
