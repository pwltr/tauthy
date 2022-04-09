import { useEffect, useContext } from 'react'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemText from '@mui/material/ListItemText'

import { AppBarTitleContext, ThemeContext } from '~/context'
import { PaletteMode } from '~/styles/theme'
import Modal from '~/components/Modal'
import ListItem from '~/components/ListItem'

const Theme = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
  const { setAppBarTitle } = useContext(AppBarTitleContext)
  const { setTheme } = useContext(ThemeContext)

  useEffect(() => {
    setAppBarTitle('Select theme')
  }, [])

  const handleClick = (mode: PaletteMode) => {
    setTheme(mode)
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose}>
      <List>
        <ListItem disablePadding onClick={() => handleClick('light')}>
          <ListItemButton>
            <ListItemText primary="Light" />
          </ListItemButton>
        </ListItem>

        <ListItem disablePadding onClick={() => handleClick('dark')}>
          <ListItemButton>
            <ListItemText primary="Dark" />
          </ListItemButton>
        </ListItem>

        <ListItem disablePadding onClick={() => handleClick('black')}>
          <ListItemButton>
            <ListItemText primary="Black" />
          </ListItemButton>
        </ListItem>
      </List>
    </Modal>
  )
}

export default Theme
