import { FormEvent, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@mui/material/Button'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'

import Modal, { Buttons } from '~/components/Modal'

type Props = {
  busy: boolean
  error?: string
  formatName: string
  onClose: () => void
  onSubmit: (password: string) => void
  open: boolean
}

const ImportPasswordModal = ({ busy, error, formatName, onClose, onSubmit, open }: Props) => {
  const { t } = useTranslation()
  const [password, setPassword] = useState('')

  useEffect(() => {
    if (!open) setPassword('')
  }, [open])

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (!password || busy) return
    onSubmit(password)
  }

  return (
    <Modal open={open} onClose={busy ? () => {} : onClose}>
      <form onSubmit={handleSubmit}>
        <Typography variant="h6" component="h2" gutterBottom>
          {t('modals.importPasswordTitle')}
        </Typography>
        <Typography variant="body2">
          {t('modals.importPasswordDescription', { format: formatName })}
        </Typography>
        <TextField
          autoFocus
          type="password"
          label={t('modals.importPasswordLabel')}
          variant="filled"
          size="small"
          fullWidth
          margin="normal"
          autoComplete="off"
          value={password}
          disabled={busy}
          error={!!error}
          helperText={error}
          onChange={(event) => setPassword(event.target.value)}
        />
        <Buttons>
          <Button disabled={busy} onClick={onClose}>
            {t('modals.cancel')}
          </Button>
          <Button disabled={!password || busy} type="submit" color="primary" variant="contained">
            {busy ? t('modals.decrypting') : t('modals.import')}
          </Button>
        </Buttons>
      </form>
    </Modal>
  )
}

export default ImportPasswordModal
