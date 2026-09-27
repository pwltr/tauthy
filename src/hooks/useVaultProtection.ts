import { useSyncExternalStore } from 'react'
import { vault, VAULT_PROTECTION_EVENT } from '~/utils/storage'

const subscribe = (callback: () => void) => {
  window.addEventListener(VAULT_PROTECTION_EVENT, callback)
  return () => window.removeEventListener(VAULT_PROTECTION_EVENT, callback)
}

export const useVaultProtection = () => useSyncExternalStore(subscribe, () => vault.hasPassword())
