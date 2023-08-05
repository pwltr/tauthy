import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import TextField from '@mui/material/TextField'
import Button from '@mui/material/Button'

import { vault } from '~/App'
import { useLocalStorage } from '~/hooks'
import Modal, { Buttons } from '~/components/Modal'

const PasswordModal = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
  const { t } = useTranslation()
  const [, setIsPasswordSet] = useLocalStorage('isPasswordSet', false)
  // const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)

  const handleSetPassword = async () => {
    // TODO: add more validation

    if (newPassword.length < 8) {
      setError(t('modals.passwordInsecure'))
      return
    }

    if (newPassword !== confirmPassword) {
      setError(t('modals.passwordNoMatch'))
      return
    }

    try {
      await vault.changePassword(newPassword)
      setIsPasswordSet(true)
      setError(null)
      toast.success(t('toasts.passwordSet'))
      onClose()
    } catch (err) {
      console.error(err)
      toast.error(t('toasts.error'))
    }
  }

  return (
    <Modal open={open} onClose={onClose}>
      <div>{t('modals.password')}</div>
      {/* {isPasswordSet && (
        <TextField
          type="password"
          label={t('modals.currentPassword')}
          variant="filled"
          size="small"
          fullWidth
          margin="normal"
          error={error}
          onChange={(event) => setCurrentPassword(event.target.value)}
        />
      )} */}
      <TextField
        type="password"
        label={t('modals.newPassword')}
        variant="filled"
        size="small"
        fullWidth
        margin="normal"
        autoComplete="off"
        error={!!error}
        onChange={(event) => setNewPassword(event.target.value)}
      />
      <TextField
        type="password"
        label={t('modals.repeatPassword')}
        variant="filled"
        size="small"
        fullWidth
        margin="normal"
        autoComplete="off"
        helperText={!!error && error}
        error={!!error}
        onChange={(event) => setConfirmPassword(event.target.value)}
      />
      <Buttons>
        <Button onClick={onClose}>{t('modals.cancel')}</Button>
        <Button color="primary" variant="contained" onClick={handleSetPassword}>
          {t('modals.confirm')}
        </Button>
      </Buttons>
    </Modal>
  )
}

export default PasswordModal
