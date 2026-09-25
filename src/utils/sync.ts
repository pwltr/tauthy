import { invoke } from '@tauri-apps/api/core'
import toast from 'react-hot-toast'

import i18n from '~/utils/i18n'

export const SYNC_COMPLETE_EVENT = 'tauthy:sync-complete'
export const SYNC_BACKGROUND_ERROR_EVENT = 'tauthy:sync-background-error'

let backgroundError: unknown
let notifiedError: string | undefined

export type SyncStatus = {
  enabled: boolean
  path?: string
  lastSyncedAt?: number
}

export const getBackgroundSyncError = () => backgroundError

const clearBackgroundSyncError = () => {
  if (backgroundError !== undefined || notifiedError !== undefined) {
    backgroundError = undefined
    notifiedError = undefined
    window.dispatchEvent(new Event(SYNC_BACKGROUND_ERROR_EVENT))
  }
}

const announceSync = () => {
  clearBackgroundSyncError()
  window.dispatchEvent(new Event(SYNC_COMPLETE_EVENT))
}

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

export const syncInBackground = async () => {
  try {
    await syncNow()
  } catch (error) {
    const message = typeof error === 'string' ? error : error instanceof Error ? error.message : ''
    if (message === 'syncNotConfigured' || message === 'vault is locked') return

    backgroundError = error
    window.dispatchEvent(new Event(SYNC_BACKGROUND_ERROR_EVENT))
    if (message !== notifiedError) {
      notifiedError = message
      toast.error(i18n.t('toasts.syncBackgroundFailed'), { duration: 8000 })
    }
  }
}

export const mergeConflictedSyncCopy = async (path: string) => {
  const status = await invoke<SyncStatus>('sync_merge_conflicted_copy', { path })
  announceSync()
  return status
}

export const disconnectSync = async () => {
  const status = await invoke<SyncStatus>('sync_disconnect')
  clearBackgroundSyncError()
  return status
}
