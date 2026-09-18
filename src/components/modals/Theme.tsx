import { useEffect, useContext } from 'react'
import { useTranslation } from 'react-i18next'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemText from '@mui/material/ListItemText'

import { AppBarTitleContext, ThemeContext } from '~/context'
import { ThemePreference } from '~/styles/theme'
import Modal from '~/components/Modal'
import ListItem from '~/components/ListItem'

const Theme = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
  const { setAppBarTitle } = useContext(AppBarTitleContext)
  const { setTheme } = useContext(ThemeContext)
  const { t } = useTranslation()

  useEffect(() => {
    setAppBarTitle(t('appearance.selectTheme'))
  }, [setAppBarTitle, t])

  const handleClick = (mode: ThemePreference) => {
    setTheme(mode)
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose}>
      <List>
        <ListItem disablePadding onClick={() => handleClick('system')}>
          <ListItemButton>
            <ListItemText primary={t('appearance.themes.system')} />
          </ListItemButton>
        </ListItem>

        <ListItem disablePadding onClick={() => handleClick('light')}>
          <ListItemButton>
            <ListItemText primary={t('appearance.themes.light')} />
          </ListItemButton>
        </ListItem>

        <ListItem disablePadding onClick={() => handleClick('dark')}>
          <ListItemButton>
            <ListItemText primary={t('appearance.themes.dark')} />
          </ListItemButton>
        </ListItem>

        <ListItem disablePadding onClick={() => handleClick('black')}>
          <ListItemButton>
            <ListItemText primary={t('appearance.themes.black')} />
          </ListItemButton>
        </ListItem>
      </List>
    </Modal>
  )
}

export default Theme
