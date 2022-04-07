import { createTheme, ThemeOptions } from '@mui/material/styles'
import { blueGrey } from '@mui/material/colors'

import themes from './themes'

declare module '@mui/material/styles' {
  interface Theme {
    status: {
      danger: React.CSSProperties['color']
    }
  }

  interface Palette {
    neutral: Palette['primary']
  }
  interface PaletteOptions {
    neutral: PaletteOptions['primary']
  }
  interface PaletteColor {
    darker?: string
  }
  interface SimplePaletteColorOptions {
    darker?: string
  }
  interface ThemeOptions {
    status: {
      danger: React.CSSProperties['color']
    }
  }
}

export type PaletteMode = 'light' | 'dark' | 'black'

const defaultTheme = createTheme(themes.light.mui)

export const getDesignTokens = (mode: PaletteMode): ThemeOptions => ({
  ...defaultTheme,
  palette: {
    ...defaultTheme.palette,
    primary: {
      ...blueGrey,
      main: themes[mode].mui.palette.primary.main,
    },
    secondary: themes[mode].mui.palette.secondary,
    error: {
      main: '#ff0000',
    },
    background: themes[mode].mui.palette.background,
    text: themes[mode].mui.palette.text,
  },
  typography: { fontFamily: 'inherit' },
  components: {
    MuiButton: {
      variants: [
        {
          props: { variant: 'contained' },
          style: { textTransform: 'none' },
        },
        {
          props: { variant: 'contained', color: 'primary' },
          style: {
            backgroundColor: 'primary.light',
            '&:hover': {
              backgroundColor: themes[mode].button.primary.hover.background,
            },
            '&:active': {
              backgroundColor: themes[mode].button.primary.active.background,
            },
            '&:disabled': {
              backgroundColor: themes[mode].button.primary.disabled.background,
              color: themes[mode].button.primary.disabled.color,
            },
          },
        },
        {
          props: { variant: 'contained', color: 'secondary' },
          style: {
            backgroundColor: 'secondary.light',
            '&:hover': {
              backgroundColor: themes[mode].button.secondary.hover.background,
            },
            '&:active': {
              backgroundColor: themes[mode].button.secondary.active.background,
            },
            '&:disabled': {
              backgroundColor: themes[mode].button.secondary.disabled.background,
              color: themes[mode].button.secondary.disabled.color,
            },
          },
        },
      ],
    },
    MuiFab: {
      variants: [
        {
          props: { color: 'primary' },
          style: {
            backgroundColor: 'primary.light',
            '&:hover': {
              backgroundColor: themes[mode].button.primary.hover.background,
            },
            '&:active': {
              backgroundColor: themes[mode].button.primary.active.background,
            },
          },
        },
      ],
    },
    MuiSwitch: {
      styleOverrides: {
        switchBase: {
          color: themes[mode].switch.unchecked.thumb.background,
        },
        track: {
          background: themes[mode].switch.unchecked.track.background,
          opacity: 0.15,
        },
      },
    },
    MuiTextField: {
      variants: [
        {
          props: { variant: 'filled' },
          style: {
            backgroundColor: themes[mode].textfield?.background,
            '&:hover': {
              backgroundColor: themes[mode].textfield?.hover.background,
            },
            '.Mui-focused': {
              backgroundColor: themes[mode].textfield?.focused.background,
            },
          },
        },
      ],
    },
  },
})
