import { useRef, useEffect, useContext, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemText from '@mui/material/ListItemText'

import { importCodes, ImportFormat } from '~/utils'
import { AppBarTitleContext } from '~/context'
import Modal from '~/components/Modal'
import ListItem from '~/components/ListItem'

const ImportModal = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
  const navigate = useNavigate()
  const { setAppBarTitle } = useContext(AppBarTitleContext)
  const inputRef = useRef<HTMLInputElement>(null)
  const [format, setFormat] = useState<ImportFormat>()

  useEffect(() => {
    setAppBarTitle('Select import')
  }, [])

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
          accept=".json"
          style={{ display: 'none' }}
          onChange={async (event) => {
            if (format) {
              await importCodes(event, format)
              toast.success('Vault imported')
              navigate('/')
            }
          }}
        />

        <List disablePadding>
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
