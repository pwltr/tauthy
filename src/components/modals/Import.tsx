import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemText from '@mui/material/ListItemText'

import { importFile, ImportFormat } from '~/utils'
import Modal from '~/components/Modal'
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
  'importFailed',
]

const formatNames: Record<ImportFormat, string> = {
  '2fas': '2FAS',
  aegis: 'Aegis',
  authy: 'Authy',
  google: 'Google Authenticator',
  tauthy: 'Tauthy',
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

  const handleClick = (format: ImportFormat) => {
    setFormat(format)
    inputRef.current?.click()
  }

  const finishImport = () => {
    toast.success(t('toasts.imported'))
    setPendingEncryptedImport(undefined)
    setPasswordError(undefined)
    navigate('/')
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
                  await importFile(file, format)
                  finishImport()
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
          </List>
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
