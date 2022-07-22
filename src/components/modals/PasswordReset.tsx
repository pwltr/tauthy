import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import Button from '@mui/material/Button'

import { vault } from '~/App'
import { useLocalStorage } from '~/hooks'
import Modal, { Buttons } from '~/components/Modal'

const PasswordResetModal = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
  const { t } = useTranslation()
  const [, setIsPasswordSet] = useLocalStorage('isPasswordSet', false)

  const handleSetPassword = async () => {
    try {
      await vault.changePassword('')
      setIsPasswordSet(false)
      toast.success(t('toasts.passwordReset'))
      onClose()
    } catch (err) {
      console.error(err)
      toast.error(t('toasts.error'))
    }
  }

  return (
    <Modal open={open} onClose={onClose}>
      <div>{t('modals.resetPassword')}</div>
      <Buttons>
        <Button onClick={onClose}>{t('modals.cancel')}</Button>
        <Button color="primary" variant="contained" onClick={handleSetPassword}>
          {t('modals.confirm')}
        </Button>
      </Buttons>
    </Modal>
  )
}

export default PasswordResetModal
