import { styled } from '@mui/material/styles'
import Button from '@mui/material/Button'

import { vault } from '~/App'
import { checkUpdate } from '~/utils'

const Container = styled('div')`
  position: fixed;
  bottom: 1rem;
  left: 1rem;
`

const Row = styled('div')`
  display: flex;
  grid-gap: 0.5rem;
`

const Unlock = () => {
  const handleGetStatus = async () => {
    try {
      const status = await vault.getStatus()
      console.log('status', status)
    } catch (err) {
      console.error(err)
    }
  }

  const handleGetVault = async () => {
    try {
      const currentVault = await vault.getVault()
      console.log('currentVault', currentVault)
    } catch (err) {
      console.error(err)
    }
  }

  const handleClearAll = async () => {
    await vault.destroy()
    await vault.reset()
    localStorage.clear()
  }

  const handleDebug = async () => {
    try {
      const result = await checkUpdate()
      console.log('result', result)
    } catch (err) {
      console.error(err)
    }
  }

  return (
    <Container>
      <Row>
        <Button size="small" variant="contained" onClick={handleGetStatus}>
          Status
        </Button>
        <Button size="small" variant="contained" onClick={handleGetVault}>
          Value
        </Button>
        <Button color="warning" size="small" variant="contained" onClick={handleDebug}>
          Debug
        </Button>
        <Button color="error" size="small" variant="contained" onClick={handleClearAll}>
          Clear
        </Button>
      </Row>
    </Container>
  )
}

export default Unlock
