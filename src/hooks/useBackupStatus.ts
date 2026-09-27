import { useEffect, useState } from 'react'
import { vault } from '~/utils/storage'
import { SYNC_COMPLETE_EVENT } from '~/utils/sync'
import {
  BACKUP_STATUS_EVENT,
  VAULT_DATA_EVENT,
  getBackupStatus,
  type BackupStatus,
} from '~/utils/backupStatus'

export const useBackupStatus = () => {
  const [status, setStatus] = useState<BackupStatus>()
  useEffect(() => {
    let active = true
    let revision = 0
    const refresh = async () => {
      const current = ++revision
      try {
        const next = await getBackupStatus(await vault.getVault())
        if (active && revision === current) setStatus(next)
      } catch {
        if (active && revision === current) setStatus(undefined)
      }
    }
    const events = [BACKUP_STATUS_EVENT, VAULT_DATA_EVENT, SYNC_COMPLETE_EVENT]
    events.forEach((event) => window.addEventListener(event, refresh))
    const timer = window.setInterval(refresh, 60_000)
    void refresh()
    return () => {
      active = false
      events.forEach((event) => window.removeEventListener(event, refresh))
      window.clearInterval(timer)
    }
  }, [])
  return status
}
