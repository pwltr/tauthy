import { ask } from '@tauri-apps/plugin-dialog'
import { relaunch } from '@tauri-apps/plugin-process'
import { check } from '@tauri-apps/plugin-updater'
// import store from '@/store'

export const checkUpdate = async () => {
  try {
    console.log('checking for update')
    const update = await check()
    const shouldUpdate = update !== null
    console.log('shouldUpdate', shouldUpdate)

    if (update) {
      // Update holds a Rust-side resource even when the user postpones it.
      // Tauri 2.12 makes resources disposable; close explicitly for compatibility
      // with webviews that do not yet support `await using`.
      try {
        const accepted = await ask(`Tauthy ${update.version} is available. Install it now?`, {
          title: 'Tauthy update',
          kind: 'info',
          okLabel: 'Update',
          cancelLabel: 'Later',
        })

        if (accepted) {
          await update.downloadAndInstall()
          await relaunch()
        }
      } finally {
        await update.close()
      }
    }

    return shouldUpdate
  } catch (error) {
    console.error(error)
  }
  return false
}
