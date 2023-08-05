import { createContext } from 'react'
import { PaletteMode } from '~/styles/theme'

export const AppBarTitleContext = createContext<{
  appBarTitle: string
  setAppBarTitle: (title: string) => void
}>({
  appBarTitle: 'Tauthy',
  setAppBarTitle: () => {},
})

export const ThemeContext = createContext<{
  theme: PaletteMode
  setTheme: (mode: PaletteMode) => void
}>({
  theme: 'light',
  setTheme: () => {},
})

export const AppSettingsContext = createContext<{
  minimizeOnCopy: boolean
  setAppSettings: (options: { minimizeOnCopy: boolean }) => void
}>({
  minimizeOnCopy: false,
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

export type SortOption = 'a-z' | 'z-a' | 'custom'

export const SortContext = createContext<{
  sortOption: SortOption
  customOrder: string[]
  setSortOption: (option: SortOption) => void
  setCustomOrder: (option: string[]) => void
}>({
  sortOption: 'a-z',
  customOrder: [],
  setSortOption: () => {},
  setCustomOrder: () => {},
})
