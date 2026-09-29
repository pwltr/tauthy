import { useRef, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { styled } from '@mui/material/styles'
import Typography from '@mui/material/Typography'
import Button from '@mui/material/Button'
import Alert from '@mui/material/Alert'

import { vault } from '~/utils/storage'
import { useLocalStorage } from '~/hooks'
import { vaultErrorMessage } from '~/utils/vaultErrors'

import logo from '../../assets/app-icons/icon-round-bordered.png'

const Container = styled('div')`
  display: flex;
  flex-direction: column;
  flex: 1;
  justify-content: center;
  align-items: center;
  padding: 3rem;
`

const Welcome = () => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [showWelcome, setShowWelcome] = useLocalStorage('showWelcome', true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const navigating = useRef(false)

  const handleSubmit = async () => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      if (vault.fileBackend) {
        // The first action creates storage only for a genuinely new vault.
        // Pending operations resume through prepare(), never a second create.
        const status = await vault.prepare()
        if (status.lifecycle === 'new') await vault.create()
      }
      navigating.current = true
      setShowWelcome(false)
      navigate('/')
    } catch (error) {
      navigating.current = false
      setError(vaultErrorMessage(error, t))
    } finally {
      setBusy(false)
    }
  }

  // Don't reopen onboarding from browser history after setup is complete.
  if (!showWelcome && !navigating.current) return <Navigate to="/" replace />

  return (
    <Container>
      <img src={logo} width="140" alt="" />

      <Typography variant="h6" align="center" color="primary" sx={{ mt: 1 }}>
        {t('welcome.intro')}
      </Typography>
      <Typography variant="body2" align="center" color="text.secondary" sx={{ mt: 0.5 }}>
        {t('welcome.subtitle')}
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mt: 2, width: '100%', maxWidth: 320 }}>
          {error}
        </Alert>
      )}

      <Button
        color="primary"
        variant="contained"
        disabled={busy}
        loading={busy}
        onClick={() => void handleSubmit()}
        sx={{ mt: 4, minWidth: 220 }}
      >
        {t('welcome.continue')}
      </Button>
    </Container>
  )
}

export default Welcome
