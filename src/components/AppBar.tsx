import { useState, useContext, ChangeEvent, useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { type as osType } from '@tauri-apps/plugin-os'
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
import { useVaultProtection } from '~/hooks/useVaultProtection'
import { AppBarBackContext, AppBarTitleContext, SearchContext } from '~/context'

const Toolbar = styled(MuiToolbar)`
  padding-right: 0;
`

const PageTitle = styled(Typography)`
  font-size: 1.2rem;
`

const Search = styled(InputBase)`
  color: inherit;
`

const isEditing = (target: EventTarget | null) =>
  target instanceof Element &&
  Boolean(target.closest('input, textarea, select, [contenteditable], [role="textbox"]'))

const AppBar = () => {
  const { t } = useTranslation()
  const location = useLocation()
  const navigate = useNavigate()
  const isPasswordSet = useVaultProtection()
  const { appBarTitle } = useContext(AppBarTitleContext)
  const { backDisabled } = useContext(AppBarBackContext)
  const { searchTerm, setSearch } = useContext(SearchContext)

  const [isSearching, setIsSearching] = useState(!!searchTerm)
  const searchInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (location.pathname !== '/' && searchTerm === '') {
      setIsSearching(false)
    }

    const handleKeyPress = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return
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

  useEffect(() => {
    if (isSearching && location.pathname === '/') searchInput.current?.focus()
  }, [isSearching, location.pathname])

  const handleNavigate = (path: string) => {
    navigate(path)
  }

  const handleLock = async () => {
    try {
      await vault.lock()
      handleNavigate('/unlock')
    } catch (err) {
      console.error(err)
    }
  }

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (
        (location.pathname !== '/' && location.pathname !== '/settings') ||
        backDisabled ||
        event.defaultPrevented ||
        event.repeat ||
        event.altKey ||
        !(event.ctrlKey || event.metaKey) ||
        isEditing(event.target) ||
        document.querySelector('[role="dialog"], [aria-modal="true"]')
      ) {
        return
      }

      const key = event.key.toLowerCase()
      if (key === 'f' && !event.shiftKey) {
        event.preventDefault()
        setIsSearching(true)
        if (location.pathname !== '/') navigate('/')
        searchInput.current?.focus()
      } else if (key === 'n' && !event.shiftKey) {
        event.preventDefault()
        navigate('/create')
      } else if (key === 'o' && !event.shiftKey) {
        event.preventDefault()
        navigate('/import')
      } else if (key === 'l' && event.shiftKey && isPasswordSet) {
        event.preventDefault()
        void handleLock()
      }
    }

    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [location.pathname, backDisabled, isPasswordSet, navigate])

  return (
    <MuiAppBar
      data-tauthy-app-bar
      position="fixed"
      color="secondary"
      elevation={1}
      enableColorOnDark={osType() === 'macos'}
    >
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
              inputRef={searchInput}
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
                  aria-keyshortcuts="Control+f Meta+f"
                  title={`${t('appBar.search')} (${osType() === 'macos' ? '⌘F' : 'Ctrl+F'})`}
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
                  aria-keyshortcuts="Control+f Meta+f"
                  title={`${t('appBar.search')} (${osType() === 'macos' ? '⌘F' : 'Ctrl+F'})`}
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
                  aria-keyshortcuts="Control+Shift+l Meta+Shift+l"
                  title={`${t('appBar.lock')} (${osType() === 'macos' ? '⌘⇧L' : 'Ctrl+Shift+L'})`}
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
