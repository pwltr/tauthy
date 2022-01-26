import { useEffect, useState, useMemo, createContext } from "react";
import { BrowserRouter } from "react-router-dom";
import toast, { Toaster } from "react-hot-toast";
import { styled } from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import useMediaQuery from "@mui/material/useMediaQuery";

import { getDesignTokens, PaletteMode } from "./theme";
import GlobalStyle from "~/styles/global";
import AppBar from "~/components/AppBar";
import AppRouter from "~/components/AppRouter";

export const AppBarTitleContext = createContext({
  appBarTitle: "Tauthy",
  setAppBarTitle: (title: string) => {},
});

export const ColorModeContext = createContext({
  colorMode: "light",
  setColorMode: (mode: PaletteMode) => {},
});

export const ListDensityContext = createContext({
  dense: false,
  setDense: (dense: boolean) => {},
});

const Wrapper = styled("div")(
  ({ theme }) => `
  background: ${theme.palette.background.paper};
  display: flex;
  flex-direction: column;
  height: 100vh;
  padding-top: 3.7rem;
`
);

const App = () => {
  const prefersDarkMode = useMediaQuery("(prefers-color-scheme: dark)");
  const [appBarTitle, setAppBarTitle] = useState("Tauthy");
  const [dense, setDense] = useState(false);
  const [mode, setMode] = useState<PaletteMode>(
    prefersDarkMode ? "dark" : "light"
  );

  // System color-scheme
  useEffect(() => {
    setMode(prefersDarkMode ? "dark" : "light");
  }, [prefersDarkMode]);

  // const colorMode = useMemo(
  //   () => ({
  //     colorMode: mode,
  //     setColorMode: (mode: PaletteMode) => setMode(mode),
  //   }),
  //   []
  // );

  // Update the theme only if the mode changes
  const theme = useMemo(() => createTheme(getDesignTokens(mode)), [mode]);

  return (
    <>
      <CssBaseline />
      <GlobalStyle />

      <AppBarTitleContext.Provider value={{ appBarTitle, setAppBarTitle }}>
        <ColorModeContext.Provider
          value={{ colorMode: mode, setColorMode: setMode }}
        >
          <ListDensityContext.Provider value={{ dense, setDense }}>
            <ThemeProvider theme={theme}>
              <BrowserRouter>
                <Wrapper>
                  <AppBar />
                  <AppRouter />
                  <Toaster
                    position="bottom-center"
                    toastOptions={{
                      duration: 1200,
                    }}
                  />
                </Wrapper>
              </BrowserRouter>
            </ThemeProvider>
          </ListDensityContext.Provider>
        </ColorModeContext.Provider>
      </AppBarTitleContext.Provider>
    </>
  );
};

export default App;
