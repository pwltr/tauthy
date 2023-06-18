import { useEffect, useState } from 'react'
import { useNavigate, Outlet } from 'react-router-dom'
import { useIdleTimer } from 'react-idle-timer'
import { styled } from '@mui/material/styles'

import { vault } from '~/App'
import { useLocalStorage } from '~/hooks'
import AppBar from '~/components/AppBar'

const Wrapper = styled('div')`
  display: flex;
  flex-direction: column;
  height: 100vh;
  padding-top: 3.7rem;
`

const Main = () => {
  const navigate = useNavigate()
  const [showWelcome] = useLocalStorage('showWelcome', true)
  const [isPasswordSet] = useLocalStorage('isPasswordSet', false)
  const [shouldAutoLock] = useLocalStorage('shouldAutoLock', false)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    if (showWelcome) {
      navigate('welcome')
      return
    }

    const setupVault = async () => {
      setIsLoading(true)

      try {
        // TODO: can we fix get_status on init?
        // console.info('checking vault status...')
        // const status = await vault.getStatus()
        // console.log('status', status)

        console.info('looking for unlocked vault...')
        await vault.checkVault()
        console.info('successfully read vault')
        setIsLoading(false)
      } catch (err) {
        if (typeof err === 'string') {
          if (err.includes('Please try another password.')) {
            console.info('found existing vault but password has been changed')
            await vault.lock()
            // TODO: timeout on lock screen only in this case
            navigate('unlock')
            setIsLoading(false)
          } else if (err.includes('record not found')) {
            // initialize with empty array
            console.info('no vault found. initializing...')
            await vault.reset()
            setIsLoading(false)
          } else {
            console.error('Unhandled error', err)
          }
        } else {
          console.error('Fatal error', err)
        }
      }
    }

    setupVault()
  }, [])

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

  if (isLoading || showWelcome) {
    return null
  }

  return (
    <Wrapper>
      <AppBar />
      <Outlet />
    </Wrapper>
  )
}

export default Main
