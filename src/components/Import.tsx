import { useEffect, useContext, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import { confirm } from '@tauri-apps/plugin-dialog'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemText from '@mui/material/ListItemText'

import { AppBarTitleContext } from '~/context'
import { exportCodes, type ImportPreview } from '~/utils'
import ListSection from '~/components/ListSection'
import ListItem from '~/components/ListItem'
import ImportModal from '~/components/modals/Import'
import ExportPasswordModal from '~/components/modals/ExportPassword'

const Import = () => {
  const { t } = useTranslation()
  const { setAppBarTitle } = useContext(AppBarTitleContext)
  const location = useLocation()
  const navigate = useNavigate()
  const [isImportModalOpen, setIsImportModalOpen] = useState(false)
  const [preview, setPreview] = useState<ImportPreview>()
  const [isExportPasswordModalOpen, setIsExportPasswordModalOpen] = useState(false)
  const [isExportingEncrypted, setIsExportingEncrypted] = useState(false)

  const handleOpenImportModal = () => setIsImportModalOpen(true)
  const handleCloseImportModal = () => setIsImportModalOpen(false)

  const showExportResult = async (password?: string) => {
    try {
      await exportCodes(password)
      toast.success(t('toasts.exportSuccess'))
      setIsExportPasswordModalOpen(false)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'exportFailed'
      toast.error(t(`toasts.${message}`))
    }
  }

  const handleExportEncrypted = async (password: string) => {
    setIsExportingEncrypted(true)
    try {
      await showExportResult(password)
    } finally {
      setIsExportingEncrypted(false)
      setIsExportPasswordModalOpen(false)
    }
  }

  const handleExportPlaintext = async () => {
    const confirmed = await confirm(t('modals.exportWarning'), {
      title: t('import.export'),
      kind: 'warning',
      okLabel: t('import.export'),
      cancelLabel: t('modals.cancel'),
    })

    if (!confirmed) return

    await showExportResult()
  }

  useEffect(() => {
    if (location.pathname === '/import') {
      setAppBarTitle(t('import.pageTitle'))
    }
  }, [location.pathname, setAppBarTitle, t])

  useEffect(() => {
    if (location.pathname === '/import') setPreview(undefined)
  }, [location.pathname])

  const reviewImport = (next: ImportPreview) => {
    setPreview(next)
    setIsImportModalOpen(false)
    navigate('/import/review')
  }

  return (
    <>
      {location.pathname === '/import/review' ? (
        <Outlet context={{ preview }} />
      ) : (
        <List>
          <ListSection>
            <ListItem disablePadding onClick={handleOpenImportModal}>
              <ListItemButton>
                <ListItemText
                  primary={t('import.import')}
                  secondary={t('import.importDescription')}
                />
              </ListItemButton>
            </ListItem>

            <ListItem disablePadding onClick={() => setIsExportPasswordModalOpen(true)}>
              <ListItemButton>
                <ListItemText
                  primary={t('import.exportEncrypted')}
                  secondary={t('import.exportEncryptedDescription')}
                />
              </ListItemButton>
            </ListItem>

            <ListItem disablePadding onClick={handleExportPlaintext}>
              <ListItemButton>
                <ListItemText
                  primary={t('import.exportPlaintext')}
                  secondary={t('import.exportPlaintextDescription')}
                />
              </ListItemButton>
            </ListItem>
          </ListSection>
        </List>
      )}

      <ImportModal
        open={isImportModalOpen && location.pathname === '/import'}
        onClose={handleCloseImportModal}
        onReview={reviewImport}
      />
      <ExportPasswordModal
        open={isExportPasswordModalOpen}
        busy={isExportingEncrypted}
        onClose={() => setIsExportPasswordModalOpen(false)}
        onSubmit={handleExportEncrypted}
      />
    </>
  )
}

export default Import
