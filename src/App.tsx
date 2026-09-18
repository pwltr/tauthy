import { useEffect, useMemo, useState } from 'react'
import { Toaster } from 'react-hot-toast'
import CssBaseline from '@mui/material/CssBaseline'
import { ThemeProvider, createTheme } from '@mui/material/styles'

import GlobalStyle from '~/styles/global'
import { getDesignTokens, resolvePaletteMode, ThemePreference } from '~/styles/theme'
import { useLocalStorage, useMediaQuery, useUpdater } from '~/hooks'
import AppRouter from '~/components/AppRouter'
import AppDebugger from '~/components/AppDebugger'
import Updater from '~/components/Updater'
import {
  AppBarTitleContext,
  ThemeContext,
  AppSettingsContext,
  ListOptionsContext,
  SearchContext,
  SortContext,
  SortOption,
} from '~/context'

// init react-i18next
import '~/utils/i18n'

const App = () => {
  const prefersDarkMode = useMediaQuery('(prefers-color-scheme: dark)')
  const prefersReducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
  const [appBarTitle, setAppBarTitle] = useState('Tauthy')
  const [searchTerm, setSearch] = useState('')
  const [sortOption, setSortOption] = useLocalStorage<SortOption>('sortOption', 'custom')
  const [customOrder, setCustomOrder] = useLocalStorage<string[]>('customOrder', [])
  const [themePreference, setThemePreference] = useLocalStorage<ThemePreference>('theme', 'system')
  const [appSettings, setAppSettings] = useLocalStorage('appSettings', {
    minimizeOnCopy: false,
  })
  const [listOptions, setListOptions] = useLocalStorage('listOptions', {
    dense: false,
    groupByTwos: false,
  })
  const updater = useUpdater()

  useEffect(() => {
    if (!import.meta.env.DEV) {
      void updater.checkForUpdate()
    }
  }, [updater.checkForUpdate])

  const mode = resolvePaletteMode(themePreference, prefersDarkMode)
  const theme = useMemo(
    () => createTheme(getDesignTokens(mode, prefersReducedMotion)),
    [mode, prefersReducedMotion],
  )

  return (
    <>
      <CssBaseline />
      <GlobalStyle />

      <AppBarTitleContext.Provider value={{ appBarTitle, setAppBarTitle }}>
        <ThemeContext.Provider value={{ theme: themePreference, setTheme: setThemePreference }}>
          <AppSettingsContext.Provider value={{ ...appSettings, setAppSettings }}>
            <ListOptionsContext.Provider value={{ ...listOptions, setListOptions }}>
              <SearchContext.Provider value={{ searchTerm, setSearch }}>
                <SortContext.Provider
                  value={{ sortOption, setSortOption, customOrder, setCustomOrder }}
                >
                  <ThemeProvider theme={theme}>
                    <AppRouter />
                    <Updater
                      update={updater.update}
                      status={updater.status}
                      downloadedBytes={updater.downloadedBytes}
                      contentLength={updater.contentLength}
                      error={updater.error}
                      onInstall={updater.installUpdate}
                      onDismiss={updater.dismissUpdate}
                    />
                    <Toaster position="bottom-center" toastOptions={{ duration: 5000 }} />

                    {import.meta.env.DEV && <AppDebugger onCheckUpdate={updater.checkForUpdate} />}
                  </ThemeProvider>
                </SortContext.Provider>
              </SearchContext.Provider>
            </ListOptionsContext.Provider>
          </AppSettingsContext.Provider>
        </ThemeContext.Provider>
      </AppBarTitleContext.Provider>
    </>
  )
}

export default App
