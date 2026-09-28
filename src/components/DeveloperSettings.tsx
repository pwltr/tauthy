import { useContext, useEffect, useSyncExternalStore } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import Button from '@mui/material/Button'
import toast from 'react-hot-toast'
import { AppBarTitleContext } from '~/context'
import { developerSettingsEnabled, subscribeDeveloperSettings } from '~/utils/developerSettings'
import { BACKUP_STATUS_EVENT, BACKUP_STATUS_KEY, WEEK_MS } from '~/utils/backupStatus'
import SettingsPage from '~/components/SettingsPage'

const DeveloperSettings = () => {
  const { t } = useTranslation()
  const { setAppBarTitle } = useContext(AppBarTitleContext)
  const navigate = useNavigate()
  const enabled = useSyncExternalStore(subscribeDeveloperSettings, developerSettingsEnabled)

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

  return (
    <SettingsPage>
      <Stack spacing={2} sx={{ p: 2 }}>
        <Typography variant="body2">{t('developer.backupDescription')}</Typography>
        <Button variant="outlined" onClick={previewBackupReminder} sx={{ alignSelf: 'flex-start' }}>
          {t('developer.previewBackup')}
        </Button>
      </Stack>
    </SettingsPage>
  )
}

export default DeveloperSettings
