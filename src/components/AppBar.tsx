import { useState, useContext, ChangeEvent, useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { styled } from '@mui/material/styles'
import MuiAppBar from '@mui/material/AppBar'
import MuiToolbar from '@mui/material/Toolbar'
import Box from '@mui/material/Box'
import InputBase from '@mui/material/InputBase'
import IconButton from '@mui/material/IconButton'
import Typography from '@mui/material/Typography'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import CloseIcon from '@mui/icons-material/Close'
import SearchIcon from '@mui/icons-material/Search'
import LockIcon from '@mui/icons-material/Lock'
import MoreIcon from '@mui/icons-material/MoreVert'

import { vault } from '~/utils/storage'
import { useLocalStorage } from '~/hooks'
import { AppBarBackContext, AppBarTitleContext, SearchContext } from '~/context'

const Toolbar = styled(MuiToolbar)`
  padding-right: 0;
`

const PageTitle = styled(Typography)`
  font-size: 1.2rem;
`

const Search = styled(InputBase)`
  color: #ffffff;
`

const AppBar = () => {
  const { t } = useTranslation()
  const location = useLocation()
  const navigate = useNavigate()
  const [isPasswordSet] = useLocalStorage('isPasswordSet', false)
  const { appBarTitle } = useContext(AppBarTitleContext)
  const { backDisabled } = useContext(AppBarBackContext)
  const { searchTerm, setSearch } = useContext(SearchContext)

  const [isSearching, setIsSearching] = useState(!!searchTerm)

  useEffect(() => {
    if (location.pathname !== '/' && searchTerm === '') {
      setIsSearching(false)
    }

    const handleKeyPress = (event: KeyboardEvent) => {
      if (location.pathname === '/') {
        if (event.key === 'Escape') {
          setSearch('')
          setIsSearching(false)
        } else {
          setIsSearching(true)
        }
      }
    }

    window.addEventListener('keypress', handleKeyPress)

    return () => {
      window.removeEventListener('keypress', handleKeyPress)
    }
  }, [location.pathname])

  const handleNavigate = (path: string) => {
    navigate(path)
  }

  const handleLock = async () => {
    try {
      await vault.lock()
      handleNavigate('unlock')
    } catch (err) {
      console.error(err)
    }
  }

  return (
    <MuiAppBar data-tauthy-app-bar position="fixed" color="secondary">
      <Toolbar>
        {location.pathname !== '/' && (
          <IconButton
            size="large"
            edge="start"
            color="inherit"
            aria-label="menu"
            disabled={backDisabled}
            sx={{ mr: 2 }}
            onClick={() => navigate(-1)}
          >
            <ArrowBackIcon />
          </IconButton>
        )}

        <Box sx={{ flexGrow: 1 }} onClick={() => setIsSearching(true)}>
          {isSearching && location.pathname === '/' ? (
            <Search
              autoFocus
              placeholder={t('appBar.search')}
              inputProps={{ 'aria-label': t('appBar.search') }}
              value={searchTerm}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setSearch(event.target.value)}
            />
          ) : (
            <PageTitle variant="h6" noWrap>
              {location.pathname === '/' ? <b>Tauthy</b> : appBarTitle}
            </PageTitle>
          )}
        </Box>

        {location.pathname === '/' && (
          <>
            <Box>
              {isSearching ? (
                <IconButton
                  size="large"
                  aria-label="filter entries"
                  color="inherit"
                  onClick={() => {
                    setSearch('')
                    setIsSearching(false)
                  }}
                >
                  <CloseIcon />
                </IconButton>
              ) : (
                <IconButton
                  size="large"
                  aria-label="filter entries"
                  color="inherit"
                  onClick={() => {
                    setIsSearching(true)
                  }}
                >
                  <SearchIcon />
                </IconButton>
              )}

              {isPasswordSet && (
                <IconButton
                  size="large"
                  aria-label={t('appBar.lock')}
                  color="inherit"
                  onClick={handleLock}
                >
                  <LockIcon />
                </IconButton>
              )}
            </Box>
            <Box>
              <IconButton
                size="large"
                aria-label={t('appBar.settings')}
                onClick={() => handleNavigate('/settings')}
                color="inherit"
              >
                <MoreIcon />
              </IconButton>
            </Box>
          </>
        )}
      </Toolbar>
    </MuiAppBar>
  )
}

export default AppBar
