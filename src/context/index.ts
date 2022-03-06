import { createContext } from "react";
import { PaletteMode } from "~/styles/theme";

export const AppBarTitleContext = createContext({
  appBarTitle: "Tauthy",
  setAppBarTitle: (title: string) => {},
});

export const ThemeContext = createContext({
  theme: "light",
  setTheme: (mode: PaletteMode) => {},
});

export const ListOptionsContext = createContext({
  dense: false,
  groupByTwos: false,
  setListOptions: (options: { dense: boolean; groupByTwos: boolean }) => {},
});

export const SearchContext = createContext({
  searchTerm: "",
  setSearch: (option: string) => {},
});

export const SortContext = createContext({
  sorting: "a-z",
  setSorting: (option: string) => {},
});
