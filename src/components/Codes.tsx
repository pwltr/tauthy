import { useCallback, useEffect, useState } from 'react'
import { Link as RouterLink, useNavigate } from 'react-router-dom'
import { Trans, useTranslation } from 'react-i18next'
import styled from 'styled-components'
import Fab from '@mui/material/Fab'
import AddIcon from '@mui/icons-material/Add'
import { Link, Typography } from '@mui/material'

import { vault } from '~/utils/storage'
import { generateTOTPs, getTOTPRefreshDelay } from '~/utils'
import ProgressBar from '~/components/ProgressBar'
import EntryList from '~/components/EntryList'
import type { VaultEntry } from '~/types'

export type ListEntry = VaultEntry & {
  token?: string
}

const StyledProgressBar = styled(ProgressBar)`
  position: fixed;
  top: 3.5rem;
  z-index: 1;
`

const StyledList = styled(EntryList)`
  height: 400px;
  overflow: auto;
  padding-bottom: 3rem;
`

const Container = styled('div')`
  display: flex;
  flex: 1;
  justify-content: center;
  align-items: center;
  padding: 0 2rem;
`

const Button = styled(Fab)`
  position: fixed;
  bottom: 20px;
  /* check cross-platform scrollbar widths */
  /* right: 28px; */
  right: 16px;
`

const Codes = () => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [items, setItems] = useState<ListEntry[]>([])
  const [refreshDelay, setRefreshDelay] = useState<number | null>(null)
  const [progressDuration, setProgressDuration] = useState(30_000)
  const [progressKey, setProgressKey] = useState(0)
  const [isLoading, setIsLoading] = useState(false)

  const generateTokens = useCallback(
    async (entries: ListEntry[]) => {
      const { codes, expiresAtMs } = await generateTOTPs(entries.map((item) => item.secret))
      const itemsWithTokens = entries.map((item, index) => {
        const token = codes[index] ?? ''
        return {
          ...item,
          issuer: token ? item.issuer : t('codes.invalid'),
          token,
        }
      })

      const duration = getTOTPRefreshDelay(expiresAtMs)
      setItems(itemsWithTokens)
      setRefreshDelay(duration)
      setProgressDuration(duration)
      setProgressKey((key) => key + 1)
    },
    [t],
  )

  // get tokens on mount
  useEffect(() => {
    const getEntries = async () => {
      setIsLoading(true)
      const currentVault = await vault.getVault()
      setItems(currentVault)
      if (currentVault.length > 0) await generateTokens(currentVault)
      setIsLoading(false)
    }

    getEntries()
  }, [generateTokens])

  // Refresh at the exact rollover returned by the backend. A timeout is
  // rescheduled after every response so suspended apps cannot accumulate drift.
  useEffect(() => {
    if (refreshDelay === null || items.length === 0) return

    const timeout = window.setTimeout(() => void generateTokens(items), refreshDelay)
    return () => window.clearTimeout(timeout)
  }, [generateTokens, items, refreshDelay])

  if (isLoading) {
    return null
  }

  return (
    <>
      {items.length === 0 && (
        <Container>
          <Typography color="primary" align="center">
            <Trans
              i18nKey="codes.empty"
              components={{
                add: <Link component={RouterLink} to="/create" />,
                import: <Link component={RouterLink} to="/import" />,
              }}
            />
          </Typography>
        </Container>
      )}

      {items.length > 0 && (
        <>
          <StyledProgressBar key={progressKey} durationMs={progressDuration} />
          <StyledList entries={items} />
        </>
      )}

      <Button
        aria-label="add account"
        color="primary"
        size="medium"
        onClick={() => navigate('create')}
      >
        <AddIcon />
      </Button>
    </>
  )
}

export default Codes
