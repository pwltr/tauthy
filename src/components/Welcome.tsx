import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { styled } from '@mui/material/styles'
import Typography from '@mui/material/Typography'
import FormGroup from '@mui/material/FormGroup'
import FormControlLabel from '@mui/material/FormControlLabel'
import Checkbox from '@mui/material/Checkbox'
import MuiButton from '@mui/material/Button'
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

const Button = styled(MuiButton)`
  margin-top: 2.5rem;
`

const Welcome = () => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [checked, setChecked] = useState(false)
  const [, setShowWelcome] = useLocalStorage('showWelcome', true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async () => {
    if (!checked || busy) return
    setBusy(true)
    setError('')
    try {
      if (vault.fileBackend) {
        // Finishing onboarding is the creation action. Only a genuinely new
        // vault may be created; pending operations resume through prepare().
        const status = await vault.prepare()
        if (status.lifecycle === 'new') await vault.create()
      }
      setShowWelcome(false)
      navigate('/')
    } catch (error) {
      setError(vaultErrorMessage(error, t))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Container>
      <img src={logo} width="140" />

      <Typography variant="h6" align="center" color="primary" sx={{ mt: 3, mb: 4 }}>
        {t('welcome.intro')}
      </Typography>

      <FormGroup>
        <FormControlLabel
          label={
            <Typography variant="body1" color="primary">
              {t('welcome.backup')}
            </Typography>
          }
          color="primary"
          control={
            <Checkbox checked={checked} onChange={(event) => setChecked(event.target.checked)} />
          }
        />
      </FormGroup>

      {error && (
        <Alert severity="error" sx={{ mt: 2 }}>
          {error}
        </Alert>
      )}

      <Button
        aria-label="accept"
        color="primary"
        variant="contained"
        disabled={!checked || busy}
        loading={busy}
        onClick={handleSubmit}
      >
        {t('welcome.start')}
      </Button>
    </Container>
  )
}

export default Welcome
