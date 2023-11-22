import { type } from '@tauri-apps/api/os'
import { alpha, lighten, darken } from '@mui/material/styles'
import { grey } from '@mui/material/colors'

const platform = await type()

let primary = '#31363b'

if (platform === 'Darwin') {
  primary = '#363636'
}

if (platform === 'Windows_NT') {
  primary = '#191919'
}

export default {
  mui: {
    palette: {
      primary: {
        main: primary,
        darker: '#053e85',
      },
      secondary: {
        main: primary,
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
        background: lighten(primary, 0.1),
      },
      active: {
        background: lighten(primary, 0.32),
      },
      disabled: {
        background: lighten(primary, 0.4),
        color: darken('#ffffff', 0.15),
      },
    },
    secondary: {
      hover: {
        background: lighten(primary, 0.1),
      },
      active: {
        background: lighten(primary, 0.32),
      },
      disabled: {
        background: lighten(primary, 0.4),
        color: darken('#ffffff', 0.15),
      },
    },
  },
  switch: {
    unchecked: {
      thumb: {
        background: lighten(primary, 0.15),
      },
      track: {
        background: darken('#ffffff', 0.8),
      },
    },
    checked: {
      thumb: {
        background: primary,
      },
      track: {
        background: alpha('#ffffff', 1),
      },
    },
  },
  // keep default styles
  textfield: null,
}
