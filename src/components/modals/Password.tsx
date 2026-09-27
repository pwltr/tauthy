import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import TextField from '@mui/material/TextField'
import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'

import { vault } from '~/utils/storage'
import { useVaultProtection } from '~/hooks/useVaultProtection'
import { vaultErrorMessage } from '~/utils/vaultErrors'
import Modal, { Buttons } from '~/components/Modal'

const PasswordModal = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const isPasswordSet = useVaultProtection()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!open) {
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setError(null)
    }
  }, [open])

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

    setBusy(true)
    try {
      await vault.changePassword(newPassword, currentPassword)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setError(null)
      toast.success(t('toasts.passwordSet'))
      onClose()
    } catch (err) {
      console.error(err)
      setError(vaultErrorMessage(err, t))
      if (vault.fileBackend && !(await vault.isUnlocked().catch(() => false))) {
        toast.error(vaultErrorMessage(err, t))
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
      onClose={() => {
        if (!busy) onClose()
      }}
    >
      <div>{t('modals.password')}</div>
      {vault.fileBackend && isPasswordSet && (
        <TextField
          type="password"
          label={t('modals.currentPassword')}
          variant="filled"
          size="small"
          fullWidth
          margin="normal"
          value={currentPassword}
          error={!!error}
          onChange={(event) => setCurrentPassword(event.target.value)}
        />
      )}
      {vault.fileBackend && <Typography variant="body2">{t('vaultUi.rotationWarning')}</Typography>}
      <TextField
        type="password"
        label={t('modals.newPassword')}
        variant="filled"
        size="small"
        fullWidth
        margin="normal"
        autoComplete="off"
        error={!!error}
        value={newPassword}
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
        value={confirmPassword}
        onChange={(event) => setConfirmPassword(event.target.value)}
      />
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

export default PasswordModal
