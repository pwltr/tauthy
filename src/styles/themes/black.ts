import { lighten, darken } from '@mui/material/styles'

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
        background: darken('#ffffff', 0.2),
      },
      active: {
        background: darken('#ffffff', 0.32),
      },
      disabled: {
        background: darken('#ffffff', 0.32),
        color: lighten('#000000', 0.2),
      },
    },
    secondary: {
      hover: {
        background: lighten('#31363b', 0.1),
      },
      active: {
        background: lighten('#ffffff', 0.32),
      },
      disabled: {
        background: darken('#ffffff', 0.32),
        color: lighten('#000000', 0.15),
      },
    },
  },
  switch: {
    unchecked: {
      thumb: {
        background: darken('#ffffff', 0.1),
      },
      track: {
        background: '#ffffff',
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
  textfield: {
    background: lighten('#000000', 0.07),
    hover: {
      background: lighten('#000000', 0.1),
    },
    focused: {
      background: lighten('#000000', 0.1),
    },
  },
}
