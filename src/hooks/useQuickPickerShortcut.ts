import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { type as osType } from '@tauri-apps/plugin-os'
import { useLocalStorage } from '~/hooks/useLocalStorage'

export const useQuickPickerShortcut = () => {
  const supported = osType() === 'macos'
  const [enabled, setEnabled] = useLocalStorage('quickPickerEnabled', true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!supported) return
    let active = true
    setError('')
    void invoke('quick_picker_configure', { enabled }).catch(() => {
      if (active) setError('shortcutUnavailable')
    })
    return () => {
      active = false
    }
  }, [enabled, supported])

  return { supported, enabled, setEnabled, error }
}
