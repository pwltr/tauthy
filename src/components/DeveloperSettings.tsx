import { useContext, useEffect, useState, useSyncExternalStore } from 'react'
import { confirm } from '@tauri-apps/plugin-dialog'
import { Navigate, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import Button from '@mui/material/Button'
import Divider from '@mui/material/Divider'
import toast from 'react-hot-toast'
import { AppBarTitleContext } from '~/context'
import { developerSettingsEnabled, subscribeDeveloperSettings } from '~/utils/developerSettings'
import { BACKUP_STATUS_EVENT, BACKUP_STATUS_KEY, WEEK_MS } from '~/utils/backupStatus'
import SettingsPage from '~/components/SettingsPage'
import { wipeApp } from '~/utils/wipeApp'

const DeveloperSettings = () => {
  const { t } = useTranslation()
  const { setAppBarTitle } = useContext(AppBarTitleContext)
  const navigate = useNavigate()
  const enabled = useSyncExternalStore(subscribeDeveloperSettings, developerSettingsEnabled)
  const [wiping, setWiping] = useState(false)

  useEffect(() => {
    setAppBarTitle(t('developer.pageTitle'))
  }, [setAppBarTitle, t])

  if (!enabled) return <Navigate to="/settings" replace />

  const previewBackupReminder = () => {
    try {
      localStorage.setItem(
        BACKUP_STATUS_KEY,
        JSON.stringify({ firstSeenAt: Date.now() - WEEK_MS - 24 * 60 * 60 * 1000 }),
      )
      window.dispatchEvent(new Event(BACKUP_STATUS_EVENT))
      navigate('/')
    } catch {
      toast.error(t('developer.previewFailed'))
    }
  }

  const handleWipe = async () => {
    if (wiping) return
    setWiping(true)
    try {
      const confirmed = await confirm(t('developer.wipeWarning'), {
        title: t('developer.wipeApp'),
        kind: 'warning',
        okLabel: t('developer.wipeApp'),
        cancelLabel: t('modals.cancel'),
      })
      if (confirmed) await wipeApp()
    } catch {
      toast.error(t('developer.wipeFailed'))
    } finally {
      setWiping(false)
    }
  }

  return (
    <SettingsPage>
      <Stack spacing={2} sx={{ p: 2 }}>
        <Typography variant="body2">{t('developer.backupDescription')}</Typography>
        <Button variant="outlined" onClick={previewBackupReminder} sx={{ alignSelf: 'flex-start' }}>
          {t('developer.previewBackup')}
        </Button>
        <Divider />
        <Typography variant="body2">{t('developer.wipeDescription')}</Typography>
        <Button
          color="error"
          variant="outlined"
          disabled={wiping}
          onClick={handleWipe}
          sx={{ alignSelf: 'flex-start' }}
        >
          {t('developer.wipeApp')}
        </Button>
      </Stack>
    </SettingsPage>
  )
}

export default DeveloperSettings
