import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { styled } from '@mui/material/styles'
import Typography from '@mui/material/Typography'
import TextField from '@mui/material/TextField'
import MuiButton from '@mui/material/Button'
import Alert from '@mui/material/Alert'
import ResetModal from '~/components/modals/Reset'

import { vault } from '~/utils/storage'
import { syncInBackground } from '~/utils/sync'
import { vaultErrorCode, vaultErrorMessage } from '~/utils/vaultErrors'

const Container = styled('div')`
  display: flex;
  flex-direction: column;
  flex: 1;
  justify-content: center;
  align-items: center;
  padding: 3rem;
  text-align: center;
`

const Subtitle = styled(Typography)`
  font-size: 1.2rem;
`

const Button = styled(MuiButton)`
  margin-top: 1.8rem;
`

const Unlock = () => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const inputRef = useRef<HTMLInputElement>(null)
  const [password, setPassword] = useState('')
  const [error, setError] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [recoveryError, setRecoveryError] = useState(false)
  const [rotation, setRotation] = useState(false)
  const [replacement, setReplacement] = useState(false)
  const [deferred, setDeferred] = useState(false)
  const [targetPassword, setTargetPassword] = useState('')
  const [openReset, setOpenReset] = useState(false)
  const [isUnlocking, setIsUnlocking] = useState(false)
  const [isCheckingStatus, setIsCheckingStatus] = useState(vault.fileBackend)
  const unlockInFlight = useRef(false)

  const onSubmit = async (
    event: React.FormEvent<HTMLFormElement> | React.MouseEvent<HTMLElement>,
  ) => {
    event.preventDefault()
    if (unlockInFlight.current || isCheckingStatus) return

    unlockInFlight.current = true
    setIsUnlocking(true)
    setError(false)
    setRecoveryError(false)

    try {
      await vault.unlock(password, rotation ? targetPassword || undefined : undefined)
      // try to read to check if password is valid
      try {
        await vault.checkVault()
      } catch (readError) {
        if (vaultErrorCode(readError) !== 'vaultRecordMissing') throw readError
        await vault.reset()
      }
      void syncInBackground()
      setError(false)
      setPassword('')
      setTargetPassword('')
      navigate('/')
    } catch (err) {
      console.error(err)

      // lock it again in case of wrong status
      await vault.lock().catch(() => undefined)
      setRecoveryError(vaultErrorCode(err) !== 'vaultAuthenticationFailed')
      setErrorMessage(
        vaultErrorCode(err) === 'vaultAuthenticationFailed'
          ? t('unlock.invalid')
          : vaultErrorMessage(err, t),
      )

      setError(true)
    } finally {
      unlockInFlight.current = false
      setIsUnlocking(false)
    }
  }

  useEffect(() => {
    let active = true
    if (vault.fileBackend) {
      void vault
        .getStatus()
        .then((status) => {
          if (!active) return
          setDeferred(status.phase === 'migrationDeferred')
          setRotation(
            status.lifecycle === 'transactionPending' &&
              (status.operation === 'rotate' || status.operation === 'replace'),
          )
          setReplacement(
            status.lifecycle === 'transactionPending' && status.operation === 'replace',
          )
        })
        .catch((error) => {
          if (!active) return
          setError(true)
          setRecoveryError(vaultErrorCode(error) !== 'vaultAuthenticationFailed')
          setErrorMessage(vaultErrorMessage(error, t))
        })
        .finally(() => {
          if (active) setIsCheckingStatus(false)
        })
    }
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    const handleKeyPress = () => inputRef.current?.focus()

    window.addEventListener('keypress', handleKeyPress)

    return () => {
      window.removeEventListener('keypress', handleKeyPress)
    }
  }, [])

  return (
    <Container>
      <Typography variant="h4" color="primary" sx={{ mb: 0 }}>
        {t('unlock.title')}
      </Typography>

      <Subtitle variant="h5" color="primary" sx={{ mt: 1, mb: 2 }}>
        {t('unlock.subtitle')}
      </Subtitle>

      {deferred && (
        <Alert severity="info" sx={{ mb: 2, textAlign: 'left' }}>
          {t('vaultUi.deferred')}
        </Alert>
      )}
      {rotation && (
        <Alert severity="info" sx={{ mb: 2, textAlign: 'left' }}>
          {t('vaultErrors.preparation')}
        </Alert>
      )}

      <form onSubmit={onSubmit}>
        <TextField
          inputRef={inputRef}
          type="password"
          label={t('unlock.password')}
          variant="filled"
          size="small"
          margin="normal"
          autoComplete="off"
          helperText={error ? errorMessage : ' '}
          error={error}
          fullWidth
          autoFocus
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        {rotation && (
          <TextField
            type="password"
            label={t('modals.newPassword')}
            value={targetPassword}
            onChange={(event) => setTargetPassword(event.target.value)}
            fullWidth
            margin="normal"
          />
        )}

        <Button
          aria-label={t('unlock.unlock')}
          color="primary"
          variant="contained"
          loading={isUnlocking || isCheckingStatus}
          onClick={onSubmit}
        >
          {t('unlock.unlock')}
        </Button>
      </form>
      {vault.fileBackend && ((error && recoveryError) || replacement) && (
        <Button onClick={() => navigate('/vault-recovery')}>{t('vaultUi.replaceTitle')}</Button>
      )}
      {vault.fileBackend && error && recoveryError && (
        <Button color="error" onClick={() => setOpenReset(true)}>
          {t('security.deleteVault')}
        </Button>
      )}
      <ResetModal open={openReset} onClose={() => setOpenReset(false)} />
    </Container>
  )
}

export default Unlock
