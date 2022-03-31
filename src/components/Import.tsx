import { useEffect, useContext, useState } from 'react'
import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation()
  const { setAppBarTitle } = useContext(AppBarTitleContext)
  const [isImportModalOpen, setIsImportModalOpen] = useState(false)
  const [isResetModalOpen, setIsResetModalOpen] = useState(false)

  const handleOpenImportModal = () => setIsImportModalOpen(true)
  const handleCloseImportModal = () => setIsImportModalOpen(false)
  const handleOpenResetModal = () => setIsResetModalOpen(true)
  const handleCloseResetModal = () => setIsResetModalOpen(false)

  const handleExportVault = async () => {
    try {
      await exportCodes()
      toast.success(t('toasts.exported'))
    } catch (err) {
      console.error(err)
      toast.error(t('toasts.emptyExport'))
    }
  }

  useEffect(() => {
    setAppBarTitle(t('import.pageTitle'))
  }, [])

  return (
    <>
      <List>
        <ListItem disablePadding onClick={handleOpenImportModal}>
          <ListItemButton>
            <ListItemText primary={t('import.import')} secondary={t('import.importDescription')} />
          </ListItemButton>
        </ListItem>

        <ListItem disablePadding onClick={handleExportVault}>
          <ListItemButton>
            <ListItemText primary={t('import.export')} secondary={t('import.exportDescription')} />
          </ListItemButton>
        </ListItem>

        <ListItem disablePadding onClick={handleOpenResetModal}>
          <ListItemButton>
            <ListItemText primary={t('import.reset')} secondary={t('import.resetDescription')} />
          </ListItemButton>
        </ListItem>
      </List>

      <ImportModal open={isImportModalOpen} onClose={handleCloseImportModal} />
      <ResetModal open={isResetModalOpen} onClose={handleCloseResetModal} />
    </>
  )
}

export default Import
