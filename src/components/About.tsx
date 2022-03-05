import { useEffect, useContext } from 'react'
import { open } from '@tauri-apps/api/shell'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemText from '@mui/material/ListItemText'
import ListItemIcon from '@mui/material/ListItemIcon'
import ListSubheader from '@mui/material/ListSubheader'
import CodeIcon from '@mui/icons-material/Code'
import HistoryEduIcon from '@mui/icons-material/HistoryEdu'
import GitHubIcon from '@mui/icons-material/GitHub'
import VolunteerActivismIcon from '@mui/icons-material/VolunteerActivism'

import { AppBarTitleContext } from '~/context'
import ListItem from '~/components/ListItem'

const About = () => {
  const { setAppBarTitle } = useContext(AppBarTitleContext)

  useEffect(() => {
    setAppBarTitle('About')
  }, [])

  return (
    <>
      <List dense>
        {/* <ListItem>
          <ListItemButton>
            <ListItemIcon>
              <DraftsIcon color="primary" />
            </ListItemIcon>
            <ListItemText primary="Tauthy" />
          </ListItemButton>
        </ListItem> */}
        <ListItem disablePadding onClick={() => open('https://github.com/pwltr/tauthy/releases')}>
          <ListItemButton>
            <ListItemIcon>
              <CodeIcon color="primary" />
            </ListItemIcon>
            <ListItemText primary="Version" secondary="0.1.0" />
          </ListItemButton>
        </ListItem>

        <ListItem
          disablePadding
          onClick={() => open('https://github.com/pwltr/tauthy/blob/master/LICENSE')}
        >
          <ListItemButton>
            <ListItemIcon>
              <HistoryEduIcon color="primary" />
            </ListItemIcon>
            <ListItemText primary="License" secondary="GPL-3.0 License" />
          </ListItemButton>
        </ListItem>

        <ListSubheader>Open Source</ListSubheader>
        <ListItem disablePadding onClick={() => open('https://github.com/pwltr/tauthy')}>
          <ListItemButton>
            <ListItemIcon>
              <GitHubIcon color="primary" />
            </ListItemIcon>
            <ListItemText primary="GitHub" secondary="pwltr/tauthy" />
          </ListItemButton>
        </ListItem>

        <ListSubheader>Support</ListSubheader>
        <ListItem disablePadding onClick={() => open('https://github.com/pwltr/tauthy')}>
          <ListItemButton>
            <ListItemIcon>
              <VolunteerActivismIcon color="primary" />
            </ListItemIcon>
            <ListItemText primary="Buy me a coffee" />
          </ListItemButton>
        </ListItem>
      </List>
    </>
  )
}

export default About
