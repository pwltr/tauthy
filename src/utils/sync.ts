import { invoke } from '@tauri-apps/api/core'
import toast from 'react-hot-toast'

import i18n from '~/utils/i18n'
import { recordDiagnostic } from '~/utils/diagnostics'

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
  provider?: 'folder' | 'pubky'
}

export type PubkyApproval = {
  approved: boolean
  publicKey?: string
  hasRemote?: boolean
}

export type PubkySetupResult = {
  status: SyncStatus
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
  recordDiagnostic('sync.connect.start')
  try {
    const status = await invoke<SyncStatus>('sync_create', { path, password })
    lastSuccessfulCheckAt = undefined
    announceSync()
    recordDiagnostic('sync.connect.ok')
    return status
  } catch (error) {
    recordDiagnostic('sync.connect.error', error)
    throw error
  }
}

export const joinSync = async (path: string, password: string) => {
  recordDiagnostic('sync.connect.start')
  try {
    const status = await invoke<SyncStatus>('sync_join', { path, password })
    lastSuccessfulCheckAt = undefined
    announceSync()
    recordDiagnostic('sync.connect.ok')
    return status
  } catch (error) {
    recordDiagnostic('sync.connect.error', error)
    throw error
  }
}

export const syncNow = async () => {
  try {
    const status = await invoke<SyncStatus>('sync_now')
    lastSuccessfulCheckAt = Date.now()
    const currentStatus = withLatestCheck(status)
    const recoveredFromError = backgroundError !== undefined
    clearBackgroundSyncError()
    if (status.vaultChanged) window.dispatchEvent(new Event(SYNC_COMPLETE_EVENT))
    window.dispatchEvent(new CustomEvent(SYNC_STATUS_EVENT, { detail: currentStatus }))
    if (recoveredFromError) recordDiagnostic('sync.now.ok')
    return currentStatus
  } catch (error) {
    // An unconfigured or locked vault is expected during startup. Logging it
    // every minute would bury actual failures in the bounded history.
    const message = typeof error === 'string' ? error : error instanceof Error ? error.message : ''
    if (message !== 'syncNotConfigured' && message !== 'vault is locked') {
      recordDiagnostic('sync.now.error', error)
    }
    throw error
  }
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

export const startPubkySync = async () => {
  recordDiagnostic('pubky.approval.start')
  try {
    return await invoke<string>('pubky_sync_start')
  } catch (error) {
    recordDiagnostic('pubky.approval.error', error)
    throw error
  }
}

export const pollPubkySync = async () => {
  try {
    const result = await invoke<PubkyApproval>('pubky_sync_poll')
    if (result.approved) recordDiagnostic('pubky.approval.ok')
    return result
  } catch (error) {
    recordDiagnostic('pubky.approval.error', error)
    throw error
  }
}
export const cancelPubkySync = () => invoke<void>('pubky_sync_cancel')

export const createPubkySync = async (recoveryCode: string) => {
  recordDiagnostic('pubky.create.start')
  try {
    const result = await invoke<PubkySetupResult>('pubky_sync_create', { recoveryCode })
    announceSync()
    recordDiagnostic('pubky.create.ok')
    return result
  } catch (error) {
    recordDiagnostic('pubky.create.error', error)
    throw error
  }
}

export const joinPubkySync = async (recoveryCode: string) => {
  recordDiagnostic('pubky.join.start')
  try {
    const result = await invoke<PubkySetupResult>('pubky_sync_join', { recoveryCode })
    announceSync()
    recordDiagnostic('pubky.join.ok')
    return result
  } catch (error) {
    recordDiagnostic('pubky.join.error', error)
    throw error
  }
}

export const getPubkyRecoveryCode = () => invoke<string>('pubky_sync_recovery_code')
