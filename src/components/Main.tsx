import { useCallback, useEffect, useState } from 'react'
import { useNavigate, Outlet } from 'react-router-dom'
import { useIdleTimer } from 'react-idle-timer'
import { styled } from '@mui/material/styles'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'

import { vault } from '~/utils/storage'
import { syncNow } from '~/utils/sync'
import { useLocalStorage } from '~/hooks'
import AppBar from '~/components/AppBar'

const Wrapper = styled('div')`
  display: flex;
  flex-direction: column;
  height: 100vh;
  padding-top: 3.7rem;
`

const InitializationState = styled('div')`
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  padding: 1rem;
`

const ErrorAlert = styled(Alert)`
  width: 100%;
`

const formatError = (error: unknown) => (error instanceof Error ? error.message : String(error))

const Main = () => {
  const navigate = useNavigate()
  const [showWelcome] = useLocalStorage('showWelcome', true)
  const [isPasswordSet] = useLocalStorage('isPasswordSet', false)
  const [shouldAutoLock] = useLocalStorage('shouldAutoLock', false)
  const [isLoading, setIsLoading] = useState(true)
  const [initializationError, setInitializationError] = useState('')

  const initializeVault = useCallback(
    async (reload = false) => {
      if (showWelcome) {
        navigate('welcome')
        return
      }

      setIsLoading(true)
      setInitializationError('')

      try {
        if (isPasswordSet && !reload && !(await vault.isUnlocked())) {
          navigate('unlock')
          return
        }

        if (reload) await vault.unlock('')
        console.info('looking for unlocked vault...')
        await vault.checkVault()
        console.info('successfully read vault')
        void syncNow().catch(() => {})
      } catch (err) {
        const message = formatError(err)

        try {
          if (message.includes('Please try another password.')) {
            console.info('found existing vault but password has been changed')
            await vault.lock()
            navigate('unlock')
          } else if (message.includes('record not found')) {
            console.info('no vault found. initializing...')
            await vault.reset()
          } else {
            throw err
          }
        } catch (recoveryError) {
          console.error('Unable to initialize vault', recoveryError)
          setInitializationError(formatError(recoveryError))
        }
      } finally {
        setIsLoading(false)
      }
    },
    [isPasswordSet, navigate, showWelcome],
  )

  useEffect(() => {
    void initializeVault(false)
  }, [initializeVault])

  // Lock vault after idle
  useIdleTimer({
    timeout: 60000,
    onIdle: async () => {
      if (isPasswordSet && shouldAutoLock) {
        try {
          await vault.lock()
          navigate('unlock')
        } catch (err) {
          console.error(err)
        }
      }
    },
  })

  if (showWelcome) {
    return null
  }

  return (
    <Wrapper>
      <AppBar />
      {isLoading ? (
        <InitializationState>
          <CircularProgress size={28} />
        </InitializationState>
      ) : initializationError ? (
        <InitializationState>
          <ErrorAlert
            severity="error"
            action={
              <Button color="inherit" size="small" onClick={() => void initializeVault(true)}>
                Retry
              </Button>
            }
          >
            Unable to open the vault: {initializationError}
          </ErrorAlert>
        </InitializationState>
      ) : (
        <Outlet />
      )}
    </Wrapper>
  )
}

export default Main
