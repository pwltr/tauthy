import { useEffect, useState } from 'react'
import { useNavigate, Outlet } from 'react-router-dom'
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
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    if (showWelcome) {
      navigate('welcome')
    }

    const setupVault = async () => {
      setIsLoading(true)

      try {
        // console.info('checking vault status...')
        // const status = await vault.getStatus()
        // console.log('status', status)

        const currentVault = await vault.checkVault()
        console.info('found existing vault', currentVault)
        setIsLoading(false)
      } catch (err) {
        if (typeof err === 'string') {
          if (err.includes('Please try another password.')) {
            console.info('vault locked.')
            navigate('unlock')
            setIsLoading(false)
          } else if (err.includes('record not found')) {
            console.info('no vault found. initializing...')
            // initialize with empty array
            await vault.reset()
            setIsLoading(false)
          }
        } else {
          console.error('Unhandled error', err)
        }
      }
    }

    setupVault()
  }, [])

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
