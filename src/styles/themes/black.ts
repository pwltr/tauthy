import { alpha, lighten } from '@mui/material/styles'

export default {
  mui: {
    palette: {
      primary: {
        main: '#ffffff',
        darker: '#ffffff',
      },
      secondary: {
        main: '#000000',
        darker: '#ffffff',
      },
      neutral: {
        main: '#64748B',
        contrastText: '#ffffff',
      },
      background: {
        default: '#000000',
        paper: '#000000',
      },
      text: {
        primary: '#ffffff',
        secondary: '#ffffff',
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
