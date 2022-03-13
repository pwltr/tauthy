import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
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
`

const Button = styled(Fab)`
  position: fixed;
  bottom: 16px;
  /* check cross-platform scrollbar widths */
  /* right: 28px; */
  right: 16px;
`

const INTERVAL_FAST = 1000
const INTERVAL_STANDARD = 30000

const Codes = () => {
  const navigate = useNavigate()
  const [items, setItems] = useState<ListEntry[]>([])
  const [animate, setAnimate] = useState(true)
  const [delay, setDelay] = useState<number>(INTERVAL_FAST)

  const generateTokens = async (items: ListEntry[]) => {
    const promises = items.map((item) => generateTOTP(item.secret))
    const tokens = (await Promise.all(promises)) as string[]
    const itemsWithTokens = items.map((item, index) => ({
      ...item,
      token: tokens[index],
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
      const currentVault = await vault.getVault()
      console.log('Codes: currentVault', currentVault)
      setItems(currentVault)
      generateTokens(currentVault)
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

  return (
    <>
      {items.length === 0 && (
        <Container>
          <Typography color="primary">Add an entry or import a backup</Typography>
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
