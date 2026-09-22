import { type } from '@tauri-apps/plugin-os'
import { createGlobalStyle, css } from 'styled-components'

const platform = await type()

// Keep WebKit's native overlay scrollbars, but avoid the wider variant that
// `color-scheme` selects on macOS. Windows keeps its native default width.
const macosScrollbarStyle =
  platform === 'macos'
    ? css`
        * {
          scrollbar-width: thin;
        }
      `
    : ''

const GlobalStyle = createGlobalStyle`
  ${macosScrollbarStyle}

  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Oxygen-Sans", "Noto Sans", "Ubuntu", "Cantarell", Roboto, Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol";
    height: 100%;
    overflow: hidden;
    margin: 0;
    padding: 0;
    -webkit-overflow-scrolling: touch;
  }
`

export default GlobalStyle
