import { useRef, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { alpha, styled } from '@mui/material/styles'
import Typography from '@mui/material/Typography'
import Button from '@mui/material/Button'
import Alert from '@mui/material/Alert'

import { vault } from '~/utils/storage'
import { useLocalStorage } from '~/hooks'
import { vaultErrorMessage } from '~/utils/vaultErrors'

import logo from '../../assets/app-icons/icon-round-bordered.png'

const EXIT_DURATION_MS = 180

const Container = styled('div')`
  display: flex;
  flex-direction: column;
  flex: 1;
  justify-content: center;
  align-items: center;
  padding: 3rem;
  position: relative;
  isolation: isolate;
  overflow: hidden;
  animation: welcome-enter 320ms cubic-bezier(0.2, 0.8, 0.2, 1) both;

  &[data-leaving='true'] {
    animation: welcome-exit ${EXIT_DURATION_MS}ms ease-in both;
  }

  @keyframes welcome-enter {
    from {
      opacity: 0;
      transform: translateY(10px);
    }

    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  @keyframes welcome-exit {
    from {
      opacity: 1;
      transform: translateY(0);
    }

    to {
      opacity: 0;
      transform: translateY(-8px);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }
`

const Artwork = styled('svg')(({ theme }) => ({
  position: 'absolute',
  top: '50%',
  left: '50%',
  width: 'min(145vw, 680px)',
  height: 'auto',
  maxWidth: 'none',
  transform: 'translate(-50%, -65%)',
  color: alpha(theme.palette.text.primary, theme.palette.mode === 'dark' ? 0.16 : 0.1),
  pointerEvents: 'none',
  maskImage: 'linear-gradient(to bottom, transparent, black 18%, black 43%, transparent 72%)',
  WebkitMaskImage: 'linear-gradient(to bottom, transparent, black 18%, black 43%, transparent 72%)',
}))

const Content = styled('div')`
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
`

const Welcome = () => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [showWelcome, setShowWelcome] = useLocalStorage('showWelcome', true)
  const [busy, setBusy] = useState(false)
  const [leaving, setLeaving] = useState(false)
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
      // Only this screen transitions; the rest of the app keeps its normal routing.
      if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === false) {
        setLeaving(true)
        await new Promise<void>((resolve) => window.setTimeout(resolve, EXIT_DURATION_MS))
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
    <Container data-leaving={leaving ? 'true' : undefined}>
      <Artwork viewBox="0 0 640 640" fill="none" aria-hidden="true" focusable="false">
        <defs>
          <radialGradient id="welcome-glow">
            <stop stopColor="currentColor" stopOpacity="0.4" />
            <stop offset="55%" stopColor="currentColor" stopOpacity="0.12" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle cx="320" cy="320" r="250" fill="url(#welcome-glow)" />
        <circle
          cx="320"
          cy="320"
          r="148"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeDasharray="190 740"
          transform="rotate(-153 320 320)"
        />
        <circle
          cx="320"
          cy="320"
          r="196"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeDasharray="425 806"
          transform="rotate(-74 320 320)"
        />
        <circle
          cx="320"
          cy="320"
          r="250"
          stroke="currentColor"
          strokeWidth="1.25"
          strokeLinecap="round"
          strokeDasharray="590 981"
          transform="rotate(-162 320 320)"
        />
      </Artwork>

      <Content>
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
      </Content>
    </Container>
  )
}

export default Welcome
