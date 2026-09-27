import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { open } from '@tauri-apps/plugin-dialog'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import FormControlLabel from '@mui/material/FormControlLabel'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'

import { vault } from '~/utils/storage'
import { vaultErrorMessage } from '~/utils/vaultErrors'

// Separate from backup/account imports: this replaces the complete local vault.
const VaultRecovery = () => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [path, setPath] = useState('')
  const [foreignPassword, setForeignPassword] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [password, setPassword] = useState('')
  const [repeatPassword, setRepeatPassword] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [recovery, setRecovery] = useState(false)
  const [sourcePasswordRequired, setSourcePasswordRequired] = useState(true)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!vault.fileBackend) return
    let active = true
    void vault
      .getStatus()
      .then((status) => {
        if (!active) return
        setRecovery(status.lifecycle === 'transactionPending' && status.operation === 'replace')
        setSourcePasswordRequired(status.protectionHint !== 'deviceCredential')
        setReady(
          status.status === 'unlocked' ||
            (status.lifecycle === 'transactionPending' && status.operation === 'replace'),
        )
      })
      .catch((failure) => {
        if (active) setError(vaultErrorMessage(failure, t))
      })
    return () => {
      active = false
    }
  }, [t])

  const choose = async () => {
    setError('')
    try {
      const selected = await open({
        multiple: false,
        directory: false,
        filters: [{ name: 'Tauthy vault', extensions: ['tauthy'] }],
      })
      if (typeof selected === 'string') setPath(selected)
    } catch (failure) {
      setError(vaultErrorMessage(failure, t))
    }
  }

  const submit = async () => {
    if (!ready || busy || !confirmed || !path) return
    if (password && password.length < 8) {
      setError(t('modals.passwordInsecure'))
      return
    }
    if (password !== repeatPassword) {
      setError(t('modals.passwordNoMatch'))
      return
    }
    setBusy(true)
    setError('')
    try {
      await vault.importForeign({ path, foreignPassword, currentPassword, password, recovery })
      setForeignPassword('')
      setCurrentPassword('')
      setPassword('')
      setRepeatPassword('')
      navigate('/')
    } catch (failure) {
      setError(vaultErrorMessage(failure, t))
      // A partially prepared replacement is resumed by explicitly resubmitting
      // the original file, not reconstructed from incumbent local records.
      try {
        const status = await vault.getStatus()
        setRecovery(status.lifecycle === 'transactionPending' && status.operation === 'replace')
        setReady(
          status.status === 'unlocked' ||
            (status.lifecycle === 'transactionPending' && status.operation === 'replace'),
        )
      } catch {
        setReady(false)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Stack spacing={2} sx={{ p: 3, maxWidth: 540, width: '100%', mx: 'auto', overflowY: 'auto' }}>
      <Typography variant="h6">{t('vaultUi.replaceTitle')}</Typography>
      <Typography variant="body2">{t('vaultUi.replaceExplanation')}</Typography>
      <Alert severity="warning">{t('vaultUi.replaceWarning')}</Alert>
      {recovery && <Alert severity="info">{t('vaultUi.replaceResume')}</Alert>}
      {error && <Alert severity="error">{error}</Alert>}
      {!ready && <Alert severity="info">{t('vaultErrors.locked')}</Alert>}
      <Button disabled={busy || !ready} variant="outlined" onClick={() => void choose()}>
        {t('vaultUi.chooseFile')}
      </Button>
      {path && (
        <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
          {path.split(/[\\/]/).pop()}
        </Typography>
      )}
      <TextField
        disabled={busy}
        type="password"
        label={t('vaultUi.filePassword')}
        value={foreignPassword}
        onChange={(event) => setForeignPassword(event.target.value)}
      />
      {sourcePasswordRequired && (
        <TextField
          disabled={busy}
          type="password"
          label={t('modals.currentPassword')}
          value={currentPassword}
          onChange={(event) => setCurrentPassword(event.target.value)}
        />
      )}
      <Typography variant="body2">{t('vaultUi.createHint')}</Typography>
      <TextField
        disabled={busy}
        type="password"
        label={t('vaultUi.optionalPassword')}
        value={password}
        onChange={(event) => setPassword(event.target.value)}
      />
      <TextField
        disabled={busy}
        type="password"
        label={t('modals.repeatPassword')}
        value={repeatPassword}
        onChange={(event) => setRepeatPassword(event.target.value)}
      />
      <FormControlLabel
        control={
          <Checkbox
            disabled={busy}
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
          />
        }
        label={t('vaultUi.replaceConfirm')}
      />
      <Stack direction="row" spacing={1}>
        <Button disabled={busy} onClick={() => navigate('/unlock')}>
          {t('modals.cancel')}
        </Button>
        <Button
          color="error"
          variant="contained"
          disabled={!confirmed || !path || !ready}
          loading={busy}
          onClick={() => void submit()}
        >
          {t('vaultUi.replaceTitle')}
        </Button>
      </Stack>
    </Stack>
  )
}

export default VaultRecovery
