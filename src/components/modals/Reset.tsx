import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'

import { vault } from '~/utils/storage'
import { useLocalStorage } from '~/hooks'
import Modal, { Buttons } from '~/components/Modal'

const ResetModal = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const [, setIsPasswordSet] = useLocalStorage('isPasswordSet', false)

  const handleResetVault = async () => {
    try {
      await vault.destroy()
      // destroy unloads the Stronghold client; open a fresh passwordless vault
      // before writing its empty record so this session stays usable.
      await vault.unlock('')
      await vault.reset()
      setIsPasswordSet(false)
      toast.success(t('toasts.reset'))
      onClose()
      navigate('/')
    } catch (err) {
      console.error(err)
      toast.error(t('toasts.error'))
    }
  }

  return (
    <Modal open={open} onClose={onClose}>
      <Typography variant="h6" component="h2" gutterBottom>
        {t('security.deleteVault')}
      </Typography>
      <Typography variant="body2">{t('modals.deleteWarning')}</Typography>
      <Buttons>
        <Button color="error" variant="contained" onClick={handleResetVault}>
          {t('security.deleteVault')}
        </Button>
        <Button variant="contained" onClick={onClose}>
          {t('modals.cancel')}
        </Button>
      </Buttons>
    </Modal>
  )
}

export default ResetModal
