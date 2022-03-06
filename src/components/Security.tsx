import { useEffect, useState, useContext } from 'react'
import Switch from '@mui/material/Switch'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemText from '@mui/material/ListItemText'
import ListSubheader from '@mui/material/ListSubheader'

import { AppBarTitleContext } from '~/context'
import PasswordModal from '~/components/modals/Password'
import ListItem from '~/components/ListItem'

const Security = () => {
  const { setAppBarTitle } = useContext(AppBarTitleContext)
  const [openPasswordModal, setOpenPasswordModal] = useState(false)

  const handleOpenPasswordModal = () => setOpenPasswordModal(true)
  const handleClosePasswordModal = () => setOpenPasswordModal(false)

  useEffect(() => {
    setAppBarTitle('Security')
  }, [])

  return (
    <>
      <List>
        <ListSubheader>Encryption</ListSubheader>
        <ListItem disablePadding onClick={handleOpenPasswordModal}>
          <ListItemButton>
            <ListItemText
              primary="Change Password"
              secondary="Set a password for unlocking your vault"
            />
          </ListItemButton>
        </ListItem>

        <ListSubheader>Behaviour</ListSubheader>
        <ListItem
          disablePadding
          // onClick={() => setListOptions({ dense: !dense, groupByTwos })}
          secondaryAction={<Switch checked={false} disabled />}
        >
          <ListItemButton>
            <ListItemText
              primary="Auto-Lock"
              secondary="Lock automatically after 1 minute inactivity"
            />
          </ListItemButton>
        </ListItem>
      </List>

      <PasswordModal open={openPasswordModal} onClose={handleClosePasswordModal} />
    </>
  )
}

export default Security
