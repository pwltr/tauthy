import { alpha, lighten, darken } from '@mui/material/styles'
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
        background: lighten('#31363b', 0.32),
      },
      disabled: {
        background: lighten('#31363b', 0.4),
        color: darken('#ffffff', 0.15),
      },
    },
    secondary: {
      hover: {
        background: lighten('#31363b', 0.1),
      },
      active: {
        background: lighten('#31363b', 0.32),
      },
      disabled: {
        background: lighten('#31363b', 0.4),
        color: darken('#ffffff', 0.15),
      },
    },
  },
  switch: {
    unchecked: {
      thumb: {
        background: lighten('#31363b', 0.15),
      },
      track: {
        background: darken('#ffffff', 0.8),
      },
    },
    checked: {
      thumb: {
        background: '#31363b',
      },
      track: {
        background: alpha('#ffffff', 1),
      },
    },
  },
  // keep default styles
  textfield: null,
}
