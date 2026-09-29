import { useContext, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import { open } from '@tauri-apps/plugin-dialog'
import Box from '@mui/material/Box'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemText from '@mui/material/ListItemText'
import Typography from '@mui/material/Typography'

import { AppBarTitleContext } from '~/context'
import ListItem from '~/components/ListItem'
import SettingsPage from '~/components/SettingsPage'
import SyncPasswordModal from '~/components/modals/SyncPassword'
import { createSync, joinSync } from '~/utils/sync'

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

const FolderSync = () => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { setAppBarTitle } = useContext(AppBarTitleContext)
  const [pending, setPending] = useState<PendingAction>()
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setAppBarTitle(t('sync.folder'))
  }, [])

  const choose = async (mode: PendingAction['mode']) => {
    try {
      const path = await open({ multiple: false, directory: true })
      if (typeof path === 'string') setPending({ mode, path })
    } catch {
      toast.error(t('toasts.syncPickerFailed'))
    }
  }

  const configure = async (password: string) => {
    if (!pending) return
    setBusy(true)
    try {
      if (pending.mode === 'create') {
        await createSync(pending.path, password)
      } else {
        await joinSync(pending.path, password)
      }
      setPending(undefined)
      toast.success(t('toasts.syncConfigured'))
      navigate(-1)
    } catch (error) {
      toast.error(t(`toasts.${errorKey(error)}`))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <SettingsPage>
        <Box sx={{ px: 2, pt: 2 }}>
          <Typography variant="body2" color="text.secondary">
            {t('sync.folderSetupDescription')}
          </Typography>
        </Box>
        <List>
          <ListItem disablePadding onClick={() => void choose('create')}>
            <ListItemButton>
              <ListItemText primary={t('sync.create')} secondary={t('sync.createDescription')} />
            </ListItemButton>
          </ListItem>
          <ListItem disablePadding onClick={() => void choose('join')}>
            <ListItemButton>
              <ListItemText primary={t('sync.join')} secondary={t('sync.joinDescription')} />
            </ListItemButton>
          </ListItem>
        </List>
      </SettingsPage>
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

export default FolderSync
