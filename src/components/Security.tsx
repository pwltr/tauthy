import { useEffect, useState, useContext } from 'react'
import { useTranslation } from 'react-i18next'
import Switch from '@mui/material/Switch'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemText from '@mui/material/ListItemText'
import ListSubheader from '@mui/material/ListSubheader'

import { useLocalStorage } from '~/hooks'
import { AppBarTitleContext } from '~/context'
import PasswordModal from '~/components/modals/Password'
import PasswordResetModal from '~/components/modals/PasswordReset'
import ListItem from '~/components/ListItem'

const Security = () => {
  const { t } = useTranslation()
  const [isPasswordSet] = useLocalStorage('isPasswordSet', false)
  const [shouldAutoLock, setShouldAutoLock] = useLocalStorage('shouldAutoLock', false)
  const { setAppBarTitle } = useContext(AppBarTitleContext)
  const [openPasswordModal, setOpenPasswordModal] = useState(false)
  const [openPasswordResetModal, setOpenPasswordResetModal] = useState(false)

  const handleOpenPasswordModal = () => setOpenPasswordModal(true)
  const handleClosePasswordModal = () => setOpenPasswordModal(false)

  const handleOpenPasswordResetModal = () => setOpenPasswordResetModal(true)
  const handleClosePasswordResetModal = () => setOpenPasswordResetModal(false)

  useEffect(() => {
    setAppBarTitle(t('security.pageTitle'))
  }, [])

  return (
    <>
      <List>
        <ListSubheader>{t('security.encryption')}</ListSubheader>
        <ListItem disablePadding onClick={handleOpenPasswordModal}>
          <ListItemButton>
            <ListItemText
              primary={t('security.password')}
              secondary={t('security.passwordDescription')}
            />
          </ListItemButton>
        </ListItem>

        <ListItem
          disablePadding
          disabled={!isPasswordSet}
          onClick={() => (isPasswordSet ? handleOpenPasswordResetModal() : null)}
        >
          <ListItemButton>
            <ListItemText
              primary={t('security.passwordReset')}
              secondary={t('security.passwordResetDescription')}
            />
          </ListItemButton>
        </ListItem>

        <ListSubheader>{t('security.behaviour')}</ListSubheader>
        <ListItem
          disablePadding
          secondaryAction={<Switch checked={shouldAutoLock} />}
          onClick={() => setShouldAutoLock(!shouldAutoLock)}
        >
          <ListItemButton>
            <ListItemText
              primary={t('security.autoLock')}
              secondary={t('security.autoLockDescription')}
            />
          </ListItemButton>
        </ListItem>
      </List>

      <PasswordModal open={openPasswordModal} onClose={handleClosePasswordModal} />
      <PasswordResetModal open={openPasswordResetModal} onClose={handleClosePasswordResetModal} />
    </>
  )
}

export default Security
