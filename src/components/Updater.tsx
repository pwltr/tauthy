import { useTranslation } from 'react-i18next'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogTitle from '@mui/material/DialogTitle'
import LinearProgress from '@mui/material/LinearProgress'
import Typography from '@mui/material/Typography'

import type { UpdaterStatus } from '~/hooks/useUpdater'
import type { Update } from '@tauri-apps/plugin-updater'

interface UpdaterProps {
  update: Update | null
  status: UpdaterStatus
  downloadedBytes: number
  contentLength: number | null
  error: string | null
  onInstall: () => void
  onDismiss: () => void
}

const Updater = ({
  update,
  status,
  downloadedBytes,
  contentLength,
  error,
  onInstall,
  onDismiss,
}: UpdaterProps) => {
  const { t } = useTranslation()
  const isBusy = status === 'downloading' || status === 'installing'
  const progress = contentLength
    ? Math.min(100, Math.round((downloadedBytes / contentLength) * 100))
    : null
  const releaseNotes = update?.body?.trim()

  return (
    <Dialog
      open={status !== 'idle'}
      onClose={isBusy ? undefined : onDismiss}
      aria-labelledby="updater-title"
      fullWidth
      maxWidth="xs"
    >
      <DialogTitle id="updater-title">{t('updater.title')}</DialogTitle>
      <DialogContent>
        {update && status === 'available' && (
          <>
            <DialogContentText>
              {t('updater.available', {
                version: update.version,
                currentVersion: update.currentVersion,
              })}
            </DialogContentText>
            <DialogContentText sx={{ mt: 2 }}>{t('updater.installPrompt')}</DialogContentText>
            {releaseNotes && (
              <>
                <Typography component="h3" variant="subtitle2" sx={{ mt: 2 }}>
                  {t('updater.releaseNotes')}
                </Typography>
                <Typography variant="body2" sx={{ mt: 0.5, whiteSpace: 'pre-wrap' }}>
                  {releaseNotes}
                </Typography>
              </>
            )}
          </>
        )}

        {status === 'downloading' && (
          <>
            <DialogContentText sx={{ mb: 2 }}>
              {progress === null
                ? t('updater.downloading')
                : t('updater.downloadingProgress', { progress })}
            </DialogContentText>
            <LinearProgress
              aria-label={t('updater.downloadProgress')}
              variant={progress === null ? 'indeterminate' : 'determinate'}
              value={progress ?? undefined}
            />
          </>
        )}

        {status === 'installing' && (
          <>
            <DialogContentText sx={{ mb: 2 }}>{t('updater.installing')}</DialogContentText>
            <LinearProgress aria-label={t('updater.installProgress')} />
          </>
        )}

        {status === 'error' && (
          <Alert severity="error">
            {t('updater.error')}
            {error && ` ${error}`}
          </Alert>
        )}
      </DialogContent>

      {!isBusy && (
        <DialogActions>
          <Button onClick={onDismiss}>{t('updater.later')}</Button>
          <Button variant="contained" onClick={onInstall}>
            {status === 'error' ? t('updater.retry') : t('updater.update')}
          </Button>
        </DialogActions>
      )}
    </Dialog>
  )
}

export default Updater
