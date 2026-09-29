import { useContext, useEffect, useState, useSyncExternalStore } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { save } from '@tauri-apps/plugin-dialog'
import { writeTextFile } from '@tauri-apps/plugin-fs'
import toast from 'react-hot-toast'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemText from '@mui/material/ListItemText'
import ListItemIcon from '@mui/material/ListItemIcon'
import BrushIcon from '@mui/icons-material/Brush'
import SecurityIcon from '@mui/icons-material/Security'
import BackupIcon from '@mui/icons-material/Backup'
import InfoIcon from '@mui/icons-material/Info'
import SyncIcon from '@mui/icons-material/Sync'
import BugReportIcon from '@mui/icons-material/BugReport'
import DescriptionIcon from '@mui/icons-material/Description'
import { developerSettingsEnabled, subscribeDeveloperSettings } from '~/utils/developerSettings'
import { exportDiagnostics } from '~/utils/diagnostics'

import { AppBarTitleContext } from '~/context'
import ListItem from '~/components/ListItem'
import SettingsPage from '~/components/SettingsPage'

const Settings = () => {
  const { t } = useTranslation()
  const { setAppBarTitle } = useContext(AppBarTitleContext)
  const navigate = useNavigate()
  const [exportingDiagnostics, setExportingDiagnostics] = useState(false)
  const showDeveloperSettings = useSyncExternalStore(
    subscribeDeveloperSettings,
    developerSettingsEnabled,
  )

  useEffect(() => {
    setAppBarTitle(t('settings.pageTitle'))
  }, [])

  const saveDiagnostics = async () => {
    if (exportingDiagnostics) return
    setExportingDiagnostics(true)
    try {
      const path = await save({
        defaultPath: 'tauthy-logs.txt',
        filters: [{ name: 'Text', extensions: ['txt'] }],
      })
      if (!path) return
      await writeTextFile(path, await exportDiagnostics())
      toast.success(t('diagnostics.exported'))
    } catch {
      toast.error(t('diagnostics.exportFailed'))
    } finally {
      setExportingDiagnostics(false)
    }
  }

  return (
    <SettingsPage>
      <List>
        <ListItem disablePadding onClick={() => navigate('/appearance')}>
          <ListItemButton>
            <ListItemIcon>
              <BrushIcon color="primary" />
            </ListItemIcon>
            <ListItemText
              primary={t('settings.appearance')}
              secondary={t('settings.appearanceDescription')}
            />
          </ListItemButton>
        </ListItem>

        <ListItem disablePadding onClick={() => navigate('/security')}>
          <ListItemButton>
            <ListItemIcon>
              <SecurityIcon color="primary" />
            </ListItemIcon>
            <ListItemText
              primary={t('settings.security')}
              secondary={t('settings.securityDescription')}
            />
          </ListItemButton>
        </ListItem>

        <ListItem disablePadding onClick={() => navigate('/import')}>
          <ListItemButton>
            <ListItemIcon>
              <BackupIcon color="primary" />
            </ListItemIcon>
            <ListItemText
              primary={t('settings.import')}
              secondary={t('settings.importDescription')}
            />
          </ListItemButton>
        </ListItem>

        <ListItem disablePadding onClick={() => navigate('/sync')}>
          <ListItemButton>
            <ListItemIcon>
              <SyncIcon color="primary" />
            </ListItemIcon>
            <ListItemText primary={t('settings.sync')} secondary={t('settings.syncDescription')} />
          </ListItemButton>
        </ListItem>

        <ListItem disablePadding onClick={() => !exportingDiagnostics && void saveDiagnostics()}>
          <ListItemButton disabled={exportingDiagnostics}>
            <ListItemIcon>
              <DescriptionIcon color="primary" />
            </ListItemIcon>
            <ListItemText
              primary={t('diagnostics.export')}
              secondary={t('diagnostics.description')}
            />
          </ListItemButton>
        </ListItem>

        {showDeveloperSettings && (
          <ListItem disablePadding onClick={() => navigate('/developer')}>
            <ListItemButton>
              <ListItemIcon>
                <BugReportIcon color="primary" />
              </ListItemIcon>
              <ListItemText primary={t('developer.pageTitle')} />
            </ListItemButton>
          </ListItem>
        )}

        <ListItem disablePadding onClick={() => navigate('/about')}>
          <ListItemButton>
            <ListItemIcon>
              <InfoIcon color="primary" />
            </ListItemIcon>
            <ListItemText primary={t('appBar.about')} secondary={t('settings.aboutDescription')} />
          </ListItemButton>
        </ListItem>
      </List>
    </SettingsPage>
  )
}

export default Settings
