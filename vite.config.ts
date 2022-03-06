import { join } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const PACKAGE_ROOT = __dirname

// https://vitejs.dev/config/
export default defineConfig({
  root: PACKAGE_ROOT,
  build: {
    target: 'ESNext',
  },
  resolve: {
    alias: {
      '@mui/styled-engine': '@mui/styled-engine-sc',
      '~/': join(PACKAGE_ROOT, 'src') + '/',
      '~/components/': join(PACKAGE_ROOT, 'src') + '/components/',
      '~/hooks/': join(PACKAGE_ROOT, 'src') + '/hooks/',
      '~/styles/': join(PACKAGE_ROOT, 'src') + '/styles/',
      '~/utils/': join(PACKAGE_ROOT, 'src') + '/utils/',
    },
  },
  plugins: [react()],
})
