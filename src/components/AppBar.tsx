import { useState, useContext, MouseEvent, ChangeEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { styled, lighten } from '@mui/material/styles'
import MuiAppBar from '@mui/material/AppBar'
import MuiToolbar from '@mui/material/Toolbar'
import Box from '@mui/material/Box'
import InputBase from '@mui/material/InputBase'
import IconButton from '@mui/material/IconButton'
import Typography from '@mui/material/Typography'
import MenuItem from '@mui/material/MenuItem'
import Menu from '@mui/material/Menu'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import CloseIcon from '@mui/icons-material/Close'
import SearchIcon from '@mui/icons-material/Search'
import SortIcon from '@mui/icons-material/Sort'
import MoreIcon from '@mui/icons-material/MoreVert'

import { vault } from '~/App'
import { useLocalStorage } from '~/hooks'
import { AppBarTitleContext, SearchContext, SortContext } from '~/context'

const Toolbar = styled(MuiToolbar)`
  padding-right: 0;
`

const PageTitle = styled(Typography)`
  font-size: 1.2rem;
`

const Search = styled(InputBase)`
  color: #ffffff;
`

const StyledMenuItem = styled(MenuItem)(
  ({ theme }) => `
  // background: ${lighten(theme.palette.background.paper, 0.07)};

  // &:hover {
  //   background: ${lighten(theme.palette.background.paper, 0.07)};
  // }
`,
)

const AppBar = () => {
  const { t } = useTranslation()
  const [isPasswordSet] = useLocalStorage('isPasswordSet', false)
  const { appBarTitle } = useContext(AppBarTitleContext)
  const { setSearch } = useContext(SearchContext)
  const { setSorting } = useContext(SortContext)
  const location = useLocation()
  const navigate = useNavigate()

  const [isSearching, setIsSearching] = useState(false)
  const [sortAnchorEl, setSortAnchorEl] = useState<null | HTMLElement>(null)
  const [moreAnchorEl, setMoreAnchorEl] = useState<null | HTMLElement>(null)
  const isMenuSortOpen = Boolean(sortAnchorEl)
  const isMenuMoreOpen = Boolean(moreAnchorEl)

  const handleNavigate = async (path: string) => {
    setMoreAnchorEl(null)
    navigate(path)
  }

  const handleSort = async (option: string) => {
    setSorting(option)
    setSortAnchorEl(null)
  }

  const handleLock = async () => {
    try {
      await vault.lock()
      handleNavigate('unlock')
    } catch (err) {
      console.error(err)
    }
  }

  const handleMenuSortOpen = (event: MouseEvent<HTMLElement>) => {
    setSortAnchorEl(event.currentTarget)
  }

  const handleMenuMoreOpen = (event: MouseEvent<HTMLElement>) => {
    setMoreAnchorEl(event.currentTarget)
  }

  const handleMenuSortClose = () => setSortAnchorEl(null)
  const handleMenuMoreClose = () => setMoreAnchorEl(null)

  const menuMoreId = 'menu-more'
  const renderMenuMore = (
    <Menu
      id={menuMoreId}
      anchorEl={moreAnchorEl}
      open={isMenuMoreOpen}
      anchorOrigin={{
        vertical: 'top',
        horizontal: 'right',
      }}
      keepMounted
      transformOrigin={{
        vertical: 'top',
        horizontal: 'right',
      }}
      onClose={handleMenuMoreClose}
    >
      {isPasswordSet && <StyledMenuItem onClick={handleLock}>{t('appBar.lock')}</StyledMenuItem>}
      <StyledMenuItem onClick={() => handleNavigate('/settings')}>
        {t('appBar.settings')}
      </StyledMenuItem>
      <StyledMenuItem onClick={() => handleNavigate('/about')}>{t('appBar.about')}</StyledMenuItem>
    </Menu>
  )

  const menuSortId = 'menu-sort'
  const renderMenuSort = (
    <Menu
      id={menuSortId}
      anchorEl={sortAnchorEl}
      open={isMenuSortOpen}
      anchorOrigin={{
        vertical: 'top',
        horizontal: 'right',
      }}
      keepMounted
      transformOrigin={{
        vertical: 'top',
        horizontal: 'right',
      }}
      onClose={handleMenuSortClose}
    >
      <MenuItem onClick={() => handleSort('custom')}>{t('appBar.custom')}</MenuItem>
      <MenuItem onClick={() => handleSort('a-z')}>A-Z</MenuItem>
      <MenuItem onClick={() => handleSort('z-a')}>Z-A</MenuItem>
    </Menu>
  )

  return (
    <>
      <MuiAppBar position="fixed" color="secondary">
        <Toolbar>
          {location.pathname !== '/' && (
            <IconButton
              size="large"
              edge="start"
              color="inherit"
              aria-label="menu"
              sx={{ mr: 2 }}
              onClick={() => navigate(-1)}
            >
              <ArrowBackIcon />
            </IconButton>
          )}

          {isSearching && location.pathname === '/' ? (
            <Search
              autoFocus
              placeholder={t('appBar.search')}
              inputProps={{ 'aria-label': t('appBar.search') }}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setSearch(event.target.value)}
            />
          ) : (
            <PageTitle variant="h6" noWrap>
              {location.pathname === '/' ? <b>Tauthy</b> : appBarTitle}
            </PageTitle>
          )}

          <Box sx={{ flexGrow: 1 }} />

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

                <IconButton
                  size="large"
                  aria-label="sort entries"
                  aria-controls={menuSortId}
                  aria-haspopup="true"
                  color="inherit"
                  onClick={handleMenuSortOpen}
                >
                  <SortIcon />
                </IconButton>
              </Box>
              <Box>
                <IconButton
                  size="large"
                  aria-label="show more"
                  aria-controls={menuMoreId}
                  aria-haspopup="true"
                  onClick={handleMenuMoreOpen}
                  color="inherit"
                >
                  <MoreIcon />
                </IconButton>
              </Box>
            </>
          )}
        </Toolbar>
      </MuiAppBar>

      {renderMenuMore}
      {renderMenuSort}
    </>
  )
}

export default AppBar
