import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemText from '@mui/material/ListItemText'
import ListItemIcon from '@mui/material/ListItemIcon'
import Box from '@mui/material/Box'
import LinkIcon from '@mui/icons-material/Link'

import { ImportFormat, ImportPreview, prepareImport } from '~/utils'
import Modal from '~/components/Modal'
import ListItem from '~/components/ListItem'
import ImportPasswordModal from '~/components/modals/ImportPassword'
import twoFasIcon from '../../../assets/import-providers/2fas.svg'
import aegisIcon from '../../../assets/import-providers/aegis.svg'
import andOtpIcon from '../../../assets/import-providers/andotp.svg'
import authyIcon from '../../../assets/import-providers/authy.svg'
import enteIcon from '../../../assets/import-providers/ente.svg'
import bitwardenIcon from '../../../assets/import-providers/bitwarden.svg'
import protonIcon from '../../../assets/import-providers/proton.svg'
import tauthyIcon from '../../../assets/import-providers/tauthy.svg'

const importFormats: ImportFormat[] = [
  '2fas',
  'aegis',
  'andotp',
  'authy',
  'bitwarden',
  'ente',
  'proton',
  'tauthy',
  'otpauth',
]
const providerIcons: Partial<Record<ImportFormat, string>> = {
  '2fas': twoFasIcon,
  aegis: aegisIcon,
  andotp: andOtpIcon,
  authy: authyIcon,
  ente: enteIcon,
  bitwarden: bitwardenIcon,
  proton: protonIcon,
  tauthy: tauthyIcon,
}

const knownImportErrors = [
  'importEncryptedCorrupt',
  'importEncryptedAuthenticationFailed',
  'importEncryptedNoPasswordKey',
  'importEncryptedUnsupported',
  'importEncryptedWrongPassword',
  'importTauthyDuplicateIds',
  'importTauthyIdConflict',
  'importTauthyNewerVersion',
  'importIdConflict',
  'importUnsupportedOtp',
  'importOtpAuthTooLarge',
  'importOtpAuthTooMany',
  'importFailed',
]
const formatNames: Record<ImportFormat, string> = {
  '2fas': '2FAS',
  aegis: 'Aegis',
  andotp: 'andOTP',
  authy: 'Authy',
  ente: 'Ente Auth',
  bitwarden: 'Bitwarden',
  proton: 'Proton Authenticator',
  google: 'Google Authenticator',
  tauthy: 'Tauthy',
  otpauth: 'Authenticator links (.txt)',
}

const ImportModal = ({
  open,
  onClose,
  onReview,
}: {
  open: boolean
  onClose: () => void
  onReview: (preview: ImportPreview) => void
}) => {
  const { t } = useTranslation()
  const formatName = (value: ImportFormat) =>
    value === 'otpauth' ? t('import.otpAuth') : formatNames[value]
  const inputRef = useRef<HTMLInputElement>(null)
  const [format, setFormat] = useState<ImportFormat>()
  const [pendingEncryptedImport, setPendingEncryptedImport] = useState<{
    file: File
    format: ImportFormat
  }>()
  const [passwordError, setPasswordError] = useState<string>()
  const [isDecrypting, setIsDecrypting] = useState(false)

  const handleClick = (format: ImportFormat) => {
    setFormat(format)
    if (inputRef.current)
      inputRef.current.accept = format === 'otpauth' ? '.txt,.uris' : '.json,.2fas,.tauthy'
    inputRef.current?.click()
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
      onReview(
        await prepareImport(pendingEncryptedImport.file, pendingEncryptedImport.format, password),
      )
      closePasswordPrompt()
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
      <Modal open={open && !pendingEncryptedImport} onClose={onClose}>
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
                  onReview(await prepareImport(file, format))
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
            {importFormats.map((provider) => (
              <ListItem key={provider} disablePadding>
                <ListItemButton onClick={() => handleClick(provider)} sx={{ minHeight: 56 }}>
                  <ListItemIcon sx={{ minWidth: 48 }}>
                    <Box
                      aria-hidden="true"
                      sx={{
                        width: 32,
                        height: 32,
                        borderRadius: '8px',
                        overflow: 'hidden',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        bgcolor: provider === 'otpauth' ? 'action.hover' : '#fff',
                        color: 'text.secondary',
                      }}
                    >
                      {providerIcons[provider] ? (
                        <Box
                          component="img"
                          src={providerIcons[provider]}
                          alt=""
                          sx={{
                            width: provider === '2fas' || provider === 'authy' ? 24 : 32,
                            height: provider === '2fas' || provider === 'authy' ? 24 : 32,
                            objectFit: 'contain',
                          }}
                        />
                      ) : (
                        <LinkIcon fontSize="small" />
                      )}
                    </Box>
                  </ListItemIcon>
                  <ListItemText primary={formatName(provider)} />
                </ListItemButton>
              </ListItem>
            ))}
          </List>
        </>
      </Modal>
      <ImportPasswordModal
        open={!!pendingEncryptedImport}
        formatName={pendingEncryptedImport ? formatName(pendingEncryptedImport.format) : ''}
        busy={isDecrypting}
        error={passwordError}
        onClose={closePasswordPrompt}
        onSubmit={submitImportPassword}
      />
    </>
  )
}

export default ImportModal
