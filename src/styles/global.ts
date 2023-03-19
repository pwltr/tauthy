import { createGlobalStyle } from 'styled-components'

const GlobalStyle = createGlobalStyle`
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
