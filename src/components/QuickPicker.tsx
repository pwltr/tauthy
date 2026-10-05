import { useLayoutEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ThemeProvider, createTheme, styled } from '@mui/material/styles'
import CssBaseline from '@mui/material/CssBaseline'
import SearchIcon from '@mui/icons-material/Search'
import LockOutlinedIcon from '@mui/icons-material/LockOutlined'
import GlobalStyle from '~/styles/global'
import { getDesignTokens, resolvePaletteMode, type ThemePreference } from '~/styles/theme'
import { useLocalStorage, useMediaQuery } from '~/hooks'
import { useQuickPicker } from '~/hooks/useQuickPicker'
import { formatCode } from '~/utils/formatCode'
import type { QuickPickerEntry as Entry } from '~/types/quickPicker'
import logo from '../../assets/app-icons/icon-round-bordered.png'
import '~/utils/i18n'

const Panel = styled('main')(({ theme }) => ({
  height: '100vh',
  display: 'flex',
  flexDirection: 'column',
  background: theme.palette.background.paper,
  color: theme.palette.text.primary,
  border: `1px solid ${theme.palette.divider}`,
  borderRadius: 16,
  overflow: 'hidden',
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
  borderRadius: '50%',
  display: 'grid',
  placeItems: 'center',
  flexShrink: 0,
  fontWeight: 600,
  background: theme.palette.action.hover,
  color: theme.palette.text.secondary,
  overflow: 'hidden',
  '& img': { display: 'block', width: '100%', height: '100%', objectFit: 'contain' },
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

const Code = styled('span')(({ theme }) => ({
  ...theme.typography.body2,
  fontSize: 20,
  fontWeight: 600,
  whiteSpace: 'nowrap',
}))

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
  gap: 16,
  flexShrink: 0,
  padding: '10px 18px',
  borderTop: `1px solid ${theme.palette.divider}`,
  color: theme.palette.text.secondary,
  fontSize: 11,
  '& button': {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
    whiteSpace: 'nowrap',
    border: 0,
    background: 'none',
    padding: 0,
    color: 'inherit',
    cursor: 'pointer',
  },
  '& img': { display: 'block', borderRadius: '50%', flexShrink: 0 },
}))

const Hints = styled('div')({
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: '8px 16px',
  minWidth: 0,
})

const Hint = styled('span')({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  whiteSpace: 'nowrap',
})

const Keys = styled('span')({ display: 'inline-flex', alignItems: 'center', gap: 3 })

const Keycap = styled('kbd')(({ theme }) => ({
  display: 'inline-block',
  minWidth: 18,
  padding: '0 4px',
  border: `1px solid ${theme.palette.divider}`,
  borderRadius: 4,
  background: theme.palette.action.hover,
  fontFamily: 'inherit',
  fontSize: 10,
  lineHeight: '16px',
  textAlign: 'center',
  boxSizing: 'border-box',
}))

const AccountAvatar = ({ entry }: { entry: Entry }) => {
  const [failedIcon, setFailedIcon] = useState<string | null>(null)
  return (
    <Avatar aria-hidden="true">
      {entry.icon && entry.icon !== failedIcon ? (
        <img
          src={`data:image/svg+xml;base64,${entry.icon}`}
          alt=""
          onError={() => setFailedIcon(entry.icon ?? null)}
        />
      ) : (
        (entry.issuer?.trim() || entry.name).slice(0, 1).toLocaleUpperCase()
      )}
    </Avatar>
  )
}

const QuickPicker = () => {
  const { t } = useTranslation()
  const [preference] = useLocalStorage<ThemePreference>('theme', 'system')
  const dark = useMediaQuery('(prefers-color-scheme: dark)')
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
  const mode = resolvePaletteMode(preference, dark)
  const theme = useMemo(
    () => createTheme(getDesignTokens(mode, reducedMotion)),
    [mode, reducedMotion],
  )
  const {
    snapshot,
    entries,
    selection,
    query,
    error,
    input,
    changeQuery,
    select,
    moveSelection,
    canCopySelection,
    copy,
    dismiss,
    openMain,
    groupByTwos,
  } = useQuickPicker()

  useLayoutEffect(() => {
    document.documentElement.style.colorScheme = mode === 'light' ? 'light' : 'dark'
    document.documentElement.style.backgroundColor = theme.palette.background.paper
  }, [mode, theme])

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <GlobalStyle />
      <Panel
        aria-label={t('quickPicker.title')}
        onCopy={(event) => {
          // macOS's native Edit → Copy menu can dispatch a clipboard event
          // instead of a keydown. Keep actual text selections copyable.
          if (event.defaultPrevented || !canCopySelection()) return
          event.preventDefault()
          event.stopPropagation()
          void copy(entries[selection])
        }}
        onKeyDown={(event) => {
          if (event.defaultPrevented) return
          if (
            event.metaKey &&
            !event.ctrlKey &&
            !event.altKey &&
            !event.shiftKey &&
            event.key.toLowerCase() === 'c' &&
            canCopySelection()
          ) {
            event.preventDefault()
            event.stopPropagation()
            if (!event.repeat) void copy(entries[selection])
          } else if (event.key === 'Escape') {
            event.preventDefault()
            dismiss()
          } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            moveSelection(event.key === 'ArrowDown' ? 1 : -1)
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
            onChange={(event) => changeQuery(event.target.value)}
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
                onMouseMove={() => select(index)}
                onClick={() => void copy(entry)}
              >
                <AccountAvatar entry={entry} />
                <AccountLabel>
                  <strong>{entry.issuer?.trim() || entry.name}</strong>
                  <small>{entry.issuer?.trim() ? entry.name : entry.group}</small>
                </AccountLabel>
                <Code>{entry.code ? formatCode(entry.code, groupByTwos) : '—'}</Code>
              </Row>
            ))
          )}
        </Results>
        <Footer>
          <Hints role="status">
            {error ? (
              t(`quickPicker.${error}`)
            ) : (
              <>
                <Hint>
                  <Keys>
                    <Keycap>↑</Keycap>
                    <Keycap>↓</Keycap>
                  </Keys>
                  {t('quickPicker.hint.select')}
                </Hint>
                <Hint>
                  <Keys>
                    <Keycap>↵</Keycap>
                    <span>/</span>
                    <Keycap>⌘C</Keycap>
                  </Keys>
                  {t('quickPicker.hint.copy')}
                </Hint>
                <Hint>
                  <Keycap>esc</Keycap>
                  {t('quickPicker.hint.close')}
                </Hint>
              </>
            )}
          </Hints>
          <button onClick={openMain}>
            <img src={logo} width={18} height={18} alt="" aria-hidden="true" />
            {t('quickPicker.openMain')}
          </button>
        </Footer>
      </Panel>
    </ThemeProvider>
  )
}

export default QuickPicker
