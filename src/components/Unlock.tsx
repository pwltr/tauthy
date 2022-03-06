import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
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
`

const Button = styled(MuiButton)`
  margin-top: 2.2rem;
`

const Unlock = () => {
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [error, setError] = useState(false)

  const handleSubmit = async () => {
    try {
      // await vault.unlock(password)
      // try to read to check if password is valid
      // const status = await vault.getStatus()
      // console.log('status', status)
      setError(false)
      navigate('/')
    } catch (err) {
      console.error(err)
      setError(true)
    }
  }

  useEffect(() => {
    const getStatus = async () => {
      const status = await vault.getStatus()
      console.log('status', status)
    }

    getStatus()
  }, [])

  return (
    <Container>
      <Typography variant="h4" color="primary" mb={0}>
        Vault locked.
      </Typography>
      <Typography variant="h5" color="primary" mb={2}>
        Enter password to unlock
      </Typography>

      <TextField
        type="password"
        placeholder="Password"
        variant="filled"
        size="small"
        margin="normal"
        helperText={error && 'Invalid password'}
        error={error}
        fullWidth
        autoFocus
        onChange={(event) => setPassword(event.target.value)}
      />

      <Button aria-label="add account" color="primary" variant="contained" onClick={handleSubmit}>
        Unlock
      </Button>
    </Container>
  )
}

export default Unlock
