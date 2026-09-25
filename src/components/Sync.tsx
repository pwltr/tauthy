import { useContext, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import { confirm, open } from '@tauri-apps/plugin-dialog'
import Box from '@mui/material/Box'
import Alert from '@mui/material/Alert'
import CircularProgress from '@mui/material/CircularProgress'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemText from '@mui/material/ListItemText'
import Typography from '@mui/material/Typography'

import { AppBarTitleContext } from '~/context'
import ListItem from '~/components/ListItem'
import SyncPasswordModal from '~/components/modals/SyncPassword'
import { developerSettingsEnabled } from '~/utils/developerSettings'
import {
  createSync,
  disconnectSync,
  getBackgroundSyncError,
  getSyncStatus,
  joinSync,
  mergeConflictedSyncCopy,
  syncNow,
  SYNC_BACKGROUND_ERROR_EVENT,
  type SyncStatus,
} from '~/utils/sync'

type PendingAction = { mode: 'create' | 'join'; path: string }

const errorText = (error: unknown) =>
  typeof error === 'string' ? error : error instanceof Error ? error.message : ''

const errorKey = (error: unknown) => {
  const key = errorText(error)
  return [
    'syncAuthenticationFailed',
    'syncConflict',
    'syncCorrupt',
    'syncDeviceFileLimit',
    'syncFileExists',
    'syncMultipleFiles',
    'syncNotConfigured',
    'syncUnavailable',
    'syncUnsupported',
  ].includes(key)
    ? key
    : 'syncFailed'
}

const Sync = () => {
  const { t, i18n } = useTranslation()
  const { setAppBarTitle } = useContext(AppBarTitleContext)
  const [status, setStatus] = useState<SyncStatus>()
  const [pending, setPending] = useState<PendingAction>()
  const [busy, setBusy] = useState(false)
  const [backgroundError, setBackgroundError] = useState<unknown>(getBackgroundSyncError)
  const showRecovery = developerSettingsEnabled()

  const syncErrorMessage = (error: unknown) => {
    const message = errorText(error)
    const prefix = 'syncDeviceFileInvalid:'
    return message.startsWith(prefix)
      ? t('toasts.syncDeviceFileInvalid', { file: message.slice(prefix.length) })
      : t(`toasts.${errorKey(error)}`)
  }

  const loadStatus = async () => {
    try {
      setStatus(await getSyncStatus())
    } catch (error) {
      toast.error(syncErrorMessage(error))
    }
  }

  useEffect(() => {
    setAppBarTitle(t('sync.pageTitle'))
    void loadStatus()
  }, [])

  useEffect(() => {
    const updateBackgroundError = () => setBackgroundError(getBackgroundSyncError())
    window.addEventListener(SYNC_BACKGROUND_ERROR_EVENT, updateBackgroundError)
    return () => window.removeEventListener(SYNC_BACKGROUND_ERROR_EVENT, updateBackgroundError)
  }, [])

  const chooseCreate = async () => {
    try {
      const path = await open({ multiple: false, directory: true })
      if (typeof path === 'string') setPending({ mode: 'create', path })
    } catch {
      toast.error(t('toasts.syncPickerFailed'))
    }
  }

  const chooseJoin = async () => {
    try {
      const path = await open({ multiple: false, directory: true })
      if (typeof path === 'string') setPending({ mode: 'join', path })
    } catch {
      toast.error(t('toasts.syncPickerFailed'))
    }
  }

  const configure = async (password: string) => {
    if (!pending) return
    setBusy(true)
    try {
      const next =
        pending.mode === 'create'
          ? await createSync(pending.path, password)
          : await joinSync(pending.path, password)
      setStatus(next)
      setPending(undefined)
      toast.success(t('toasts.syncConfigured'))
    } catch (error) {
      toast.error(syncErrorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const synchronize = async () => {
    setBusy(true)
    try {
      setStatus(await syncNow())
      toast.success(t('toasts.syncSuccess'))
    } catch (error) {
      toast.error(syncErrorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const mergeConflictedCopy = async () => {
    try {
      // Nextcloud may append a conflict marker after the original extension.
      const path = await open({ multiple: false, directory: false })
      if (typeof path !== 'string') return
      setBusy(true)
      try {
        setStatus(await mergeConflictedSyncCopy(path))
        toast.success(t('toasts.syncConflictMerged'))
      } catch (error) {
        toast.error(syncErrorMessage(error))
      } finally {
        setBusy(false)
      }
    } catch {
      toast.error(t('toasts.syncPickerFailed'))
    }
  }

  const disconnect = async () => {
    const confirmed = await confirm(t('sync.disconnectWarning'), {
      title: t('sync.disconnect'),
      kind: 'warning',
      okLabel: t('sync.disconnect'),
      cancelLabel: t('modals.cancel'),
    })
    if (!confirmed) return
    setBusy(true)
    try {
      setStatus(await disconnectSync())
      toast.success(t('toasts.syncDisconnected'))
    } catch (error) {
      toast.error(syncErrorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  if (!status) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
        <CircularProgress size={28} />
      </Box>
    )
  }

  return (
    <>
      <Box sx={{ px: 2, pt: 2 }}>
        <Typography variant="body2" color="text.secondary">
          {t('sync.description')}
        </Typography>
      </Box>
      {status.enabled ? (
        <>
          {backgroundError && (
            <Alert severity="warning" sx={{ mx: 2, mt: 2 }}>
              {syncErrorMessage(backgroundError)}
            </Alert>
          )}
          <List>
            <ListItem>
              <ListItemText
                primary={t('sync.connected')}
                secondary={status.path}
                slotProps={{ secondary: { sx: { overflowWrap: 'anywhere' } } }}
              />
            </ListItem>
            <ListItem>
              <ListItemText
                primary={t('sync.lastSynced')}
                secondary={
                  status.lastSyncedAt
                    ? new Intl.DateTimeFormat(i18n.language, {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      }).format(status.lastSyncedAt)
                    : t('sync.never')
                }
              />
            </ListItem>
            <ListItem disablePadding onClick={() => !busy && void synchronize()}>
              <ListItemButton disabled={busy}>
                <ListItemText
                  primary={t('sync.syncNow')}
                  secondary={t('sync.syncNowDescription')}
                />
              </ListItemButton>
            </ListItem>
            {showRecovery && (
              <ListItem disablePadding onClick={() => !busy && void mergeConflictedCopy()}>
                <ListItemButton disabled={busy}>
                  <ListItemText
                    primary={t('sync.mergeConflictedCopy')}
                    secondary={t('sync.mergeConflictedCopyDescription')}
                  />
                </ListItemButton>
              </ListItem>
            )}
            <ListItem disablePadding onClick={() => !busy && void disconnect()}>
              <ListItemButton disabled={busy}>
                <ListItemText
                  primary={t('sync.disconnect')}
                  secondary={t('sync.disconnectDescription')}
                />
              </ListItemButton>
            </ListItem>
          </List>
        </>
      ) : (
        <List>
          <ListItem disablePadding onClick={() => void chooseCreate()}>
            <ListItemButton>
              <ListItemText primary={t('sync.create')} secondary={t('sync.createDescription')} />
            </ListItemButton>
          </ListItem>
          <ListItem disablePadding onClick={() => void chooseJoin()}>
            <ListItemButton>
              <ListItemText primary={t('sync.join')} secondary={t('sync.joinDescription')} />
            </ListItemButton>
          </ListItem>
        </List>
      )}
      <SyncPasswordModal
        mode={pending?.mode ?? 'create'}
        open={!!pending}
        busy={busy}
        onClose={() => setPending(undefined)}
        onSubmit={configure}
      />
    </>
  )
}

export default Sync
