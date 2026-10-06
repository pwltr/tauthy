import { useCallback, useContext, useEffect, useRef, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'
import ImageOutlinedIcon from '@mui/icons-material/ImageOutlined'
import { type as osType } from '@tauri-apps/plugin-os'

import { AppBarTitleContext } from '~/context'
import SettingsPage from '~/components/SettingsPage'
import { prepareGoogleImport, type ImportPreview } from '~/utils'
import { recordDiagnostic } from '~/utils/diagnostics'
import {
  addGoogleTransferPart,
  completeGoogleTransfer,
  scanGoogleQrImage,
  type GoogleTransfer,
} from '~/utils/googleAuthenticator'

const knownErrors = [
  'importGoogleInvalidQr',
  'importGoogleInvalidImage',
  'importGoogleTooLarge',
  'importGoogleTooMany',
  'importGoogleDifferentTransfer',
  'importUnsupportedOtp',
]

const GoogleImport = () => {
  const { t } = useTranslation()
  const { setAppBarTitle } = useContext(AppBarTitleContext)
  const { onReview } = useOutletContext<{ onReview: (preview: ImportPreview) => void }>()
  const input = useRef<HTMLInputElement>(null)
  const transfer = useRef<GoogleTransfer | undefined>(undefined)
  const busy = useRef(false)
  const active = useRef(true)
  const [progress, setProgress] = useState<{ added: number; total: number }>()
  const [isReading, setIsReading] = useState(false)

  useEffect(() => setAppBarTitle(t('import.googleTitle')), [setAppBarTitle, t])
  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
    }
  }, [])

  const readImages = useCallback(
    async (images: File[]) => {
      if (busy.current || !images.length) return
      busy.current = true
      setIsReading(true)
      recordDiagnostic('import.start')
      try {
        for (const image of images) {
          const part = await scanGoogleQrImage(image)
          if (!active.current) return
          const next = addGoogleTransferPart(transfer.current, part)
          transfer.current = next
          setProgress({ added: next.parts.size, total: next.batchSize })
          const accounts = completeGoogleTransfer(next)
          if (accounts) {
            const preview = await prepareGoogleImport(accounts)
            if (active.current) onReview(preview)
            return
          }
        }
      } catch (error) {
        recordDiagnostic('import.error', error)
        const key =
          error instanceof Error && knownErrors.includes(error.message)
            ? error.message
            : 'importFailed'
        toast.error(t(`toasts.${key}`))
      } finally {
        busy.current = false
        if (active.current) setIsReading(false)
      }
    },
    [onReview, t],
  )

  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      const image = Array.from(event.clipboardData?.items ?? [])
        .find((item) => item.type.startsWith('image/'))
        ?.getAsFile()
      if (!image) return
      event.preventDefault()
      void readImages([image])
    }
    window.addEventListener('paste', handlePaste)
    return () => window.removeEventListener('paste', handlePaste)
  }, [readImages])

  return (
    <SettingsPage>
      <Box sx={{ px: 2, py: 3, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Typography variant="body2" color="text.secondary">
          {t('import.googleInstructions')}
        </Typography>
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          style={{ display: 'none' }}
          onChange={(event) => {
            const files = Array.from(event.currentTarget.files ?? [])
            event.currentTarget.value = ''
            void readImages(files)
          }}
        />
        <Button
          variant="contained"
          startIcon={<ImageOutlinedIcon />}
          disabled={isReading}
          onClick={() => input.current?.click()}
        >
          {t('import.googleChooseImages')}
        </Button>
        <Typography variant="body2" color="text.secondary" align="center">
          {t('import.googlePaste', {
            shortcut: osType() === 'macos' ? '⌘V' : t('import.googlePasteControl'),
          })}
        </Typography>
        {progress && (
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Typography variant="body2">{t('import.googleProgress', progress)}</Typography>
            <Button
              size="small"
              disabled={isReading}
              onClick={() => {
                transfer.current = undefined
                setProgress(undefined)
              }}
            >
              {t('import.googleStartOver')}
            </Button>
          </Box>
        )}
      </Box>
    </SettingsPage>
  )
}

export default GoogleImport
