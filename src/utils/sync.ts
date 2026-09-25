import { invoke } from '@tauri-apps/api/core'
import toast from 'react-hot-toast'

import i18n from '~/utils/i18n'

export const SYNC_COMPLETE_EVENT = 'tauthy:sync-complete'
export const SYNC_BACKGROUND_ERROR_EVENT = 'tauthy:sync-background-error'
export const SYNC_STATUS_EVENT = 'tauthy:sync-status'

let backgroundError: unknown
let notifiedError: string | undefined
let backgroundSyncInFlight = false
let backgroundSyncPending = false
// A successful no-op check should update the UI, not the Stronghold snapshot.
let lastSuccessfulCheckAt: number | undefined

export type SyncStatus = {
  enabled: boolean
  path?: string
  lastSyncedAt?: number
  vaultChanged?: boolean
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

const withLatestCheck = (status: SyncStatus): SyncStatus =>
  status.enabled && lastSuccessfulCheckAt !== undefined
    ? { ...status, lastSyncedAt: Math.max(status.lastSyncedAt ?? 0, lastSuccessfulCheckAt) }
    : status

export const getSyncStatus = async () => withLatestCheck(await invoke<SyncStatus>('sync_status'))

export const createSync = async (path: string, password: string) => {
  const status = await invoke<SyncStatus>('sync_create', { path, password })
  lastSuccessfulCheckAt = undefined
  announceSync()
  return status
}

export const joinSync = async (path: string, password: string) => {
  const status = await invoke<SyncStatus>('sync_join', { path, password })
  lastSuccessfulCheckAt = undefined
  announceSync()
  return status
}

export const syncNow = async () => {
  const status = await invoke<SyncStatus>('sync_now')
  lastSuccessfulCheckAt = Date.now()
  const currentStatus = withLatestCheck(status)
  clearBackgroundSyncError()
  if (status.vaultChanged) window.dispatchEvent(new Event(SYNC_COMPLETE_EVENT))
  window.dispatchEvent(new CustomEvent(SYNC_STATUS_EVENT, { detail: currentStatus }))
  return currentStatus
}

export const syncInBackground = async () => {
  if (backgroundSyncInFlight) {
    // A local edit might arrive during a periodic read. Give it another pass
    // after the current sync rather than leaving it unpublished until next tick.
    backgroundSyncPending = true
    return
  }
  backgroundSyncInFlight = true
  try {
    do {
      backgroundSyncPending = false
      try {
        await syncNow()
      } catch (error) {
        const message =
          typeof error === 'string' ? error : error instanceof Error ? error.message : ''
        if (message === 'syncNotConfigured' || message === 'vault is locked') continue

        backgroundError = error
        window.dispatchEvent(new Event(SYNC_BACKGROUND_ERROR_EVENT))
        if (message !== notifiedError) {
          notifiedError = message
          toast.error(i18n.t('toasts.syncBackgroundFailed'), { duration: 8000 })
        }
      }
    } while (backgroundSyncPending)
  } finally {
    backgroundSyncInFlight = false
  }
}

export const mergeConflictedSyncCopy = async (path: string) => {
  const status = await invoke<SyncStatus>('sync_merge_conflicted_copy', { path })
  announceSync()
  return status
}

export const disconnectSync = async () => {
  const status = await invoke<SyncStatus>('sync_disconnect')
  lastSuccessfulCheckAt = undefined
  clearBackgroundSyncError()
  return status
}
