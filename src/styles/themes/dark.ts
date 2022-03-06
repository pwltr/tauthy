import { alpha, lighten } from '@mui/material/styles'

export default {
  mui: {
    palette: {
      primary: {
        main: '#ffffff',
        darker: '#ffffff',
      },
      secondary: {
        main: '#31363b',
      },
      neutral: {
        main: '#64748B',
        contrastText: '#ffffff',
      },
      background: {
        default: '#232629',
        paper: '#232629',
      },
      text: {
        primary: '#ffffff',
        secondary: '#999999',
      },
    },
    status: {
      danger: '#e53e3e',
    },
  },
  button: {
    primary: {
      hover: {
        background: alpha('#ffffff', 0.8),
      },
      active: {
        background: alpha('#ffffff', 0.32),
      },
    },
    secondary: {
      hover: {
        background: lighten('#31363b', 0.1),
      },
      active: {
        background: lighten('#ffffff', 0.32),
      },
    },
  },
}
