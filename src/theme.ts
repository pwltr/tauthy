import { createTheme, ThemeOptions } from "@mui/material/styles";
import { blueGrey, amber, grey } from "@mui/material/colors";

declare module "@mui/material/styles" {
  interface Theme {
    status: {
      danger: React.CSSProperties["color"];
    };
  }

  interface Palette {
    neutral: Palette["primary"];
  }
  interface PaletteOptions {
    neutral: PaletteOptions["primary"];
  }
  interface PaletteColor {
    darker?: string;
  }
  interface SimplePaletteColorOptions {
    darker?: string;
  }
  interface ThemeOptions {
    status: {
      danger: React.CSSProperties["color"];
    };
  }
}

export type PaletteMode = "light" | "dark" | "black";

export const lightTheme = createTheme({
  status: {
    danger: "#e53e3e",
  },
  palette: {
    primary: {
      main: "#31363b",
      darker: "#053e85",
    },
    secondary: {
      main: "#31363b",
    },
    neutral: {
      main: "#64748B",
      contrastText: "#ffffff",
    },
    background: {
      default: "#232629",
      paper: "#ffffff",
    },
    text: {
      primary: grey[900],
      secondary: grey[800],
    },
  },
});

export const darkTheme = createTheme({
  status: {
    danger: "#e53e3e",
  },
  palette: {
    primary: {
      main: "#ffffff",
      darker: "#ffffff",
    },
    secondary: {
      main: "#31363b",
    },
    neutral: {
      main: "#64748B",
      contrastText: "#fff",
    },
    background: {
      default: "#232629",
      paper: "#232629",
    },
    text: {
      primary: "#ffffff",
      secondary: "#999999",
    },
  },
});

export const blackTheme = createTheme({
  status: {
    danger: "#e53e3e",
  },
  palette: {
    primary: {
      main: "#ffffff",
      darker: "#ffffff",
    },
    secondary: {
      main: "#000000",
      darker: "#ffffff",
    },
    neutral: {
      main: "#64748B",
      contrastText: "#fff",
    },
    background: {
      default: "#000000",
      paper: "#000000",
    },
    text: {
      primary: "#ffffff",
      secondary: "#ffffff",
    },
  },
});

const themes = {
  light: lightTheme,
  dark: darkTheme,
  black: blackTheme,
};

const defaultTheme = lightTheme;

export const getDesignTokens = (mode: PaletteMode): ThemeOptions => ({
  ...defaultTheme,
  palette: {
    ...defaultTheme.palette,
    primary: {
      ...blueGrey,
      main: themes[mode].palette.primary.main,
    },
    secondary: themes[mode].palette.secondary,
    background: themes[mode].palette.background,
    text: themes[mode].palette.text,
  },
});
