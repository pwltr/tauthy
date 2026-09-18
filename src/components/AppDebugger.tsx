import { useState } from 'react'
import { styled } from '@mui/material/styles'
import Button from '@mui/material/Button'

import { vault } from '~/utils/storage'

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

const AppDebugger = ({ onCheckUpdate }: { onCheckUpdate: () => Promise<boolean> }) => {
  const [output, setOutput] = useState('')
  const [isClearing, setIsClearing] = useState(false)

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
    setIsClearing(true)
    setOutput('Clearing development data...')

    try {
      await vault.destroy()
      localStorage.clear()
      window.location.replace('/welcome')
    } catch (err) {
      setOutput(`Clear failed: ${formatError(err)}`)
      setIsClearing(false)
    }
  }

  const handleDebug = async () => {
    try {
      const result = await onCheckUpdate()
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
        <Button
          color="error"
          size="small"
          variant="contained"
          disabled={isClearing}
          onClick={handleClearAll}
        >
          {isClearing ? 'Clearing…' : 'Clear'}
        </Button>
      </Row>
    </Container>
  )
}

export default AppDebugger
