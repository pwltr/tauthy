import { useContext, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import { confirm, open } from '@tauri-apps/plugin-dialog'
import Box from '@mui/material/Box'
import Alert from '@mui/material/Alert'
import CircularProgress from '@mui/material/CircularProgress'
import Button from '@mui/material/Button'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemText from '@mui/material/ListItemText'
import Typography from '@mui/material/Typography'
import TextField from '@mui/material/TextField'
import SyncIcon from '@mui/icons-material/Sync'

import { AppBarTitleContext } from '~/context'
import ListItem from '~/components/ListItem'
import ListSection from '~/components/ListSection'
import ListSubheader from '~/components/ListSubheader'
import SettingsPage from '~/components/SettingsPage'
import Modal, { Buttons } from '~/components/Modal'
import { copyToClipboard } from '~/utils/helpers'
import { developerSettingsEnabled } from '~/utils/developerSettings'
import {
  disconnectSync,
  getBackgroundSyncError,
  getSyncStatus,
  getPubkyRecoveryCode,
  mergeConflictedSyncCopy,
  syncNow,
  SYNC_BACKGROUND_ERROR_EVENT,
  SYNC_STATUS_EVENT,
  type SyncStatus,
} from '~/utils/sync'

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
  const navigate = useNavigate()
  const { t, i18n } = useTranslation()
  const { setAppBarTitle } = useContext(AppBarTitleContext)
  const [status, setStatus] = useState<SyncStatus>()
  const [busy, setBusy] = useState(false)
  const [backgroundError, setBackgroundError] = useState<unknown>(getBackgroundSyncError)
  const showRecovery = developerSettingsEnabled()

  const syncErrorMessage = (error: unknown) => {
    const message = errorText(error)
    const prefix = 'syncDeviceFileInvalid:'
    return message.startsWith(prefix)
      ? t('toasts.syncDeviceFileInvalid', { file: message.slice(prefix.length) })
      : t(
          `toasts.${
            status?.provider === 'pubky' && errorKey(error) === 'syncUnavailable'
              ? 'pubkyUnavailable'
              : errorKey(error)
          }`,
        )
  }
  const [pubkyRecoveryCode, setPubkyRecoveryCode] = useState('')

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

  useEffect(() => {
    const updateStatus = (event: Event) => setStatus((event as CustomEvent<SyncStatus>).detail)
    window.addEventListener(SYNC_STATUS_EVENT, updateStatus)
    return () => window.removeEventListener(SYNC_STATUS_EVENT, updateStatus)
  }, [])

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
    const confirmed = await confirm(
      t(status?.provider === 'pubky' ? 'sync.pubkyDisconnectWarning' : 'sync.disconnectWarning'),
      {
        title: t('sync.disconnect'),
        kind: 'warning',
        okLabel: t('sync.disconnect'),
        cancelLabel: t('modals.cancel'),
      },
    )
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

  const showPubkyRecoveryCode = async () => {
    try {
      setPubkyRecoveryCode(await getPubkyRecoveryCode())
    } catch {
      toast.error(t('toasts.pubkyUnavailable'))
    }
  }

  if (!status) {
    return (
      <SettingsPage>
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
          <CircularProgress size={28} />
        </Box>
      </SettingsPage>
    )
  }

  return (
    <>
      <SettingsPage>
        {status.enabled ? (
          <>
            <Box sx={{ px: 2, pt: 2 }}>
              <Typography variant="body2" color="text.secondary">
                {t(status.provider === 'pubky' ? 'sync.pubkyDescription' : 'sync.description')}
              </Typography>
            </Box>
            {backgroundError && (
              <Alert
                severity="warning"
                sx={{ mx: 2, mt: 2 }}
                action={
                  <Button
                    color="inherit"
                    size="small"
                    disabled={busy}
                    onClick={() => void synchronize()}
                  >
                    {t('sync.retry')}
                  </Button>
                }
              >
                {syncErrorMessage(backgroundError)}
              </Alert>
            )}
            <List>
              <ListSection>
                <ListSubheader>{t('sync.status')}</ListSubheader>
                <ListItem>
                  <ListItemText
                    primary={t(status.provider === 'pubky' ? 'sync.pubky' : 'sync.folder')}
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
                <Box sx={{ px: 2, pt: 1 }}>
                  <Button
                    variant="contained"
                    fullWidth
                    startIcon={<SyncIcon />}
                    disabled={busy}
                    onClick={() => void synchronize()}
                  >
                    {t('sync.syncNow')}
                  </Button>
                </Box>
              </ListSection>

              {(status.provider === 'pubky' || showRecovery) && (
                <ListSection sx={{ mb: 0 }}>
                  <ListSubheader>{t('sync.recovery')}</ListSubheader>
                  {status.provider === 'pubky' && (
                    <ListItem disablePadding onClick={() => !busy && void showPubkyRecoveryCode()}>
                      <ListItemButton disabled={busy}>
                        <ListItemText
                          primary={t('sync.pubkyShowCode')}
                          secondary={t('sync.pubkyShowCodeDescription')}
                        />
                      </ListItemButton>
                    </ListItem>
                  )}
                  {showRecovery && status.provider !== 'pubky' && (
                    <ListItem disablePadding onClick={() => !busy && void mergeConflictedCopy()}>
                      <ListItemButton disabled={busy}>
                        <ListItemText
                          primary={t('sync.mergeConflictedCopy')}
                          secondary={t('sync.mergeConflictedCopyDescription')}
                        />
                      </ListItemButton>
                    </ListItem>
                  )}
                </ListSection>
              )}

              <ListSection>
                <ListItem disablePadding onClick={() => !busy && void disconnect()}>
                  <ListItemButton disabled={busy}>
                    <ListItemText
                      primary={t('sync.disconnect')}
                      secondary={t('sync.disconnectDescription')}
                    />
                  </ListItemButton>
                </ListItem>
              </ListSection>
            </List>
          </>
        ) : (
          <>
            <Box sx={{ px: 2, pt: 2 }}>
              <Typography variant="body2" color="text.secondary">
                {t('sync.chooseMethod')}
              </Typography>
            </Box>
            <List>
              <ListItem disablePadding onClick={() => navigate('/sync/folder')}>
                <ListItemButton>
                  <ListItemText
                    primary={t('sync.folder')}
                    secondary={t('sync.folderDescription')}
                  />
                </ListItemButton>
              </ListItem>
              <ListItem disablePadding onClick={() => navigate('/sync/pubky')}>
                <ListItemButton>
                  <ListItemText
                    primary={t('sync.pubky')}
                    secondary={t('sync.pubkyMethodDescription')}
                  />
                </ListItemButton>
              </ListItem>
            </List>
          </>
        )}
      </SettingsPage>
      <Modal
        open={!!pubkyRecoveryCode}
        onClose={() => setPubkyRecoveryCode('')}
        title={t('sync.pubkyRecoveryCode')}
      >
        <Typography variant="body2" color="text.secondary">
          {t('sync.pubkySaveCode')}
        </Typography>
        <TextField
          value={pubkyRecoveryCode}
          slotProps={{ input: { readOnly: true } }}
          fullWidth
          multiline
          margin="normal"
        />
        <Buttons>
          <Button onClick={() => void copyToClipboard(pubkyRecoveryCode)}>
            {t('sync.pubkyCopyCode')}
          </Button>
          <Button variant="contained" onClick={() => setPubkyRecoveryCode('')}>
            {t('modals.cancel')}
          </Button>
        </Buttons>
      </Modal>
    </>
  )
}

export default Sync
