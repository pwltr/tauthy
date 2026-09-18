import { useTranslation } from 'react-i18next'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemText from '@mui/material/ListItemText'
import Radio from '@mui/material/Radio'
import RadioGroup from '@mui/material/RadioGroup'

import Modal from '~/components/Modal'
import ListItem from '~/components/ListItem'

const Language = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
  const { t, i18n } = useTranslation()
  const language = {
    de: 'de-DE',
    en: 'en-US',
    es: 'es-ES',
    fr: 'fr-FR',
  }[(i18n.resolvedLanguage ?? i18n.language).split('-')[0]]

  const handleClick = (language: string) => {
    i18n.changeLanguage(language)
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose}>
      <RadioGroup
        aria-label={t('appearance.language')}
        value={language}
        onChange={(_, value) => handleClick(value)}
      >
        <List>
          <ListItem disablePadding>
            <ListItemButton component="label">
              <Radio edge="start" value="en-US" />
              <ListItemText primary="English" />
            </ListItemButton>
          </ListItem>

          <ListItem disablePadding>
            <ListItemButton component="label">
              <Radio edge="start" value="de-DE" />
              <ListItemText primary="Deutsch" />
            </ListItemButton>
          </ListItem>

          <ListItem disablePadding>
            <ListItemButton component="label">
              <Radio edge="start" value="fr-FR" />
              <ListItemText primary="Français" />
            </ListItemButton>
          </ListItem>

          <ListItem disablePadding>
            <ListItemButton component="label">
              <Radio edge="start" value="es-ES" />
              <ListItemText primary="Español" />
            </ListItemButton>
          </ListItem>
        </List>
      </RadioGroup>
    </Modal>
  )
}

export default Language
