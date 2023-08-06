import { useEffect, useContext } from 'react'
import { useTranslation } from 'react-i18next'
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
import logo from '../../assets/app-icons/icon-round-bordered.png'

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
  const { t } = useTranslation()
  const { setAppBarTitle } = useContext(AppBarTitleContext)

  useEffect(() => {
    setAppBarTitle(t('about.pageTitle'))
  }, [])

  return (
    <>
      <Header>
        <img src={logo} width={67} />
        Tauthy
      </Header>

      <List>
        <ListSubheader>{t('about.openSource')}</ListSubheader>
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
            <ListItemText
              primary={t('about.reportBug')}
              secondary={t('about.reportBugDescription')}
            />
          </ListItemButton>
        </ListItem>

        <ListItem disablePadding onClick={() => open('https://github.com/pwltr/tauthy/releases')}>
          <ListItemButton>
            <ListItemIcon>
              <CodeIcon color="primary" />
            </ListItemIcon>
            <ListItemText primary={t('about.version')} secondary="0.2.6" />
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
            <ListItemText primary={t('about.license')} secondary="GPL-3.0 License" />
          </ListItemButton>
        </ListItem>

        <ListSubheader>{t('about.support')}</ListSubheader>
        <ListItem disablePadding onClick={() => open('https://www.buymeacoffee.com/pwltr')}>
          <ListItemButton>
            <ListItemIcon>
              <VolunteerActivismIcon color="primary" />
            </ListItemIcon>
            <ListItemText primary={t('about.coffee')} />
          </ListItemButton>
        </ListItem>
      </List>
    </>
  )
}

export default About
