import { useContext, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
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
            primary="Appearance"
            secondary="Change the theme or the density of entries."
          />
        </ListItemButton>
      </ListItem>

      {/* <ListItem disablePadding onClick={() => navigate("/security")}>
        <ListItemButton>
          <ListItemIcon>
            <SecurityIcon color="primary" />
          </ListItemIcon>
          <ListItemText
            primary="Security"
            secondary="Configure encryption and auto-lock"
          />
        </ListItemButton>
      </ListItem> */}

      <ListItem disablePadding onClick={() => navigate('/import')}>
        <ListItemButton>
          <ListItemIcon>
            <BackupIcon color="primary" />
          </ListItemIcon>
          <ListItemText
            primary="Import & Export"
            secondary="Import or create exports of your vault."
          />
        </ListItemButton>
      </ListItem>
    </List>
  )
}

export default Settings
