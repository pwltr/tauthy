import { createContext } from 'react'
import { ThemePreference } from '~/styles/theme'
import type { EntryUsageMap, SortOption } from '~/utils/sorting'

export type { SortOption } from '~/utils/sorting'

export const AppBarTitleContext = createContext<{
  appBarTitle: string
  setAppBarTitle: (title: string) => void
}>({
  appBarTitle: 'Tauthy',
  setAppBarTitle: () => {},
})

export const AppBarBackContext = createContext<{
  backDisabled: boolean
  setBackDisabled: (disabled: boolean) => void
}>({
  backDisabled: false,
  setBackDisabled: () => {},
})

export const ThemeContext = createContext<{
  theme: ThemePreference
  setTheme: (mode: ThemePreference) => void
}>({
  theme: 'light',
  setTheme: () => {},
})

export const AppSettingsContext = createContext<{
  minimizeOnCopy: boolean
  showTrayIcon: boolean
  setAppSettings: (options: { minimizeOnCopy: boolean; showTrayIcon: boolean }) => void
}>({
  minimizeOnCopy: false,
  showTrayIcon: false,
  setAppSettings: () => {},
})

export const ListOptionsContext = createContext<{
  dense: boolean
  groupByTwos: boolean
  setListOptions: (options: { dense: boolean; groupByTwos: boolean }) => void
}>({
  dense: false,
  groupByTwos: false,
  setListOptions: () => {},
})

export const SearchContext = createContext<{
  searchTerm: string
  setSearch: (option: string) => void
}>({
  searchTerm: '',
  setSearch: () => {},
})

export const SortContext = createContext<{
  sortOption: SortOption
  customOrder: string[]
  entryUsage: EntryUsageMap
  setSortOption: (option: SortOption) => void
  setCustomOrder: (option: string[]) => void
}>({
  sortOption: 'a-z',
  customOrder: [],
  entryUsage: {},
  setSortOption: () => {},
  setCustomOrder: () => {},
})
