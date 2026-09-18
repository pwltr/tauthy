import { useState } from 'react'
import { styled } from '@mui/material/styles'
import Button from '@mui/material/Button'

import { vault } from '~/App'
import { checkUpdate } from '~/utils'

const Container = styled('div')`
  position: fixed;
  bottom: 1rem;
  left: 1rem;
  z-index: 6000;
  max-width: calc(100vw - 2rem);
`

const Row = styled('div')`
  display: flex;
  grid-gap: 0.5rem;
`

const Output = styled('pre')`
  max-height: 12rem;
  margin: 0 0 0.5rem;
  padding: 0.5rem;
  overflow: auto;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.85);
  color: #ffffff;
  font-size: 0.7rem;
  white-space: pre-wrap;
`

const formatError = (error: unknown) => (error instanceof Error ? error.message : String(error))

const AppDebugger = () => {
  const [output, setOutput] = useState('')

  const handleGetStatus = async () => {
    try {
      const status = await vault.getStatus()
      setOutput(JSON.stringify(status, null, 2))
    } catch (err) {
      setOutput(`Status failed: ${formatError(err)}`)
    }
  }

  const handleGetVault = async () => {
    try {
      const currentVault = await vault.getVault()
      const redactedVault = currentVault.map((entry) => ({
        uuid: entry.uuid,
        name: entry.name,
        issuer: entry.issuer,
        group: entry.group,
        secret: '[redacted]',
        icon: entry.icon ? '[present]' : undefined,
      }))
      setOutput(JSON.stringify(redactedVault, null, 2))
    } catch (err) {
      setOutput(`Value failed: ${formatError(err)}`)
    }
  }

  const handleClearAll = async () => {
    try {
      await vault.destroy()
      await vault.unlock('')
      await vault.reset()
      localStorage.clear()
      window.location.assign('/')
    } catch (err) {
      setOutput(`Clear failed: ${formatError(err)}`)
    }
  }

  const handleDebug = async () => {
    try {
      const result = await checkUpdate()
      setOutput(result ? 'An update is available.' : 'No update is available.')
    } catch (err) {
      setOutput(`Update check failed: ${formatError(err)}`)
    }
  }

  return (
    <Container>
      {output && <Output>{output}</Output>}
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

export default AppDebugger
