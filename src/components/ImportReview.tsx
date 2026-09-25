import { useContext, useEffect, useState } from 'react'
import { Navigate, useNavigate, useOutletContext } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import { alpha } from '@mui/material/styles'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import FileUploadOutlinedIcon from '@mui/icons-material/FileUploadOutlined'
import List from '@mui/material/List'
import ListItem from '@mui/material/ListItem'
import ListItemText from '@mui/material/ListItemText'
import Typography from '@mui/material/Typography'

import { AppBarBackContext, AppBarTitleContext } from '~/context'
import { commitPreparedImport, type ImportPreview } from '~/utils'

type ImportReviewContext = {
  preview?: ImportPreview
}

const formatNames = {
  '2fas': '2FAS',
  aegis: 'Aegis',
  authy: 'Authy',
  ente: 'Ente Auth',
  google: 'Google Authenticator',
  tauthy: 'Tauthy',
}

const ImportReview = () => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { setAppBarTitle } = useContext(AppBarTitleContext)
  const { setBackDisabled } = useContext(AppBarBackContext)
  const { preview } = useOutletContext<ImportReviewContext>()
  const [isImporting, setIsImporting] = useState(false)

  useEffect(() => {
    setAppBarTitle(t('modals.importPreviewTitle'))
  }, [setAppBarTitle, t])

  useEffect(() => () => setBackDisabled(false), [setBackDisabled])

  if (!preview) return <Navigate to="/import" replace />

  const duplicateIndices = new Set(preview.duplicateIndices)
  const formatName =
    preview.format === 'otpauth' ? t('import.otpAuth') : formatNames[preview.format]

  const cancelImport = () => {
    if (isImporting) return
    navigate('/import', { replace: true })
  }

  const confirmImport = async () => {
    if (isImporting) return
    setIsImporting(true)
    setBackDisabled(true)
    try {
      const addedCount = await commitPreparedImport(preview)
      toast.success(t(addedCount > 0 ? 'toasts.imported' : 'modals.importNoNew'))
      navigate('/', { replace: true })
    } catch (err) {
      const key =
        err instanceof Error && ['importIdConflict', 'importTauthyIdConflict'].includes(err.message)
          ? err.message
          : 'importFailed'
      toast.error(t(`toasts.${key}`))
    } finally {
      setIsImporting(false)
      setBackDisabled(false)
    }
  }

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minHeight: 0,
        width: '100%',
        maxWidth: 720,
        mx: 'auto',
        px: 2,
        py: 2,
      }}
    >
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
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
            {formatName}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
            {preview.sourceName}
          </Typography>
        </Box>
      </Box>

      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, my: 2 }}>
        <Chip
          size="small"
          label={t('modals.importPreviewTotal', { total: preview.entries.length })}
          sx={{ bgcolor: (theme) => alpha(theme.palette.text.primary, 0.1), color: 'text.primary' }}
        />
        <Chip
          size="small"
          color="primary"
          label={t('modals.importPreviewNew', { total: preview.newCount })}
        />
        {!!preview.duplicateCount && (
          <Chip
            size="small"
            label={t('modals.importPreviewDuplicates', { total: preview.duplicateCount })}
            sx={{
              bgcolor: (theme) => alpha(theme.palette.text.primary, 0.1),
              color: 'text.primary',
            }}
          />
        )}
      </Box>

      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        <List
          disablePadding
          sx={{ display: 'flex', flexDirection: 'column', gap: 0.75, py: 0.5, pr: 0.5 }}
        >
          {preview.entries.map((entry, index) => (
            <ListItem
              key={`${entry.uuid}-${index}`}
              sx={{
                borderRadius: 1.5,
                minHeight: 64,
                px: 1.5,
                bgcolor: (theme) => alpha(theme.palette.text.primary, 0.075),
              }}
            >
              <ListItemText
                primary={
                  <Typography variant="body1" sx={{ fontWeight: 600 }} noWrap>
                    {entry.issuer || entry.name}
                  </Typography>
                }
                secondary={
                  entry.issuer && (
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      noWrap
                      sx={{ display: 'block' }}
                    >
                      {entry.name}
                    </Typography>
                  )
                }
              />
              {duplicateIndices.has(index) && (
                <Chip
                  size="small"
                  label={t('modals.importPreviewDuplicate')}
                  sx={{
                    ml: 1,
                    color: 'text.secondary',
                    bgcolor: (theme) => alpha(theme.palette.text.primary, 0.1),
                  }}
                />
              )}
            </ListItem>
          ))}
        </List>
      </Box>

      {!preview.newCount && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
          {t('modals.importNoNew')}
        </Typography>
      )}
      <Box sx={{ display: 'flex', gap: 1.5, mt: 2 }}>
        <Button
          variant="outlined"
          color="inherit"
          fullWidth
          disabled={isImporting}
          onClick={cancelImport}
          sx={{
            minHeight: 44,
            textTransform: 'none',
            borderColor: (theme) => alpha(theme.palette.text.primary, 0.35),
          }}
        >
          {t('modals.cancel')}
        </Button>
        <Button
          variant="contained"
          color="primary"
          fullWidth
          loading={isImporting}
          disabled={!preview.newCount}
          onClick={() => void confirmImport()}
          sx={{ minHeight: 44 }}
        >
          {t('modals.import')}
        </Button>
      </Box>
    </Box>
  )
}

export default ImportReview
