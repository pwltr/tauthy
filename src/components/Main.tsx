import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, Outlet } from 'react-router-dom'
import { useIdleTimer } from 'react-idle-timer'
import { styled } from '@mui/material/styles'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import TextField from '@mui/material/TextField'
import Stack from '@mui/material/Stack'
import { useTranslation } from 'react-i18next'

import { vault } from '~/utils/storage'
import { syncInBackground } from '~/utils/sync'
import { useLocalStorage } from '~/hooks'
import { useVaultProtection } from '~/hooks/useVaultProtection'
import { vaultErrorCode, vaultErrorMessage } from '~/utils/vaultErrors'
import { recordDiagnostic } from '~/utils/diagnostics'
import { AppBarBackContext } from '~/context'
import AppBar from '~/components/AppBar'
import ResetModal from '~/components/modals/Reset'

const Wrapper = styled('div')`
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  height: 100vh;
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
  // BrowserRouter's navigate function changes with the location. Navigation
  // must not rerun startup and unmount child screens with unsaved state.
  const navigateRef = useRef(navigate)
  navigateRef.current = navigate
  const [showWelcome] = useLocalStorage('showWelcome', true)
  const isPasswordSet = useVaultProtection()
  const [shouldAutoLock] = useLocalStorage('shouldAutoLock', false)
  const [isLoading, setIsLoading] = useState(true)
  const [initializing, setInitializing] = useState(true)
  const [initializationError, setInitializationError] = useState('')
  const [backDisabled, setBackDisabled] = useState(false)
  const [openReset, setOpenReset] = useState(false)
  const [usingLegacy, setUsingLegacy] = useState(false)
  const [migrationPassword, setMigrationPassword] = useState('')

  const initializeVault = useCallback(
    async (reload = false) => {
      if (showWelcome) {
        navigateRef.current('/welcome')
        return
      }

      setIsLoading(true)
      setInitializationError('')
      recordDiagnostic('vault.init.start')
      let redirecting = false

      try {
        if (vault.fileBackend) {
          let status = await vault.prepare(reload)
          setUsingLegacy(status.usingLegacy ?? false)
          if (status.lifecycle === 'new' || status.lifecycle === 'deleted') {
            // Only a backend-classified new/deleted lifecycle, never a missing-file
            // error, permits a fresh vault after onboarding or deletion.
            await vault.create()
            status = await vault.prepare()
          }
          if (status.status === 'locked') {
            recordDiagnostic('vault.init.ok')
            redirecting = true
            navigateRef.current('/unlock')
            return
          }
        }
        if (isPasswordSet && !reload && !(await vault.isUnlocked())) {
          recordDiagnostic('vault.init.ok')
          redirecting = true
          navigateRef.current('/unlock')
          return
        }

        if (reload && !vault.fileBackend) await vault.unlock('')
        console.info('looking for unlocked vault...')
        await vault.checkVault()
        recordDiagnostic('vault.init.ok')
        console.info('successfully read vault')
        void syncInBackground()
      } catch (err) {
        recordDiagnostic('vault.init.error', vaultErrorCode(err))
        try {
          if (vaultErrorCode(err) === 'vaultAuthenticationFailed') {
            console.info('found existing vault but password has been changed')
            await vault.lock()
            redirecting = true
            navigateRef.current('/unlock')
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
        // Keep the account outlet hidden until the unlock route has replaced it.
        if (!redirecting) {
          setIsLoading(false)
          setInitializing(false)
        }
      }
    },
    [isPasswordSet, showWelcome],
  )

  useEffect(() => {
    void initializeVault(false)
  }, [initializeVault])

  // Folder clients copy remote edits independently of Tauthy. Keep checking
  // while the unlocked app is open, even if this device makes no local edits.
  useEffect(() => {
    if (showWelcome || isLoading || initializationError) return

    const interval = window.setInterval(() => void syncInBackground(), BACKGROUND_SYNC_INTERVAL_MS)
    return () => window.clearInterval(interval)
  }, [showWelcome, isLoading, initializationError])

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

  // Do not paint the home shell while startup is still deciding its route.
  // The outer router supplies the theme-matched full-window background.
  if (initializing) {
    return (
      <InitializationState>
        <CircularProgress size={28} />
      </InitializationState>
    )
  }

  return (
    <AppBarBackContext.Provider value={{ backDisabled, setBackDisabled }}>
      <Wrapper>
        <AppBar />
        {usingLegacy && !isLoading && !initializationError && (
          <Stack spacing={1} sx={{ p: 2 }}>
            <Alert severity="info">{t('vaultUi.deferred')}</Alert>
            {isPasswordSet && (
              <TextField
                type="password"
                label={t('modals.currentPassword')}
                value={migrationPassword}
                onChange={(event) => setMigrationPassword(event.target.value)}
              />
            )}
            <Button
              onClick={async () => {
                setIsLoading(true)
                try {
                  const status = await vault.retryMigration(migrationPassword)
                  setMigrationPassword('')
                  setUsingLegacy(status.usingLegacy ?? false)
                } catch (error) {
                  setInitializationError(vaultErrorMessage(error, t))
                } finally {
                  setIsLoading(false)
                }
              }}
            >
              {t('vaultUi.retryMigration')}
            </Button>
          </Stack>
        )}
        {isLoading ? (
          <InitializationState>
            <CircularProgress size={28} />
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
