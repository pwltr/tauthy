import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemText from '@mui/material/ListItemText'

import { importCodes, ImportFormat } from '~/utils'
import Modal from '~/components/Modal'
import ListItem from '~/components/ListItem'

const ImportModal = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const inputRef = useRef<HTMLInputElement>(null)
  const [format, setFormat] = useState<ImportFormat>()

  const handleClick = (format: ImportFormat) => {
    setFormat(format)
    inputRef.current?.click()
  }

  return (
    <Modal open={open} onClose={onClose}>
      <>
        <input
          ref={inputRef}
          type="file"
          accept=".json,.2fas"
          style={{ display: 'none' }}
          onChange={async (event) => {
            const input = event.currentTarget
            if (format) {
              try {
                await importCodes(event, format)
                toast.success(t('toasts.imported'))
                navigate('/')
              } catch (err) {
                const knownErrors = [
                  'import2FasEncrypted',
                  'importAegisEncrypted',
                  'importUnsupportedOtp',
                  'importFailed',
                ]
                const error =
                  err instanceof Error && knownErrors.includes(err.message)
                    ? err.message
                    : 'importFailed'
                toast.error(t(`toasts.${error}`))
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
  )
}

export default ImportModal
