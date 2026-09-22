import { FormEvent, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@mui/material/Button'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'

import Modal, { Buttons } from '~/components/Modal'

type Props = {
  mode: 'create' | 'join'
  open: boolean
  busy: boolean
  onClose: () => void
  onSubmit: (password: string) => void
}

const SyncPasswordModal = ({ mode, open, busy, onClose, onSubmit }: Props) => {
  const { t } = useTranslation()
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) {
      setPassword('')
      setConfirmation('')
      setError('')
    }
  }, [open])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    if (password.length < 8) {
      setError(t('modals.passwordInsecure'))
      return
    }
    if (mode === 'create' && password !== confirmation) {
      setError(t('modals.passwordNoMatch'))
      return
    }
    setError('')
    onSubmit(password)
  }

  return (
    <Modal open={open} onClose={() => !busy && onClose()}>
      <form onSubmit={submit}>
        <Typography variant="h6" component="h2" gutterBottom>
          {t(`sync.${mode}PasswordTitle`)}
        </Typography>
        <Typography color="text.secondary" sx={{ mb: 2 }}>
          {t(`sync.${mode}PasswordDescription`)}
        </Typography>
        <TextField
          type="password"
          label={t('sync.password')}
          value={password}
          autoFocus
          autoComplete={mode === 'create' ? 'new-password' : 'current-password'}
          error={mode === 'join' && !!error}
          helperText={mode === 'join' ? error : ''}
          fullWidth
          margin="normal"
          disabled={busy}
          onChange={(event) => setPassword(event.target.value)}
        />
        {mode === 'create' && (
          <TextField
            type="password"
            label={t('modals.repeatPassword')}
            value={confirmation}
            autoComplete="new-password"
            error={!!error}
            helperText={error}
            fullWidth
            margin="normal"
            disabled={busy}
            onChange={(event) => setConfirmation(event.target.value)}
          />
        )}
        <Buttons>
          <Button disabled={busy} onClick={onClose}>
            {t('modals.cancel')}
          </Button>
          <Button disabled={busy} type="submit" variant="contained" loading={busy}>
            {t(mode === 'create' ? 'sync.create' : 'sync.join')}
          </Button>
        </Buttons>
      </form>
    </Modal>
  )
}

export default SyncPasswordModal
