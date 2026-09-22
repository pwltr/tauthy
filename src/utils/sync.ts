import { invoke } from '@tauri-apps/api/core'

export const SYNC_COMPLETE_EVENT = 'tauthy:sync-complete'

export type SyncStatus = {
  enabled: boolean
  path?: string
  lastSyncedAt?: number
}

const announceSync = () => window.dispatchEvent(new Event(SYNC_COMPLETE_EVENT))

export const getSyncStatus = () => invoke<SyncStatus>('sync_status')

export const createSync = async (path: string, password: string) => {
  const status = await invoke<SyncStatus>('sync_create', { path, password })
  announceSync()
  return status
}

export const joinSync = async (path: string, password: string) => {
  const status = await invoke<SyncStatus>('sync_join', { path, password })
  announceSync()
  return status
}

export const syncNow = async () => {
  const status = await invoke<SyncStatus>('sync_now')
  announceSync()
  return status
}

export const disconnectSync = () => invoke<SyncStatus>('sync_disconnect')
