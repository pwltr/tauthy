import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import Button from '@mui/material/Button'
import TextField from '@mui/material/TextField'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { vault } from '~/utils/storage'
import { vaultErrorMessage } from '~/utils/vaultErrors'
import Modal, { Buttons } from '~/components/Modal'

const PasswordResetModal = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [currentPassword, setCurrentPassword] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!open) setCurrentPassword('')
  }, [open])

  const handleSetPassword = async () => {
    setBusy(true)
    try {
      await vault.changePassword('', currentPassword)
      setCurrentPassword('')
      toast.success(t('toasts.passwordReset'))
      onClose()
    } catch (err) {
      console.error(err)
      toast.error(vaultErrorMessage(err, t))
      if (vault.fileBackend && !(await vault.isUnlocked().catch(() => false))) {
        onClose()
        navigate('/unlock')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      title={t('modals.resetPassword')}
      onClose={() => {
        if (!busy) onClose()
      }}
    >
      {vault.fileBackend && (
        <>
          <TextField
            type="password"
            label={t('modals.currentPassword')}
            variant="filled"
            size="small"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            fullWidth
            margin="normal"
          />
        </>
      )}
      <Buttons>
        <Button disabled={busy} onClick={onClose}>
          {t('modals.cancel')}
        </Button>
        <Button loading={busy} color="primary" variant="contained" onClick={handleSetPassword}>
          {t('modals.confirm')}
        </Button>
      </Buttons>
    </Modal>
  )
}

export default PasswordResetModal
