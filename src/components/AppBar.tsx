import {
  useState,
  useContext,
  ChangeEvent,
  useEffect,
  useRef,
  MouseEvent as ReactMouseEvent,
} from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { type as osType } from '@tauri-apps/plugin-os'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
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

  &[data-macos-titlebar='true'] {
    position: relative;
    min-height: 84px;
    padding-top: 28px;
    padding-left: 16px;
  }
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
  const isMacOS = osType() === 'macos'

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
        } else if (
          event.key.length === 1 &&
          !(
            event.target instanceof Element &&
            event.target.closest(
              'input, textarea, select, button, a, [contenteditable], [role="button"], [role="textbox"]',
            )
          )
        ) {
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

  const handleTitleBarMouseDown = (event: ReactMouseEvent<HTMLElement>) => {
    if (
      !isMacOS ||
      event.button !== 0 ||
      event.detail !== 1 ||
      (event.target instanceof Element &&
        event.target.closest(
          'button, input, textarea, select, a, [contenteditable], [data-tauthy-search-trigger]',
        ))
    ) {
      return
    }

    event.preventDefault()
    void getCurrentWindow().startDragging().catch(console.error)
  }

  useEffect(() => {
    if (osType() !== 'macos') return

    const available =
      (location.pathname === '/' || location.pathname === '/settings') && !backDisabled
    void invoke('menu_set_enabled', { available, canLock: isPasswordSet }).catch(console.error)
    return () => {
      void invoke('menu_set_enabled', { available: false, canLock: false }).catch(console.error)
    }
  }, [location.pathname, backDisabled, isPasswordSet])

  useEffect(() => {
    const runAction = (action: string) => {
      if (
        (location.pathname !== '/' && location.pathname !== '/settings') ||
        backDisabled ||
        document.querySelector('[role="dialog"], [aria-modal="true"]')
      ) {
        return false
      }

      if (action === 'search') {
        setIsSearching(true)
        if (location.pathname !== '/') navigate('/')
        searchInput.current?.focus()
      } else if (action === 'create') {
        navigate('/create')
      } else if (action === 'import') {
        navigate('/import', { state: { openImport: true } })
      } else if (action === 'export') {
        navigate('/import', { state: { chooseExport: true } })
      } else if (action === 'settings') {
        navigate('/settings')
      } else if (action === 'lock' && isPasswordSet) {
        void handleLock()
      } else {
        return false
      }
      return true
    }

    const handleShortcut = (event: KeyboardEvent) => {
      if (
        osType() === 'macos' ||
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
      const action =
        key === 'l' && event.shiftKey
          ? 'lock'
          : key === 'e' && event.shiftKey
            ? 'export'
            : key === ',' && !event.shiftKey
              ? 'settings'
              : !event.shiftKey && ['f', 'n', 'o'].includes(key)
                ? { f: 'search', n: 'create', o: 'import' }[key as 'f' | 'n' | 'o']
                : undefined
      if (action && runAction(action)) event.preventDefault()
    }

    window.addEventListener('keydown', handleShortcut)
    let unlisten: (() => void) | undefined
    let cancelled = false
    if (osType() === 'macos') {
      void listen<string>('tauthy://menu-action', ({ payload }) => runAction(payload)).then(
        (remove) => {
          if (cancelled) remove()
          else unlisten = remove
        },
        console.error,
      )
    }
    return () => {
      cancelled = true
      window.removeEventListener('keydown', handleShortcut)
      unlisten?.()
    }
  }, [location.pathname, backDisabled, isPasswordSet, navigate])

  return (
    <MuiAppBar
      data-tauthy-app-bar
      position="static"
      color="secondary"
      elevation={1}
      enableColorOnDark={isMacOS}
      sx={{ backgroundImage: 'none' }}
    >
      <Toolbar
        data-macos-titlebar={isMacOS ? 'true' : undefined}
        onMouseDown={handleTitleBarMouseDown}
      >
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

        <Box
          data-tauthy-search-trigger
          sx={{
            flexGrow: 1,
            minWidth: 0,
          }}
          onClick={() => setIsSearching(true)}
        >
          {isSearching && location.pathname === '/' ? (
            <Search
              autoFocus
              inputRef={searchInput}
              placeholder={t('appBar.search')}
              inputProps={{ 'aria-label': t('appBar.search'), 'data-tauthy-search': 'true' }}
              value={searchTerm}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'ArrowDown' || event.altKey || event.ctrlKey || event.metaKey)
                  return
                const firstRow = document.querySelector<HTMLElement>('[data-code-row]')
                if (firstRow) {
                  event.preventDefault()
                  firstRow.focus()
                }
              }}
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
