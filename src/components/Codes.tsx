import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { styled, css } from '@mui/material/styles'
import Fab from '@mui/material/Fab'
import AddIcon from '@mui/icons-material/Add'
import { Typography } from '@mui/material'

import { vault } from '~/App'
import { useInterval } from '~/hooks/useInterval'
import { generateTOTP } from '~/utils'
import ProgressBar from '~/components/ProgressBar'
import List from '~/components/List'
import type { VaultEntry } from '~/types'

export type ListEntry = VaultEntry & {
  token?: string
}

const StyledProgressBar = styled(ProgressBar)<{ animate: boolean }>`
  position: fixed;
  top: 3.5rem;
  z-index: 1;

  ${(props) =>
    !props.animate &&
    css`
      animation: none;
    `}
`

const StyledList = styled(List)`
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

const INTERVAL_FAST = 1000
const INTERVAL_STANDARD = 30000

const Codes = () => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [items, setItems] = useState<ListEntry[]>([])
  const [animate, setAnimate] = useState(true)
  const [delay, setDelay] = useState<number>(INTERVAL_FAST)
  const [isLoading, setIsLoading] = useState(false)

  const generateTokens = async (items: ListEntry[]) => {
    const promises = items.map((item) => generateTOTP(item.secret))
    const tokens = (await Promise.all(promises)) as string[]
    const itemsWithTokens = items.map((item, index) => ({
      ...item,
      issuer: tokens[index] ? item.issuer : t('codes.invalid'),
      token: tokens[index] ? tokens[index] : '',
    }))

    if (!items[0]?.token) {
      setItems(itemsWithTokens)
    }

    if (items[0]?.token && items[0].token !== itemsWithTokens[0].token) {
      setItems(itemsWithTokens)
      reset()
    }
  }

  // get tokens on mount
  useEffect(() => {
    const getEntries = async () => {
      setIsLoading(true)
      const currentVault = await vault.getVault()
      setItems(currentVault)
      await generateTokens(currentVault)
      setIsLoading(false)
    }

    getEntries()
  }, [])

  // and after specified delay
  useInterval(() => {
    generateTokens(items)
  }, delay)

  const reset = () => {
    // set normal interval
    setDelay(INTERVAL_STANDARD)
    // reset progressbar
    setAnimate(false)

    setTimeout(() => {
      setAnimate(true)
    }, 0)
  }

  if (isLoading) {
    return null
  }

  return (
    <>
      {items.length === 0 && (
        <Container>
          <Typography color="primary" align="center">
            {t('codes.empty')}
          </Typography>
        </Container>
      )}

      {items.length > 0 && (
        <>
          <StyledProgressBar animate={animate} />
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
