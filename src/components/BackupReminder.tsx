import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Stack from '@mui/material/Stack'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useBackupStatus } from '~/hooks/useBackupStatus'

const BackupReminder = () => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const status = useBackupStatus()
  if (!status?.reminder) return null
  return (
    <Alert severity="info" sx={{ mx: 2, mt: 1 }} onClose={status.dismiss}>
      {t('backup.reminder')}
      <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
        <Button
          size="small"
          onClick={() => navigate('/import', { state: { encryptedExport: true } })}
        >
          {t('backup.export')}
        </Button>
        <Button size="small" onClick={status.snooze}>
          {t('backup.later')}
        </Button>
      </Stack>
    </Alert>
  )
}
export default BackupReminder
