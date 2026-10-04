import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useTranslation } from 'react-i18next'
import { ThemeProvider, createTheme, styled } from '@mui/material/styles'
import CssBaseline from '@mui/material/CssBaseline'
import SearchIcon from '@mui/icons-material/Search'
import LockOutlinedIcon from '@mui/icons-material/LockOutlined'
import GlobalStyle from '~/styles/global'
import { getDesignTokens, resolvePaletteMode, type ThemePreference } from '~/styles/theme'
import { useLocalStorage, useMediaQuery } from '~/hooks'
import { sortEntries, type EntryUsageMap } from '~/utils/sorting'
import '~/utils/i18n'

type Entry = { uuid: string; name: string; issuer?: string; group?: string; code: string | null }
type Snapshot = { locked: boolean; entries: Entry[] }

const Panel = styled('main')(({ theme }) => ({
  height: '100vh',
  display: 'flex',
  flexDirection: 'column',
  background: theme.palette.background.paper,
  color: theme.palette.text.primary,
  border: `1px solid ${theme.palette.divider}`,
  boxSizing: 'border-box',
  '& button, & input': { font: 'inherit' },
}))
const Search = styled('div')(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '20px 22px',
  borderBottom: `1px solid ${theme.palette.divider}`,
  color: theme.palette.text.secondary,
  '& input': {
    width: '100%',
    background: 'none',
    border: 0,
    outline: 0,
    color: theme.palette.text.primary,
    fontSize: 18,
  },
  '& input::placeholder': { color: theme.palette.text.secondary, opacity: 0.8 },
}))
const Results = styled('div')({ flex: 1, overflowY: 'auto', padding: 8, minHeight: 0 })
const Row = styled('div')(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  minHeight: 58,
  padding: '8px 12px',
  borderRadius: 8,
  cursor: 'pointer',
  '&[aria-selected="true"]': { background: theme.palette.action.selected },
  '&[aria-disabled="true"]': { opacity: 0.5, cursor: 'default' },
}))
const Avatar = styled('span')(({ theme }) => ({
  width: 34,
  height: 34,
  borderRadius: 8,
  display: 'grid',
  placeItems: 'center',
  flexShrink: 0,
  fontWeight: 600,
  background: theme.palette.action.hover,
  color: theme.palette.text.secondary,
}))
const AccountLabel = styled('div')(({ theme }) => ({
  flex: 1,
  minWidth: 0,
  '& strong': {
    display: 'block',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 14,
    fontWeight: 600,
  },
  '& small': {
    display: 'block',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    color: theme.palette.text.secondary,
    fontSize: 12,
  },
}))
const Code = styled('span')({
  fontVariantNumeric: 'tabular-nums',
  fontSize: 17,
  letterSpacing: '0.04em',
  whiteSpace: 'nowrap',
})
const Empty = styled('div')(({ theme }) => ({
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 12,
  padding: 24,
  textAlign: 'center',
  color: theme.palette.text.secondary,
  '& button': {
    border: 0,
    borderRadius: 6,
    padding: '8px 14px',
    cursor: 'pointer',
    background: theme.palette.action.selected,
    color: theme.palette.text.primary,
  },
}))
const Footer = styled('footer')(({ theme }) => ({
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '10px 18px',
  borderTop: `1px solid ${theme.palette.divider}`,
  color: theme.palette.text.secondary,
  fontSize: 11,
  '& button': { border: 0, background: 'none', padding: 0, color: 'inherit', cursor: 'pointer' },
}))

const QuickPicker = () => {
  const { t, i18n } = useTranslation()
  const [preference] = useLocalStorage<ThemePreference>('theme', 'system')
  const [usage] = useLocalStorage<EntryUsageMap>('entryUsage', {})
  const dark = useMediaQuery('(prefers-color-scheme: dark)')
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
  const mode = resolvePaletteMode(preference, dark)
  const theme = useMemo(
    () => createTheme(getDesignTokens(mode, reducedMotion)),
    [mode, reducedMotion],
  )
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const [error, setError] = useState('')
  const [visible, setVisible] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const active = useRef(false)
  const generation = useRef(0)
  const busy = useRef(false)

  const refresh = useCallback(async () => {
    if (!active.current) return
    const request = ++generation.current
    try {
      const data = await invoke<Snapshot>('quick_picker_snapshot')
      if (active.current && generation.current === request) {
        setSnapshot(data)
        setError((previous) => (previous === 'unavailable' ? '' : previous))
      }
    } catch {
      if (active.current && generation.current === request) {
        setSnapshot(null)
        setError('unavailable')
      }
    }
  }, [])

  useEffect(() => {
    let disposed = false
    const removers: Array<() => void> = []
    const subscribe = async (event: string, callback: () => void) => {
      const remove = await listen(event, callback)
      if (disposed) remove()
      else removers.push(remove)
    }
    const opened = () => {
      active.current = true
      setVisible(true)
      setSnapshot(null)
      setQuery('')
      setSelected(0)
      setError('')
      busy.current = false
      void refresh()
      input.current?.focus()
    }
    const closed = () => {
      active.current = false
      generation.current += 1
      setVisible(false)
      setSnapshot(null)
      setQuery('')
    }
    void Promise.all([
      subscribe('tauthy://picker-open', opened),
      subscribe('tauthy://picker-close', closed),
      subscribe('tauthy://picker-refresh', () => void refresh()),
    ])
      .then(() => {
        if (!disposed) void invoke('quick_picker_ready')
      })
      .catch(console.error)
    return () => {
      disposed = true
      active.current = false
      generation.current += 1
      removers.forEach((remove) => remove())
    }
  }, [refresh])

  useEffect(() => {
    if (!visible) return
    const timer = window.setInterval(() => void refresh(), 1000)
    return () => window.clearInterval(timer)
  }, [visible, refresh])

  useEffect(() => {
    const languageChanged = (event: StorageEvent) => {
      if (event.key === 'i18nextLng' && event.newValue) void i18n.changeLanguage(event.newValue)
    }
    window.addEventListener('storage', languageChanged)
    return () => window.removeEventListener('storage', languageChanged)
  }, [i18n])

  useLayoutEffect(() => {
    document.documentElement.style.colorScheme = mode === 'light' ? 'light' : 'dark'
    document.documentElement.style.backgroundColor = theme.palette.background.paper
  }, [mode, theme])

  const entries = useMemo(() => {
    const terms = query.toLocaleLowerCase().trim().split(/\s+/)
    const filtered = (snapshot?.entries ?? []).filter((entry) => {
      const text = `${entry.issuer ?? ''} ${entry.name} ${entry.group ?? ''}`.toLocaleLowerCase()
      return terms.every((term) => text.includes(term))
    })
    return sortEntries(filtered, 'recent', [], usage, i18n.language)
  }, [snapshot, query, usage, i18n.language])
  const selection = Math.min(selected, Math.max(entries.length - 1, 0))

  useEffect(() => {
    document.getElementById(`picker-option-${selection}`)?.scrollIntoView?.({ block: 'nearest' })
  }, [selection, query])

  const copy = async (entry: Entry | undefined) => {
    if (!entry?.code || busy.current) return
    busy.current = true
    try {
      await invoke('quick_picker_copy', { uuid: entry.uuid })
    } catch {
      if (active.current) {
        setError('copyFailed')
        void refresh()
      }
    } finally {
      busy.current = false
    }
  }
  const openMain = () => void invoke('quick_picker_open_main').catch(console.error)

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <GlobalStyle />
      <Panel
        aria-label={t('quickPicker.title')}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            void invoke('quick_picker_dismiss').catch(console.error)
          } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            setSelected((index) =>
              Math.max(
                0,
                Math.min(entries.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)),
              ),
            )
          } else if (event.key === 'Enter' && event.target === input.current) {
            event.preventDefault()
            if (snapshot?.locked) openMain()
            else void copy(entries[selection])
          }
        }}
      >
        <Search>
          <SearchIcon fontSize="small" />
          <input
            ref={input}
            autoFocus
            placeholder={t('quickPicker.search')}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setSelected(0)
              setError('')
            }}
            role="combobox"
            aria-label={t('quickPicker.search')}
            aria-autocomplete="list"
            aria-expanded={Boolean(entries.length)}
            aria-controls="picker-results"
            aria-activedescendant={entries.length ? `picker-option-${selection}` : undefined}
          />
        </Search>
        <Results id="picker-results" role="listbox" aria-label={t('quickPicker.accounts')}>
          {snapshot?.locked ? (
            <Empty>
              <LockOutlinedIcon />
              <span>{t('quickPicker.locked')}</span>
              <button onClick={openMain}>{t('quickPicker.unlock')}</button>
            </Empty>
          ) : error && !snapshot ? (
            <Empty role="alert">
              <span>{t(`quickPicker.${error}`)}</span>
              <button onClick={openMain}>{t('quickPicker.openMain')}</button>
            </Empty>
          ) : !snapshot ? (
            <Empty>{t('quickPicker.loading')}</Empty>
          ) : entries.length === 0 ? (
            <Empty>{t(query ? 'quickPicker.noResults' : 'quickPicker.empty')}</Empty>
          ) : (
            entries.map((entry, index) => (
              <Row
                key={entry.uuid}
                id={`picker-option-${index}`}
                role="option"
                aria-selected={selection === index}
                aria-disabled={!entry.code}
                onMouseMove={() => setSelected(index)}
                onClick={() => void copy(entry)}
              >
                <Avatar>
                  {(entry.issuer?.trim() || entry.name).slice(0, 1).toLocaleUpperCase()}
                </Avatar>
                <AccountLabel>
                  <strong>{entry.issuer?.trim() || entry.name}</strong>
                  <small>{entry.issuer?.trim() ? entry.name : entry.group}</small>
                </AccountLabel>
                <Code>{entry.code ? `${entry.code.slice(0, 3)} ${entry.code.slice(3)}` : '—'}</Code>
              </Row>
            ))
          )}
        </Results>
        <Footer>
          <span role="status">{error ? t(`quickPicker.${error}`) : t('quickPicker.hint')}</span>
          <button onClick={openMain}>{t('quickPicker.openMain')}</button>
        </Footer>
      </Panel>
    </ThemeProvider>
  )
}

export default QuickPicker
