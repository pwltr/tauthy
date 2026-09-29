import { vault } from '~/utils/storage'

// A full navigation resets in-memory app state as well as browser storage.
// The vault command removes local vault artifacts and device credentials; it
// does not touch exports or files in a user-selected sync folder.
export const wipeApp = async (restart = (path: string) => window.location.replace(path)) => {
  await vault.destroy()
  localStorage.clear()
  sessionStorage.clear()
  restart('/welcome')
}
