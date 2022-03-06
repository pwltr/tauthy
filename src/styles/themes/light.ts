import { lighten } from '@mui/material/styles'
import { grey } from '@mui/material/colors'

export default {
  mui: {
    palette: {
      primary: {
        main: '#31363b',
        darker: '#053e85',
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
        paper: '#ffffff',
      },
      text: {
        primary: grey[900],
        secondary: grey[800],
      },
    },
    status: {
      danger: '#e53e3e',
    },
  },
  button: {
    primary: {
      hover: {
        background: lighten('#31363b', 0.1),
      },
      active: {
        background: lighten('#ffffff', 0.32),
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
