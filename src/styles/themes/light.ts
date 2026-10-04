import { type } from '@tauri-apps/plugin-os'
import { alpha, lighten, darken } from '@mui/material/styles'
import { grey } from '@mui/material/colors'

const platform = await type()

let primary = '#31363b'
let secondary = '#31363b'

if (platform === 'macos') {
  primary = '#363636'
  secondary = '#ffffff'
}

if (platform === 'windows') {
  primary = '#191919'
  secondary = '#e8e8e9'
}

export default {
  mui: {
    palette: {
      primary: {
        main: primary,
        darker: '#053e85',
      },
      secondary: {
        main: secondary,
        ...(platform === 'macos' || platform === 'windows' ? { contrastText: grey[900] } : {}),
      },
      neutral: {
        main: '#64748B',
        contrastText: '#ffffff',
      },
      background: {
        default: platform === 'macos' ? '#ffffff' : '#232629',
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
