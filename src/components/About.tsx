import { useEffect, useContext, useRef, useState } from 'react'
import { getVersion } from '@tauri-apps/api/app'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import { open } from '@tauri-apps/plugin-shell'
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
import { enableSyncRecoveryTools, syncRecoveryToolsEnabled } from '~/utils/syncRecovery'
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

const LogoButton = styled('button')`
  padding: 0;
  border: 0;
  background: transparent;
  line-height: 0;
`

const LogoImage = styled('img')`
  transform-origin: center;

  &.wobble {
    animation: logo-wobble 220ms ease-out;
  }

  @keyframes logo-wobble {
    0%,
    100% {
      transform: rotate(0deg) scale(1);
    }
    30% {
      transform: rotate(-6deg) scale(1.03);
    }
    65% {
      transform: rotate(4deg) scale(1.01);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    &.wobble {
      animation: none;
    }
  }
`

const About = () => {
  const { t } = useTranslation()
  const { setAppBarTitle } = useContext(AppBarTitleContext)
  const [version, setVersion] = useState('')
  const [wobbleKey, setWobbleKey] = useState(0)
  const logoPresses = useRef(0)

  const pressLogo = () => {
    setWobbleKey((current) => current + 1)
    if (syncRecoveryToolsEnabled()) return
    logoPresses.current += 1
    if (logoPresses.current === 5) {
      enableSyncRecoveryTools()
      toast.success(t('about.developerSettingsEnabled'))
    }
  }

  useEffect(() => {
    setAppBarTitle(t('about.pageTitle'))
    getVersion().then(setVersion)
  }, [])

  return (
    <>
      <Header>
        <LogoButton type="button" aria-label="Tauthy" onClick={pressLogo}>
          <LogoImage
            key={wobbleKey}
            src={logo}
            width={67}
            alt=""
            className={wobbleKey > 0 ? 'wobble' : undefined}
          />
        </LogoButton>
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
            <ListItemText primary={t('about.version')} secondary={version} />
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
