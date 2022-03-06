import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { styled } from '@mui/material/styles'
import Typography from '@mui/material/Typography'
import FormGroup from '@mui/material/FormGroup'
import FormControlLabel from '@mui/material/FormControlLabel'
import Checkbox from '@mui/material/Checkbox'
import MuiButton from '@mui/material/Button'

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
  const navigate = useNavigate()
  const [checked, setChecked] = useState(false)

  const handleSubmit = async () => {
    if (checked) {
      localStorage.setItem('showWelcome', 'false')
      navigate('/')
    }
  }

  return (
    <Container>
      <img src="../assets/tauthy_bordered.png" width="140" />

      <Typography variant="h6" align="center" color="primary" mt={3} mb={4}>
        This app makes use of software that is still in beta.
      </Typography>

      <FormGroup>
        <FormControlLabel
          label={
            <Typography variant="body1" color="primary">
              I'll make sure to keep backups of my data.
            </Typography>
          }
          color="primary"
          control={
            <Checkbox checked={checked} onChange={(event) => setChecked(event.target.checked)} />
          }
        />
      </FormGroup>

      <Button
        aria-label="accept"
        color="primary"
        variant="contained"
        // disabled={!checked}
        onClick={handleSubmit}
      >
        Let's get going
      </Button>
    </Container>
  )
}

export default Welcome
