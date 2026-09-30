import { useEffect, useContext, useRef, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import { confirm, message } from '@tauri-apps/plugin-dialog'
import { type } from '@tauri-apps/plugin-os'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemText from '@mui/material/ListItemText'

import { AppBarTitleContext } from '~/context'
import { exportCodes, type ImportPreview } from '~/utils'
import ListSection from '~/components/ListSection'
import ListItem from '~/components/ListItem'
import ImportModal from '~/components/modals/Import'
import ExportPasswordModal from '~/components/modals/ExportPassword'
import { traceImport } from '~/utils/importDiagnostics'
import { useBackupStatus } from '~/hooks/useBackupStatus'
import SettingsPage from '~/components/SettingsPage'

const Import = () => {
  const { t, i18n } = useTranslation()
  const { setAppBarTitle } = useContext(AppBarTitleContext)
  const location = useLocation()
  const navigate = useNavigate()
  const backupStatus = useBackupStatus()
  const [isImportModalOpen, setIsImportModalOpen] = useState(false)
  const [preview, setPreview] = useState<ImportPreview>()
  const [isExportPasswordModalOpen, setIsExportPasswordModalOpen] = useState(false)
  const [isExportingEncrypted, setIsExportingEncrypted] = useState(false)
  const [isChoosingExport, setIsChoosingExport] = useState(false)
  const choosingExport = useRef(false)

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

  const handleChooseExport = async () => {
    if (choosingExport.current) return
    choosingExport.current = true
    setIsChoosingExport(true)
    try {
      const encryptedLabel = t('import.exportEncrypted')
      const plaintextLabel = t('import.exportPlaintext')
      // macOS presents the title above stacked choices; other native dialogs
      // reserve a message area, which looks broken when its body is empty.
      const choice = await message(type() === 'macos' ? '' : t('import.exportDescription'), {
        title: t('import.exportTitle'),
        buttons: {
          yes: encryptedLabel,
          no: plaintextLabel,
          cancel: t('modals.cancel'),
        },
      })
      if (choice === encryptedLabel) setIsExportPasswordModalOpen(true)
      else if (choice === plaintextLabel) await handleExportPlaintext()
    } catch {
      toast.error(t('toasts.exportFailed'))
    } finally {
      choosingExport.current = false
      setIsChoosingExport(false)
    }
  }

  useEffect(() => {
    if (location.pathname === '/import') {
      setAppBarTitle(t('import.pageTitle'))
    }
  }, [location.pathname, setAppBarTitle, t])

  useEffect(() => {
    if (location.pathname === '/import') setPreview(undefined)
  }, [location.pathname])

  useEffect(() => {
    if (
      location.state?.encryptedExport ||
      location.state?.openImport ||
      location.state?.chooseExport
    ) {
      if (location.state.openImport) setIsImportModalOpen(true)
      if (location.state.encryptedExport) setIsExportPasswordModalOpen(true)
      if (location.state.chooseExport) void handleChooseExport()
      navigate(location.pathname, { replace: true, state: null })
    }
  }, [location.state, location.pathname, navigate])

  const reviewImport = (next: ImportPreview) => {
    traceImport('reviewNavigation')
    setPreview(next)
    setIsImportModalOpen(false)
    navigate('/import/review')
  }

  return (
    <>
      {location.pathname === '/import/review' ? (
        <Outlet context={{ preview }} />
      ) : (
        <SettingsPage>
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

              <ListItem disablePadding>
                <ListItemButton onClick={handleChooseExport} disabled={isChoosingExport}>
                  <ListItemText
                    primary={t('import.export')}
                    secondary={
                      backupStatus
                        ? `${t(`backup.${backupStatus.state}`)}${
                            backupStatus.exportedAt !== undefined
                              ? ` · ${new Date(backupStatus.exportedAt).toLocaleString(
                                  i18n?.language,
                                )}`
                              : ''
                          }`
                        : t('import.exportDescription')
                    }
                  />
                </ListItemButton>
              </ListItem>
            </ListSection>
          </List>
        </SettingsPage>
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
