import { useEffect, useContext, useState } from 'react'
import toast from 'react-hot-toast'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemText from '@mui/material/ListItemText'

import { AppBarTitleContext } from '~/context'
import { exportCodes } from '~/utils'
import ListItem from '~/components/ListItem'
import ImportModal from '~/components/modals/Import'
import ResetModal from '~/components/modals/Reset'

const Import = () => {
  const { setAppBarTitle } = useContext(AppBarTitleContext)
  const [isImportModalOpen, setIsImportModalOpen] = useState(false)
  const [isResetModalOpen, setIsResetModalOpen] = useState(false)

  const handleOpenImportModal = () => setIsImportModalOpen(true)
  const handleCloseImportModal = () => setIsImportModalOpen(false)
  const handleOpenResetModal = () => setIsResetModalOpen(true)
  const handleCloseResetModal = () => setIsResetModalOpen(false)

  const handleExportVault = async () => {
    try {
      const response = await exportCodes()
      toast.success(response)
    } catch (err) {
      console.error(err)
      toast.error('Nothing to export.')
    }
  }

  useEffect(() => {
    setAppBarTitle('Import & Export')
  }, [])

  return (
    <>
      <List>
        <ListItem disablePadding onClick={handleOpenImportModal}>
          <ListItemButton>
            <ListItemText primary="Import" secondary="Import backups from other apps" />
          </ListItemButton>
        </ListItem>

        <ListItem disablePadding onClick={handleExportVault}>
          <ListItemButton>
            <ListItemText primary="Export" secondary="Backup your vault" />
          </ListItemButton>
        </ListItem>

        <ListItem disablePadding onClick={handleOpenResetModal}>
          <ListItemButton>
            <ListItemText primary="Reset Vault" secondary="Delete your vault" />
          </ListItemButton>
        </ListItem>
      </List>

      <ImportModal open={isImportModalOpen} onClose={handleCloseImportModal} />
      <ResetModal open={isResetModalOpen} onClose={handleCloseResetModal} />
    </>
  )
}

export default Import
