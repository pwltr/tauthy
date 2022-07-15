import { join } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const PACKAGE_ROOT = __dirname

export default defineConfig({
  root: PACKAGE_ROOT,
  server: {
    port: 3000,
  },
  build: {
    target: 'ESNext',
    rollupOptions: {
      output: {
        entryFileNames: `assets/[name].js`,
        chunkFileNames: `assets/[name].js`,
        assetFileNames: `assets/[name].[ext]`,
      },
    },
  },
  resolve: {
    alias: {
      '@mui/styled-engine': '@mui/styled-engine-sc',
      '~/': join(PACKAGE_ROOT, 'src') + '/',
      '~/components/': join(PACKAGE_ROOT, 'src') + '/components/',
      '~/hooks/': join(PACKAGE_ROOT, 'src') + '/hooks/',
      '~/locales/': join(PACKAGE_ROOT, 'src') + '/locales/',
      '~/styles/': join(PACKAGE_ROOT, 'src') + '/styles/',
      '~/utils/': join(PACKAGE_ROOT, 'src') + '/utils/',
    },
  },
  plugins: [react()],
})
