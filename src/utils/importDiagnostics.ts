import { invoke } from '@tauri-apps/api/core'

// Opt-in diagnostic bundles only. Never send file contents or error messages.
export const traceImport = (stage: string) => {
  if (import.meta.env.VITE_IMPORT_DIAGNOSTICS !== '1') return
  void invoke('import_diagnostic', { stage }).catch(() => undefined)
}

export const installImportDiagnostics = () => {
  if (import.meta.env.VITE_IMPORT_DIAGNOSTICS !== '1') return () => {}
  const error = () => traceImport('frontendError')
  const rejection = () => traceImport('unhandledRejection')
  window.addEventListener('error', error)
  window.addEventListener('unhandledrejection', rejection)
  traceImport('frontendReady')
  return () => {
    window.removeEventListener('error', error)
    window.removeEventListener('unhandledrejection', rejection)
  }
}
