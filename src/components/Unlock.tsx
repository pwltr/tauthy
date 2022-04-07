import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { styled } from '@mui/material/styles'
import Typography from '@mui/material/Typography'
import TextField from '@mui/material/TextField'
import MuiButton from '@mui/material/Button'

import { vault } from '~/App'

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
  const [password, setPassword] = useState('')
  const [error, setError] = useState(false)

  const handleSubmit = async () => {
    try {
      await vault.unlock(password)
      // try to read to check if password is valid
      const status = await vault.getStatus()
      console.log('status', status)
      setError(false)
      navigate('/')
    } catch (err) {
      console.error(err)
      setError(true)
    }
  }

  return (
    <Container>
      <Typography variant="h4" color="primary" mb={0}>
        {t('unlock.title')}
      </Typography>

      <Subtitle variant="h5" color="primary" mt={1} mb={2}>
        {t('unlock.subtitle')}
      </Subtitle>

      <TextField
        type="password"
        placeholder={t('unlock.password')}
        variant="filled"
        size="small"
        margin="normal"
        helperText={error && t('unlock.invalid')}
        error={error}
        fullWidth
        autoFocus
        onChange={(event) => setPassword(event.target.value)}
      />

      <Button aria-label="add account" color="primary" variant="contained" onClick={handleSubmit}>
        {t('unlock.unlock')}
      </Button>
    </Container>
  )
}

export default Unlock
