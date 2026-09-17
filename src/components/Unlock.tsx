import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { styled } from '@mui/material/styles'
import Typography from '@mui/material/Typography'
import TextField from '@mui/material/TextField'
import MuiLoadingButton from '@mui/lab/LoadingButton'

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

const Button = styled(MuiLoadingButton)`
  margin-top: 1.8rem;
`

const Unlock = () => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const inputRef = useRef<HTMLInputElement>(null)
  const [password, setPassword] = useState('')
  const [error, setError] = useState(false)
  const [isDisabled, setIsDisabled] = useState(true)

  const onSubmit = async (
    event: React.FormEvent<HTMLFormElement> | React.MouseEvent<HTMLElement>,
  ) => {
    event.preventDefault()

    setIsDisabled(true)
    setError(false)

    try {
      await vault.unlock(password)
      // try to read to check if password is valid
      await vault.checkVault()
      setIsDisabled(false)
      setError(false)
      navigate('/')
    } catch (err) {
      console.error(err)

      // lock it again in case of wrong status
      await vault.lock()

      // FIX: too many wrong attempts in short amount
      // of time lead to corrupted stronghold
      setTimeout(() => {
        setIsDisabled(false)
        setError(true)
      }, 2000)
    }
  }

  useEffect(() => {
    // FIX: too many wrong attempts in short amount
    // of time lead to corrupted stronghold
    setTimeout(() => setIsDisabled(false), 2000)
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
      <Typography variant="h4" color="primary" mb={0}>
        {t('unlock.title')}
      </Typography>

      <Subtitle variant="h5" color="primary" mt={1} mb={2}>
        {t('unlock.subtitle')}
      </Subtitle>

      <form onSubmit={onSubmit}>
        <TextField
          inputRef={inputRef}
          type="password"
          label={t('unlock.password')}
          variant="filled"
          size="small"
          margin="normal"
          autoComplete="off"
          helperText={error ? t('unlock.invalid') : ' '}
          error={error}
          fullWidth
          autoFocus
          onChange={(event) => setPassword(event.target.value)}
        />

        <Button
          aria-label={t('unlock.unlock')}
          color="primary"
          variant="contained"
          loading={isDisabled}
          onClick={onSubmit}
        >
          {t('unlock.unlock')}
        </Button>
      </form>
    </Container>
  )
}

export default Unlock
