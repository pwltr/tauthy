import { useTranslation } from 'react-i18next'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogTitle from '@mui/material/DialogTitle'
import LinearProgress from '@mui/material/LinearProgress'
import Typography from '@mui/material/Typography'
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded'
import SystemUpdateRoundedIcon from '@mui/icons-material/SystemUpdateRounded'
import ReactMarkdown from 'react-markdown'

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
      PaperProps={{
        sx: {
          borderRadius: 3,
          backgroundImage: 'none',
        },
      }}
    >
      <DialogTitle
        id="updater-title"
        sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 3, pt: 3, pb: 1.5 }}
      >
        <Box
          sx={{
            alignItems: 'center',
            bgcolor: 'primary.main',
            borderRadius: 2,
            color: 'primary.contrastText',
            display: 'flex',
            flexShrink: 0,
            height: 42,
            justifyContent: 'center',
            width: 42,
          }}
        >
          <SystemUpdateRoundedIcon />
        </Box>
        <Box>
          <Typography component="span" variant="h6" fontWeight={700}>
            {t('updater.title')}
          </Typography>
          {update && (
            <Typography component="div" variant="body2" color="text.secondary">
              {t('updater.version', { version: update.version })}
            </Typography>
          )}
        </Box>
      </DialogTitle>
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
              <Box
                sx={{
                  bgcolor: 'action.hover',
                  border: 1,
                  borderColor: 'divider',
                  borderRadius: 2,
                  maxHeight: 260,
                  mt: 2.5,
                  overflowY: 'auto',
                  p: 2,
                  '& h1, & h2, & h3': {
                    fontSize: '0.95rem',
                    lineHeight: 1.4,
                    mb: 0.75,
                    mt: 1.5,
                  },
                  '& h1:first-of-type, & h2:first-of-type, & h3:first-of-type': { mt: 0 },
                  '& p': { fontSize: '0.875rem', lineHeight: 1.55, mb: 1, mt: 0 },
                  '& p:last-child': { mb: 0 },
                  '& ul, & ol': { my: 0.75, pl: 2.5 },
                  '& li': { fontSize: '0.875rem', lineHeight: 1.55, mb: 0.5 },
                  '& a': { color: 'primary.main' },
                  '& code': {
                    bgcolor: 'action.selected',
                    borderRadius: 0.75,
                    fontSize: '0.8rem',
                    px: 0.5,
                    py: 0.25,
                  },
                }}
              >
                <Typography component="h3" variant="subtitle2" sx={{ mb: 1 }}>
                  {t('updater.releaseNotes')}
                </Typography>
                <ReactMarkdown>{releaseNotes}</ReactMarkdown>
              </Box>
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
        <DialogActions sx={{ gap: 1, px: 3, pb: 3, pt: 1.5 }}>
          <Button variant="outlined" color="inherit" fullWidth onClick={onDismiss}>
            {t('updater.later')}
          </Button>
          <Button
            variant="contained"
            fullWidth
            startIcon={<DownloadRoundedIcon />}
            onClick={onInstall}
          >
            {status === 'error' ? t('updater.retry') : t('updater.update')}
          </Button>
        </DialogActions>
      )}
    </Dialog>
  )
}

export default Updater
