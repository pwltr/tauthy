import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemText from '@mui/material/ListItemText'
import Typography from '@mui/material/Typography'

import {
  commitOtpAuthImport,
  importFile,
  ImportFormat,
  OtpAuthImportPreview,
  prepareOtpAuthImport,
} from '~/utils'
import Modal, { Buttons } from '~/components/Modal'
import ListItem from '~/components/ListItem'
import ImportPasswordModal from '~/components/modals/ImportPassword'

const knownImportErrors = [
  'import2FasEncrypted',
  'importEncryptedCorrupt',
  'importEncryptedAuthenticationFailed',
  'importEncryptedNoPasswordKey',
  'importEncryptedUnsupported',
  'importEncryptedWrongPassword',
  'importTauthyDuplicateIds',
  'importTauthyIdConflict',
  'importTauthyNewerVersion',
  'importUnsupportedOtp',
  'importOtpAuthTooLarge',
  'importOtpAuthTooMany',
  'importFailed',
]

const formatNames: Record<ImportFormat, string> = {
  '2fas': '2FAS',
  aegis: 'Aegis',
  authy: 'Authy',
  google: 'Google Authenticator',
  tauthy: 'Tauthy',
  otpauth: 'OTPAuth',
}

const ImportModal = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const inputRef = useRef<HTMLInputElement>(null)
  const [format, setFormat] = useState<ImportFormat>()
  const [pendingEncryptedImport, setPendingEncryptedImport] = useState<{
    file: File
    format: ImportFormat
  }>()
  const [passwordError, setPasswordError] = useState<string>()
  const [isDecrypting, setIsDecrypting] = useState(false)
  const [otpAuthPreview, setOtpAuthPreview] = useState<OtpAuthImportPreview>()
  const [isImporting, setIsImporting] = useState(false)

  const handleClick = (format: ImportFormat) => {
    setFormat(format)
    if (inputRef.current)
      inputRef.current.accept = format === 'otpauth' ? '.txt,.uris' : '.json,.2fas,.tauthy'
    inputRef.current?.click()
  }

  const finishImport = () => {
    toast.success(t('toasts.imported'))
    setPendingEncryptedImport(undefined)
    setPasswordError(undefined)
    setOtpAuthPreview(undefined)
    navigate('/')
  }

  const confirmOtpAuthImport = async () => {
    if (!otpAuthPreview || isImporting) return
    setIsImporting(true)
    try {
      await commitOtpAuthImport(otpAuthPreview.entries)
      finishImport()
    } catch (err) {
      showImportError(err)
    } finally {
      setIsImporting(false)
    }
  }

  const showImportError = (err: unknown) => {
    const error =
      err instanceof Error && knownImportErrors.includes(err.message) ? err.message : 'importFailed'
    toast.error(t(`toasts.${error}`))
  }

  const closePasswordPrompt = () => {
    setPendingEncryptedImport(undefined)
    setPasswordError(undefined)
  }

  const submitImportPassword = async (password: string) => {
    if (!pendingEncryptedImport) return
    setIsDecrypting(true)
    setPasswordError(undefined)
    try {
      await importFile(pendingEncryptedImport.file, pendingEncryptedImport.format, password)
      finishImport()
    } catch (err) {
      if (
        err instanceof Error &&
        ['importEncryptedWrongPassword', 'importEncryptedAuthenticationFailed'].includes(
          err.message,
        )
      ) {
        setPasswordError(t(`toasts.${err.message}`))
      } else {
        closePasswordPrompt()
        showImportError(err)
      }
    } finally {
      setIsDecrypting(false)
    }
  }

  return (
    <>
      <Modal open={open && !pendingEncryptedImport && !otpAuthPreview} onClose={onClose}>
        <>
          <input
            ref={inputRef}
            type="file"
            accept=".json,.2fas,.tauthy"
            style={{ display: 'none' }}
            onChange={async (event) => {
              const input = event.currentTarget
              const file = input.files?.[0]
              if (format && file) {
                try {
                  if (format === 'otpauth') {
                    setOtpAuthPreview(await prepareOtpAuthImport(file))
                  } else {
                    await importFile(file, format)
                    finishImport()
                  }
                } catch (err) {
                  if (err instanceof Error && err.message === 'importPasswordRequired') {
                    setPendingEncryptedImport({ file, format })
                  } else {
                    showImportError(err)
                  }
                } finally {
                  input.value = ''
                }
              }
            }}
          />

          <List disablePadding>
            <ListItem disablePadding onClick={() => handleClick('2fas')}>
              <ListItemButton>
                <ListItemText primary="2FAS" />
              </ListItemButton>
            </ListItem>

            <ListItem disablePadding onClick={() => handleClick('aegis')}>
              <ListItemButton>
                <ListItemText primary="Aegis" />
              </ListItemButton>
            </ListItem>

            <ListItem disablePadding onClick={() => handleClick('authy')}>
              <ListItemButton>
                <ListItemText primary="Authy" />
              </ListItemButton>
            </ListItem>

            {/* <ListItem disablePadding onClick={() => handleClick("google")}>
              <ListItemButton>
                <ListItemText primary="Google Authenticator" />
              </ListItemButton>
            </ListItem> */}

            <ListItem disablePadding onClick={() => handleClick('tauthy')}>
              <ListItemButton>
                <ListItemText primary="Tauthy" />
              </ListItemButton>
            </ListItem>

            <ListItem disablePadding onClick={() => handleClick('otpauth')}>
              <ListItemButton>
                <ListItemText
                  primary={t('import.otpAuth')}
                  secondary={t('import.otpAuthDescription')}
                />
              </ListItemButton>
            </ListItem>
          </List>
        </>
      </Modal>
      <Modal open={!!otpAuthPreview} onClose={() => !isImporting && setOtpAuthPreview(undefined)}>
        <>
          <Typography variant="h6" component="h2" gutterBottom>
            {t('modals.otpAuthPreviewTitle')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('modals.otpAuthPreviewCounts', {
              total: otpAuthPreview?.entries.length ?? 0,
              newCount: otpAuthPreview?.newCount ?? 0,
              duplicateCount: otpAuthPreview?.duplicateCount ?? 0,
            })}
          </Typography>
          <Box sx={{ maxHeight: 240, overflowY: 'auto', mt: 2 }}>
            {otpAuthPreview?.entries.map((entry) => (
              <Box key={entry.uuid} sx={{ py: 0.5 }}>
                <Typography variant="body2">{entry.issuer || entry.name}</Typography>
                {entry.issuer && (
                  <Typography variant="body2" color="text.secondary">
                    {entry.name}
                  </Typography>
                )}
              </Box>
            ))}
          </Box>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
            {otpAuthPreview?.newCount ? t('modals.otpAuthPreviewNotice') : t('modals.otpAuthNoNew')}
          </Typography>
          <Buttons>
            <Button disabled={isImporting} onClick={() => setOtpAuthPreview(undefined)}>
              {t('modals.cancel')}
            </Button>
            <Button
              variant="contained"
              loading={isImporting}
              disabled={!otpAuthPreview?.newCount}
              onClick={() => void confirmOtpAuthImport()}
            >
              {t('modals.import')}
            </Button>
          </Buttons>
        </>
      </Modal>
      <ImportPasswordModal
        open={!!pendingEncryptedImport}
        formatName={pendingEncryptedImport ? formatNames[pendingEncryptedImport.format] : ''}
        busy={isDecrypting}
        error={passwordError}
        onClose={closePasswordPrompt}
        onSubmit={submitImportPassword}
      />
    </>
  )
}

export default ImportModal
