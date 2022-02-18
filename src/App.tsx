import { useState, useMemo } from "react";
import { Toaster } from "react-hot-toast";
import CssBaseline from "@mui/material/CssBaseline";
import { ThemeProvider, createTheme } from "@mui/material/styles";

import { getDesignTokens, PaletteMode } from "~/theme";
import GlobalStyle from "~/styles/global";
import { setupVault } from "~/utils";
import { useLocalStorage, useMediaQuery } from "~/hooks";
import AppRouter from "~/components/AppRouter";
import {
  AppBarTitleContext,
  ThemeContext,
  ListOptionsContext,
  SortContext,
} from "~/context";

setupVault();

const App = () => {
  const prefersDarkMode = useMediaQuery("(prefers-color-scheme: dark)");
  const [appBarTitle, setAppBarTitle] = useState("Tauthy");
  const [sorting, setSorting] = useLocalStorage("sorting", "custom");
  const [mode, setMode] = useLocalStorage<PaletteMode>(
    "theme",
    prefersDarkMode ? "dark" : "light"
  );
  const [listOptions, setListOptions] = useLocalStorage("listOptions", {
    dense: false,
    groupByTwos: false,
  });

  // Update the theme only if the mode changes
  const theme = useMemo(() => createTheme(getDesignTokens(mode)), [mode]);

  return (
    <>
      <CssBaseline />
      <GlobalStyle />

      <AppBarTitleContext.Provider value={{ appBarTitle, setAppBarTitle }}>
        <ThemeContext.Provider value={{ theme: mode, setTheme: setMode }}>
          <ListOptionsContext.Provider
            value={{ ...listOptions, setListOptions }}
          >
            <SortContext.Provider value={{ sorting, setSorting }}>
              <ThemeProvider theme={theme}>
                <AppRouter />
                <Toaster
                  position="bottom-center"
                  toastOptions={{ duration: 1200 }}
                />
              </ThemeProvider>
            </SortContext.Provider>
          </ListOptionsContext.Provider>
        </ThemeContext.Provider>
      </AppBarTitleContext.Provider>
    </>
  );
};

export default App;
