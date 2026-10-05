import { useEffect, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { type as osType } from '@tauri-apps/plugin-os'

export function useStartupVisibility(background: string) {
  const revealSent = useRef(false)

  useEffect(() => {
    if (!['macos', 'windows'].includes(osType()) || revealSent.current) return

    // Keep the native window hidden while the webview paints React's theme.
    const timer = window.setTimeout(() => {
      revealSent.current = true
      void invoke('startup_ready', { background }).catch(console.error)
    }, 100)
    return () => window.clearTimeout(timer)
  }, [background])
}
