import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { type as osType } from '@tauri-apps/plugin-os'
import { Toaster } from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import CssBaseline from '@mui/material/CssBaseline'
import { ThemeProvider, createTheme } from '@mui/material/styles'

import GlobalStyle from '~/styles/global'
import { getDesignTokens, resolvePaletteMode, ThemePreference } from '~/styles/theme'
import { checkUpdate, ENTRY_USAGE_STORAGE_KEY, recordEntryUsage } from '~/utils'
import { useLocalStorage, useMediaQuery } from '~/hooks'
import AppRouter from '~/components/AppRouter'
import AppDebugger from '~/components/AppDebugger'
import { developerSettingsEnabled, subscribeDeveloperSettings } from '~/utils/developerSettings'
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
import { installImportDiagnostics } from '~/utils/importDiagnostics'

const App = () => {
  useEffect(installImportDiagnostics, [])
  const { t, i18n } = useTranslation()
  const prefersDarkMode = useMediaQuery('(prefers-color-scheme: dark)')
  const prefersReducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
  const [appBarTitle, setAppBarTitle] = useState('Tauthy')
  const showDeveloperToolbar = useSyncExternalStore(
    subscribeDeveloperSettings,
    developerSettingsEnabled,
  )
  const [searchTerm, setSearch] = useState('')
  const [sortOption, setSortOption] = useLocalStorage<SortOption>('sortOption', 'custom')
  const [customOrder, setCustomOrder] = useLocalStorage<string[]>('customOrder', [])
  const [entryUsage] = useLocalStorage(ENTRY_USAGE_STORAGE_KEY, {})
  const [themePreference, setThemePreference] = useLocalStorage<ThemePreference>('theme', 'system')
  const [appSettings, setAppSettings] = useLocalStorage('appSettings', {
    minimizeOnCopy: false,
    showTrayIcon: false,
  })
  const minimizeOnCopy = appSettings.minimizeOnCopy ?? false
  const showTrayIcon = appSettings.showTrayIcon ?? false
  const [listOptions, setListOptions] = useLocalStorage('listOptions', {
    dense: false,
    groupByTwos: false,
  })

  useEffect(() => {
    let removeListener: (() => void) | undefined
    void listen<string>('tauthy://entry-used', ({ payload }) => recordEntryUsage(payload)).then(
      (unlisten) => {
        removeListener = unlisten
      },
    )

    return () => removeListener?.()
  }, [])

  useEffect(() => {
    void invoke('tray_configure', {
      enabled: showTrayIcon,
      labels: {
        locked: t('tray.locked'),
        empty: t('tray.empty'),
        unavailable: t('tray.unavailable'),
        open: t('tray.open'),
        quit: t('tray.quit'),
        tooltip: t('tray.tooltip'),
        copied: t('tray.copied'),
        copyFailed: t('tray.copyFailed'),
      },
    })
  }, [i18n.language, showTrayIcon, t])

  useEffect(() => {
    if (!import.meta.env.DEV) {
      checkUpdate()
    }
  }, [])

  const mode = resolvePaletteMode(themePreference, prefersDarkMode)

  useLayoutEffect(() => {
    const root = document.documentElement
    const previousColorScheme = root.style.colorScheme

    root.style.colorScheme = mode === 'light' ? 'light' : 'dark'

    return () => {
      root.style.colorScheme = previousColorScheme
    }
  }, [mode])

  const theme = useMemo(
    () => createTheme(getDesignTokens(mode, prefersReducedMotion)),
    [mode, prefersReducedMotion],
  )
  const startupRevealSent = useRef(false)

  useLayoutEffect(() => {
    const background = theme.palette.background.default
    document.documentElement.style.backgroundColor = background
    try {
      localStorage.setItem('startupTheme', JSON.stringify({ mode, background }))
    } catch {
      // A disabled/full preference store must not interrupt startup.
    }
  }, [mode, theme])

  useEffect(() => {
    if (osType() !== 'macos' || startupRevealSent.current) return

    // The macOS native window starts hidden so WebKit's unpainted white frame
    // is never shown. Reveal only after React and the selected theme commit.
    const timer = window.setTimeout(() => {
      startupRevealSent.current = true
      void invoke('startup_ready', { background: theme.palette.background.default }).catch(
        console.error,
      )
    }, 100)
    return () => window.clearTimeout(timer)
  }, [theme.palette.background.default])

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <GlobalStyle />

      <AppBarTitleContext.Provider value={{ appBarTitle, setAppBarTitle }}>
        <ThemeContext.Provider value={{ theme: themePreference, setTheme: setThemePreference }}>
          <AppSettingsContext.Provider value={{ minimizeOnCopy, showTrayIcon, setAppSettings }}>
            <ListOptionsContext.Provider value={{ ...listOptions, setListOptions }}>
              <SearchContext.Provider value={{ searchTerm, setSearch }}>
                <SortContext.Provider
                  value={{ sortOption, setSortOption, customOrder, setCustomOrder, entryUsage }}
                >
                  <>
                    <AppRouter />
                    <Toaster position="bottom-center" toastOptions={{ duration: 5000 }} />

                    {import.meta.env.DEV && showDeveloperToolbar && <AppDebugger />}
                  </>
                </SortContext.Provider>
              </SearchContext.Provider>
            </ListOptionsContext.Provider>
          </AppSettingsContext.Provider>
        </ThemeContext.Provider>
      </AppBarTitleContext.Provider>
    </ThemeProvider>
  )
}

export default App
