import { useEffect, useContext } from 'react'
import { useTranslation } from 'react-i18next'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemText from '@mui/material/ListItemText'
import Radio from '@mui/material/Radio'
import RadioGroup from '@mui/material/RadioGroup'

import { AppBarTitleContext, ThemeContext } from '~/context'
import { ThemePreference } from '~/styles/theme'
import Modal from '~/components/Modal'
import ListItem from '~/components/ListItem'

const Theme = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
  const { setAppBarTitle } = useContext(AppBarTitleContext)
  const { theme, setTheme } = useContext(ThemeContext)
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
      <RadioGroup
        aria-label={t('appearance.theme')}
        value={theme}
        onChange={(_, value) => handleClick(value as ThemePreference)}
      >
        <List>
          <ListItem disablePadding>
            <ListItemButton component="label">
              <Radio edge="start" value="system" />
              <ListItemText primary={t('appearance.themes.system')} />
            </ListItemButton>
          </ListItem>

          <ListItem disablePadding>
            <ListItemButton component="label">
              <Radio edge="start" value="light" />
              <ListItemText primary={t('appearance.themes.light')} />
            </ListItemButton>
          </ListItem>

          <ListItem disablePadding>
            <ListItemButton component="label">
              <Radio edge="start" value="dark" />
              <ListItemText primary={t('appearance.themes.dark')} />
            </ListItemButton>
          </ListItem>

          <ListItem disablePadding>
            <ListItemButton component="label">
              <Radio edge="start" value="black" />
              <ListItemText primary={t('appearance.themes.black')} />
            </ListItemButton>
          </ListItem>
        </List>
      </RadioGroup>
    </Modal>
  )
}

export default Theme
