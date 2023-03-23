import { type } from '@tauri-apps/api/os'
import { lighten, darken } from '@mui/material/styles'

const isMac = (await type()) === 'Darwin'

const secondary = isMac ? '#363636' : '#31363b'
const background = isMac ? '#282828' : '#232629'

export default {
  mui: {
    palette: {
      primary: {
        main: '#ffffff',
        darker: '#ffffff',
      },
      secondary: {
        main: secondary,
      },
      neutral: {
        main: '#64748B',
        contrastText: '#ffffff',
      },
      background: {
        default: background,
        paper: background,
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
        background: darken('#ffffff', 0.2),
      },
      active: {
        background: darken('#ffffff', 0.32),
      },
      disabled: {
        background: darken('#ffffff', 0.4),
        color: lighten(secondary, 0.15),
      },
    },
    secondary: {
      hover: {
        background: lighten(secondary, 0.1),
      },
      active: {
        background: lighten('#ffffff', 0.32),
      },
      disabled: {
        background: lighten('#ffffff', 0.32),
        color: lighten(secondary, 0.15),
      },
    },
  },
  switch: {
    unchecked: {
      thumb: {
        background: darken('#ffffff', 0.15),
      },
      track: {
        background: darken('#ffffff', 0.2),
      },
    },
    checked: {
      thumb: {
        background: '#ffffff',
      },
      track: {
        background: '#ffffff',
      },
    },
  },
  // keep default styles
  textfield: null,
}
