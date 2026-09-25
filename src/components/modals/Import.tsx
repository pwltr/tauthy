import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import FileUploadOutlinedIcon from '@mui/icons-material/FileUploadOutlined'
import List from '@mui/material/List'
import MuiListItem from '@mui/material/ListItem'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemText from '@mui/material/ListItemText'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'

import { commitPreparedImport, ImportFormat, ImportPreview, prepareImport } from '~/utils'
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
  'importIdConflict',
  'importUnsupportedOtp',
  'importOtpAuthTooLarge',
  'importOtpAuthTooMany',
  'importFailed',
]
const PREVIEW_PAGE_SIZE = 8

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
  const [preview, setPreview] = useState<ImportPreview>()
  const [previewPage, setPreviewPage] = useState(0)
  const [isImporting, setIsImporting] = useState(false)

  const showPreview = (next: ImportPreview) => {
    setPreviewPage(0)
    setPreview(next)
  }

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
    setPreview(undefined)
    navigate('/')
  }

  const confirmImport = async () => {
    if (!preview || isImporting) return
    setIsImporting(true)
    try {
      await commitPreparedImport(preview)
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
      showPreview(
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

  const previewPageCount = preview ? Math.ceil(preview.entries.length / PREVIEW_PAGE_SIZE) : 0
  const visibleEntries = preview?.entries.slice(
    previewPage * PREVIEW_PAGE_SIZE,
    (previewPage + 1) * PREVIEW_PAGE_SIZE,
  )
  const duplicateIndices = new Set(preview?.duplicateIndices)

  return (
    <>
      <Modal open={open && !pendingEncryptedImport && !preview} onClose={onClose}>
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
                  showPreview(await prepareImport(file, format))
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
      <Modal open={!!preview} onClose={() => !isImporting && setPreview(undefined)}>
        <Box sx={{ width: 'min(100%, 460px)' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Box
              sx={{
                display: 'flex',
                p: 1,
                borderRadius: 2,
                bgcolor: 'action.hover',
                color: 'primary.main',
              }}
            >
              <FileUploadOutlinedIcon fontSize="small" />
            </Box>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="h6" component="h2">
                {t('modals.importPreviewTitle')}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
                {preview && `${formatNames[preview.format]} · ${preview.sourceName}`}
              </Typography>
            </Box>
          </Box>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 2, mb: 2 }}>
            <Chip
              size="small"
              label={t('modals.importPreviewTotal', { total: preview?.entries.length ?? 0 })}
            />
            <Chip
              size="small"
              color="primary"
              label={t('modals.importPreviewNew', { total: preview?.newCount ?? 0 })}
            />
            {!!preview?.duplicateCount && (
              <Chip
                size="small"
                variant="outlined"
                label={t('modals.importPreviewDuplicates', { total: preview.duplicateCount })}
              />
            )}
          </Box>
          <Paper
            variant="outlined"
            sx={{ borderRadius: 2, maxHeight: 'min(40vh, 320px)', overflowY: 'auto' }}
          >
            <List dense disablePadding>
              {visibleEntries?.map((entry, index) => {
                const duplicate = duplicateIndices.has(previewPage * PREVIEW_PAGE_SIZE + index)
                return (
                  <MuiListItem
                    key={`${entry.uuid}-${index}`}
                    divider={index < visibleEntries.length - 1}
                  >
                    <ListItemText
                      primary={
                        <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
                          {entry.issuer || entry.name}
                        </Typography>
                      }
                      secondary={
                        entry.issuer && (
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            noWrap
                            sx={{ display: 'block' }}
                          >
                            {entry.name}
                          </Typography>
                        )
                      }
                    />
                    {duplicate && (
                      <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                        {t('modals.importPreviewDuplicate')}
                      </Typography>
                    )}
                  </MuiListItem>
                )
              })}
            </List>
          </Paper>
          {previewPageCount > 1 && (
            <Box
              sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mt: 1 }}
            >
              <Button
                disabled={previewPage === 0}
                onClick={() => setPreviewPage((page) => page - 1)}
              >
                {t('modals.importPreviewPrevious')}
              </Button>
              <Typography variant="caption" color="text.secondary">
                {t('modals.importPreviewPage', { page: previewPage + 1, pages: previewPageCount })}
              </Typography>
              <Button
                disabled={previewPage === previewPageCount - 1}
                onClick={() => setPreviewPage((page) => page + 1)}
              >
                {t('modals.importPreviewNext')}
              </Button>
            </Box>
          )}
          {!preview?.newCount && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
              {t('modals.importNoNew')}
            </Typography>
          )}
          <Buttons>
            <Button disabled={isImporting} onClick={() => setPreview(undefined)}>
              {t('modals.cancel')}
            </Button>
            <Button
              variant="contained"
              loading={isImporting}
              disabled={!preview?.newCount}
              onClick={() => void confirmImport()}
            >
              {t('modals.import')}
            </Button>
          </Buttons>
        </Box>
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
