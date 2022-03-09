import { useEffect, useContext } from 'react'
import { open } from '@tauri-apps/api/shell'
import { styled } from '@mui/material/styles'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemText from '@mui/material/ListItemText'
import ListItemIcon from '@mui/material/ListItemIcon'
import ListSubheader from '@mui/material/ListSubheader'
import CodeIcon from '@mui/icons-material/Code'
import HistoryEduIcon from '@mui/icons-material/HistoryEdu'
import GitHubIcon from '@mui/icons-material/GitHub'
import BugReportIcon from '@mui/icons-material/BugReport'
import VolunteerActivismIcon from '@mui/icons-material/VolunteerActivism'

import { AppBarTitleContext } from '~/context'
import ListItem from '~/components/ListItem'
import logo from '../../assets/tauthy_bordered.png'

const Header = styled('div')`
  display: flex;
  align-items: center;
  grid-gap: 1rem;
  font-size: 1.3rem;
  padding-top: 1rem;
  padding-left: 1rem;
  padding-bottom: 0.3rem;
`

const About = () => {
  const { setAppBarTitle } = useContext(AppBarTitleContext)

  useEffect(() => {
    setAppBarTitle('About')
  }, [])

  return (
    <>
      <Header>
        <img src={logo} width={67} />
        Tauthy
      </Header>

      <List>
        <ListSubheader>Open Source</ListSubheader>
        <ListItem disablePadding onClick={() => open('https://github.com/pwltr/tauthy')}>
          <ListItemButton>
            <ListItemIcon>
              <GitHubIcon color="primary" />
            </ListItemIcon>
            <ListItemText primary="GitHub" secondary="pwltr/tauthy" />
          </ListItemButton>
        </ListItem>

        <ListItem disablePadding onClick={() => open('https://github.com/pwltr/tauthy/issues')}>
          <ListItemButton>
            <ListItemIcon>
              <BugReportIcon color="primary" />
            </ListItemIcon>
            <ListItemText primary="Report a Bug" secondary="Open an issue on GitHub" />
          </ListItemButton>
        </ListItem>

        <ListItem disablePadding onClick={() => open('https://github.com/pwltr/tauthy/releases')}>
          <ListItemButton>
            <ListItemIcon>
              <CodeIcon color="primary" />
            </ListItemIcon>
            <ListItemText primary="Version" secondary="0.1.1" />
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

        {/* <ListSubheader>Support</ListSubheader>
        <ListItem disablePadding onClick={() => open('https://github.com/pwltr/tauthy')}>
          <ListItemButton>
            <ListItemIcon>
              <VolunteerActivismIcon color="primary" />
            </ListItemIcon>
            <ListItemText primary="Buy Me a Coffee" />
          </ListItemButton>
        </ListItem> */}
      </List>
    </>
  )
}

export default About
