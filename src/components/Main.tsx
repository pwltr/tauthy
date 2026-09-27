import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, Outlet } from 'react-router-dom'
import { useIdleTimer } from 'react-idle-timer'
import { styled } from '@mui/material/styles'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import Stack from '@mui/material/Stack'
import { useTranslation } from 'react-i18next'

import { vault } from '~/utils/storage'
import { syncInBackground } from '~/utils/sync'
import { useLocalStorage } from '~/hooks'
import { useVaultProtection } from '~/hooks/useVaultProtection'
import { vaultErrorCode, vaultErrorMessage } from '~/utils/vaultErrors'
import { AppBarBackContext } from '~/context'
import AppBar from '~/components/AppBar'
import ResetModal from '~/components/modals/Reset'

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
const BACKGROUND_SYNC_INTERVAL_MS = 60_000

const Main = () => {
  const { t } = useTranslation()
  const translate = useRef(t)
  translate.current = t
  const navigate = useNavigate()
  const [showWelcome] = useLocalStorage('showWelcome', true)
  const isPasswordSet = useVaultProtection()
  const [shouldAutoLock] = useLocalStorage('shouldAutoLock', false)
  const [isLoading, setIsLoading] = useState(true)
  const [initializationError, setInitializationError] = useState('')
  const [backDisabled, setBackDisabled] = useState(false)
  const [needsCreation, setNeedsCreation] = useState(false)
  const [creationPassword, setCreationPassword] = useState('')
  const [openReset, setOpenReset] = useState(false)

  const initializeVault = useCallback(
    async (reload = false) => {
      if (showWelcome) {
        navigate('welcome')
        return
      }

      setIsLoading(true)
      setInitializationError('')

      try {
        if (vault.fileBackend) {
          const status = await vault.prepare(reload)
          if (status.lifecycle === 'new' || status.lifecycle === 'deleted') {
            setNeedsCreation(true)
            return
          }
          if (status.status === 'locked') {
            navigate('/unlock')
            return
          }
        }
        if (isPasswordSet && !reload && !(await vault.isUnlocked())) {
          navigate('unlock')
          return
        }

        if (reload && !vault.fileBackend) await vault.unlock('')
        console.info('looking for unlocked vault...')
        await vault.checkVault()
        console.info('successfully read vault')
        void syncInBackground()
      } catch (err) {
        try {
          if (vaultErrorCode(err) === 'vaultAuthenticationFailed') {
            console.info('found existing vault but password has been changed')
            await vault.lock()
            navigate('unlock')
          } else if (vaultErrorCode(err) === 'vaultRecordMissing') {
            console.info('no vault found. initializing...')
            await vault.reset()
          } else {
            throw err
          }
        } catch (recoveryError) {
          console.error('Unable to initialize vault', recoveryError)
          setInitializationError(
            vault.fileBackend
              ? vaultErrorMessage(recoveryError, translate.current)
              : formatError(recoveryError),
          )
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

  // Folder clients copy remote edits independently of Tauthy. Keep checking
  // while the unlocked app is open, even if this device makes no local edits.
  useEffect(() => {
    if (showWelcome || isLoading || initializationError || needsCreation) return

    const interval = window.setInterval(() => void syncInBackground(), BACKGROUND_SYNC_INTERVAL_MS)
    return () => window.clearInterval(interval)
  }, [showWelcome, isLoading, initializationError, needsCreation])

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
    <AppBarBackContext.Provider value={{ backDisabled, setBackDisabled }}>
      <Wrapper>
        <AppBar />
        {isLoading ? (
          <InitializationState>
            <CircularProgress size={28} />
          </InitializationState>
        ) : needsCreation ? (
          <InitializationState>
            <Stack spacing={2} sx={{ width: '100%', maxWidth: 360 }}>
              <Typography variant="body2">{t('vaultUi.createHint')}</Typography>
              <TextField
                type="password"
                label={t('vaultUi.optionalPassword')}
                value={creationPassword}
                onChange={(event) => setCreationPassword(event.target.value)}
              />
              <Button
                variant="contained"
                onClick={async () => {
                  setIsLoading(true)
                  try {
                    await vault.create(creationPassword || undefined)
                    setCreationPassword('')
                    setNeedsCreation(false)
                    await initializeVault()
                  } catch (error) {
                    setNeedsCreation(false)
                    setInitializationError(vaultErrorMessage(error, t))
                  } finally {
                    setIsLoading(false)
                  }
                }}
              >
                {t('vaultUi.create')}
              </Button>
            </Stack>
          </InitializationState>
        ) : initializationError ? (
          <InitializationState>
            <Stack spacing={2} sx={{ width: '100%' }}>
              <ErrorAlert
                severity="error"
                action={
                  <Button color="inherit" size="small" onClick={() => void initializeVault(true)}>
                    {t('vaultUi.retry')}
                  </Button>
                }
              >
                {t('vaultUi.openFailed')} {initializationError}
              </ErrorAlert>
              {vault.fileBackend && (
                <Button color="error" onClick={() => setOpenReset(true)}>
                  {t('security.deleteVault')}
                </Button>
              )}
            </Stack>
          </InitializationState>
        ) : (
          <Outlet />
        )}
      </Wrapper>
      <ResetModal
        open={openReset}
        onClose={() => {
          setOpenReset(false)
          void initializeVault()
        }}
      />
    </AppBarBackContext.Provider>
  )
}

export default Main
