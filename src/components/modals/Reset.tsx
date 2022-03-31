import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import Button from '@mui/material/Button'

import { vault } from '~/App'
import Modal, { Buttons } from '~/components/Modal'

const ResetModal = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
  const { t } = useTranslation()

  const handleResetVault = async () => {
    try {
      await vault.reset()
      toast.success(t('toasts.reset'))
      onClose()
    } catch (err) {
      console.error(err)
      toast.error(t('toasts.error'))
    }
  }

  return (
    <Modal open={open} onClose={onClose}>
      <div>{t('modals.deleteWarning')}</div>
      <Buttons>
        <Button color="error" variant="contained" onClick={handleResetVault}>
          {t('modals.delete')}
        </Button>
        <Button variant="contained" onClick={onClose}>
          {t('modals.cancel')}
        </Button>
      </Buttons>
    </Modal>
  )
}

export default ResetModal
