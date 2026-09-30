import { useContext, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { QRCodeSVG } from 'qrcode.react'
import { Trans, useTranslation } from 'react-i18next'
import { open } from '@tauri-apps/plugin-shell'
import toast from 'react-hot-toast'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Link from '@mui/material/Link'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'

import { AppBarTitleContext } from '~/context'
import RecoveryCodeDisplay from '~/components/RecoveryCodeDisplay'
import { copyToClipboard } from '~/utils/helpers'
import {
  cancelPubkySync,
  createPubkySync,
  joinPubkySync,
  pollPubkySync,
  startPubkySync,
} from '~/utils/sync'

type Stage = 'starting' | 'approval' | 'create' | 'join' | 'recovery' | 'error'

const joinErrorKey = (error: unknown) =>
  typeof error === 'string' &&
  [
    'syncAuthenticationFailed',
    'syncConflict',
    'syncLocalConflict',
    'syncCorrupt',
    'syncUnsupported',
  ].includes(error)
    ? error
    : 'pubkyUnavailable'

const PubkyConnect = () => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { setAppBarTitle } = useContext(AppBarTitleContext)
  const [stage, setStage] = useState<Stage>('starting')
  const [authUrl, setAuthUrl] = useState('')
  const [publicKey, setPublicKey] = useState('')
  const [recoveryCode, setRecoveryCode] = useState('')
  const [enteredCode, setEnteredCode] = useState('')
  const [busy, setBusy] = useState(false)
  const setupCompleted = useRef(false)

  useEffect(() => {
    setAppBarTitle(t('sync.pubkyTitle'))
  }, [])

  useEffect(() => {
    let active = true
    void startPubkySync()
      .then((url) => {
        if (active) {
          setAuthUrl(url)
          setStage('approval')
        }
      })
      .catch(() => {
        if (active) {
          toast.error(t('toasts.pubkyUnavailable'))
          navigate('/sync')
        }
      })
    return () => {
      active = false
      if (!setupCompleted.current) {
        void cancelPubkySync().catch(() => undefined)
      }
    }
  }, [])

  useEffect(() => {
    if (stage !== 'approval') return
    let active = true
    let polling = false
    const poll = async () => {
      if (polling) return
      polling = true
      try {
        const result = await pollPubkySync()
        if (active && result.approved) {
          setPublicKey(result.publicKey ?? '')
          setAuthUrl('')
          if (!result.hasRemote) {
            const bytes = crypto.getRandomValues(new Uint8Array(32))
            setRecoveryCode(
              Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(''),
            )
          }
          setStage(result.hasRemote ? 'join' : 'create')
        }
      } catch {
        if (active) {
          toast.error(t('toasts.pubkyUnavailable'))
          setStage('error')
        }
      } finally {
        polling = false
      }
    }
    const timer = window.setInterval(() => void poll(), 1500)
    void poll()
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [stage])

  const finish = () => {
    setAuthUrl('')
    setEnteredCode('')
    setRecoveryCode('')
    navigate(-1)
  }

  const create = async () => {
    setBusy(true)
    try {
      await createPubkySync(recoveryCode)
      setupCompleted.current = true
      setStage('recovery')
    } catch (error) {
      if (error === 'syncFileExists') {
        setEnteredCode(recoveryCode)
        setStage('join')
      } else {
        toast.error(t('toasts.pubkyUnavailable'))
      }
    } finally {
      setBusy(false)
    }
  }

  const join = async () => {
    setBusy(true)
    try {
      await joinPubkySync(enteredCode.trim())
      setupCompleted.current = true
      toast.success(t('toasts.syncConfigured'))
      setEnteredCode('')
      navigate(-1)
    } catch (error) {
      toast.error(t(`toasts.${joinErrorKey(error)}`))
    } finally {
      setBusy(false)
    }
  }

  const identityPanel = (
    <Box
      sx={{
        mt: 2,
        px: 1.5,
        py: 1,
        bgcolor: 'action.hover',
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 1,
      }}
    >
      <Typography variant="caption" color="text.secondary" component="div">
        {t('sync.pubkyConnected')}
      </Typography>
      <Typography
        variant="body2"
        component="div"
        sx={{ fontFamily: 'monospace', fontWeight: 600, overflowWrap: 'anywhere' }}
      >
        {publicKey}
      </Typography>
    </Box>
  )

  return (
    <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
      <Box
        sx={{ width: '100%', maxWidth: 560, mx: 'auto', px: 2, py: 1.5, boxSizing: 'border-box' }}
      >
        {stage === 'starting' && <CircularProgress size={28} />}
        {stage === 'approval' && (
          <>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              <Trans
                i18nKey="sync.pubkyApproval"
                components={{
                  ring: (
                    <Link
                      component="button"
                      type="button"
                      onClick={() => {
                        void open('https://pubkyring.app/').catch(() => {
                          toast.error(t('toasts.pubkyRingOpenFailed'))
                        })
                      }}
                    />
                  ),
                }}
              />
            </Typography>
            <Box sx={{ display: 'flex', justifyContent: 'center' }}>
              <Box
                component="button"
                type="button"
                aria-label={t('sync.pubkyCopyLink')}
                title={t('sync.pubkyCopyLink')}
                onClick={() => void copyToClipboard(authUrl)}
                data-testid="pubky-qr-frame"
                sx={{
                  display: 'inline-flex',
                  p: 1.5,
                  bgcolor: 'white',
                  border: '1px solid',
                  borderColor: 'divider',
                  borderRadius: 2,
                  boxShadow: '0 1px 3px rgba(0, 0, 0, 0.15)',
                  cursor: 'pointer',
                }}
              >
                <QRCodeSVG
                  value={authUrl}
                  size={240}
                  level="L"
                  style={{
                    display: 'block',
                    width: 'min(240px, calc(100vw - 48px))',
                    height: 'auto',
                  }}
                />
              </Box>
            </Box>
            <Typography variant="body2" color="text.secondary" align="center" sx={{ mt: 2 }}>
              {t('sync.pubkyWaiting')}
            </Typography>
          </>
        )}
        {stage === 'create' && (
          <>
            <Typography variant="body2" color="text.secondary">
              {t('sync.pubkyCreateDescription')}
            </Typography>
            {identityPanel}
            <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
              {t('sync.pubkySaveCode')}
            </Typography>
            <RecoveryCodeDisplay code={recoveryCode} />
            <Box
              sx={{ display: 'flex', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 1, mt: 2 }}
            >
              <Button onClick={() => void copyToClipboard(recoveryCode)}>
                {t('sync.pubkyCopyCode')}
              </Button>
              <Button
                disabled={busy}
                loading={busy}
                variant="contained"
                onClick={() => void create()}
              >
                {t('sync.pubkyCreate')}
              </Button>
            </Box>
          </>
        )}
        {stage === 'join' && (
          <>
            <Typography variant="body2" color="text.secondary">
              {t('sync.pubkyJoinDescription')}
            </Typography>
            {identityPanel}
            <TextField
              type="password"
              value={enteredCode}
              onChange={(event) => setEnteredCode(event.target.value)}
              label={t('sync.pubkyRecoveryCode')}
              autoComplete="off"
              fullWidth
              margin="normal"
              disabled={busy}
            />
            <Box
              sx={{ display: 'flex', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 1, mt: 2 }}
            >
              <Button
                disabled={busy || enteredCode.trim().length !== 64}
                loading={busy}
                variant="contained"
                onClick={() => void join()}
              >
                {t('sync.join')}
              </Button>
            </Box>
          </>
        )}
        {stage === 'recovery' && (
          <>
            <Typography variant="body2" color="text.secondary">
              {t('sync.pubkySaveCode')}
            </Typography>
            <RecoveryCodeDisplay code={recoveryCode} />
            <Box
              sx={{ display: 'flex', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 1, mt: 2 }}
            >
              <Button onClick={() => void copyToClipboard(recoveryCode)}>
                {t('sync.pubkyCopyCode')}
              </Button>
              <Button variant="contained" onClick={finish}>
                {t('sync.pubkyCodeSaved')}
              </Button>
            </Box>
          </>
        )}
        {stage === 'error' && (
          <>
            <Typography variant="body2" color="text.secondary">
              {t('toasts.pubkyUnavailable')}
            </Typography>
          </>
        )}
      </Box>
    </Box>
  )
}

export default PubkyConnect
