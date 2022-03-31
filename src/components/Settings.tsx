import { useContext, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemText from '@mui/material/ListItemText'
import ListItemIcon from '@mui/material/ListItemIcon'
import BrushIcon from '@mui/icons-material/Brush'
import SecurityIcon from '@mui/icons-material/Security'
import BackupIcon from '@mui/icons-material/Backup'

import { AppBarTitleContext } from '~/context'
import ListItem from '~/components/ListItem'

const Settings = () => {
  const { t } = useTranslation()
  const { setAppBarTitle } = useContext(AppBarTitleContext)
  const navigate = useNavigate()

  useEffect(() => {
    setAppBarTitle('Settings')
  }, [])

  return (
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

      {/* <ListItem disablePadding onClick={() => navigate('/security')}>
        <ListItemButton>
          <ListItemIcon>
            <SecurityIcon color="primary" />
          </ListItemIcon>
          <ListItemText
            primary={t('settings.security')}
            secondary={t('settings.securityDescription')}
          />
        </ListItemButton>
      </ListItem> */}

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
    </List>
  )
}

export default Settings
