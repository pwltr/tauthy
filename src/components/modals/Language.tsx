import { useTranslation } from 'react-i18next'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemText from '@mui/material/ListItemText'

import Modal from '~/components/Modal'
import ListItem from '~/components/ListItem'

const Language = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
  const { i18n } = useTranslation()

  const handleClick = (language: string) => {
    i18n.changeLanguage(language)
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose}>
      <List>
        <ListItem disablePadding onClick={() => handleClick('en-US')}>
          <ListItemButton>
            <ListItemText primary="English" />
          </ListItemButton>
        </ListItem>

        <ListItem disablePadding onClick={() => handleClick('de-DE')}>
          <ListItemButton>
            <ListItemText primary="German" />
          </ListItemButton>
        </ListItem>

        {/* <ListItem disablePadding onClick={() => handleClick('fr-FR')}>
          <ListItemButton>
            <ListItemText primary="French" />
          </ListItemButton>
        </ListItem> */}

        <ListItem disablePadding onClick={() => handleClick('es-ES')}>
          <ListItemButton>
            <ListItemText primary="Spanish" />
          </ListItemButton>
        </ListItem>
      </List>
    </Modal>
  )
}

export default Language
