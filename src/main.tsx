import { createRoot } from 'react-dom/client'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'

const container = document.getElementById('root')
if (!container) throw new Error('Failed to find the root element')
const root = createRoot(container)
if (getCurrentWebviewWindow().label === 'quick-picker') {
  void import('~/components/QuickPicker').then(({ default: QuickPicker }) => {
    root.render(<QuickPicker />)
  })
} else {
  void import('~/App').then(({ default: App }) => {
    root.render(<App />)
  })
}
