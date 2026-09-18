import { useCallback, useState } from 'react'
import { relaunch } from '@tauri-apps/plugin-process'
import { check, type Update } from '@tauri-apps/plugin-updater'

export type UpdaterStatus = 'idle' | 'available' | 'downloading' | 'installing' | 'error'

const formatError = (error: unknown) => (error instanceof Error ? error.message : String(error))

const useUpdater = () => {
  const [update, setUpdate] = useState<Update | null>(null)
  const [status, setStatus] = useState<UpdaterStatus>('idle')
  const [downloadedBytes, setDownloadedBytes] = useState(0)
  const [contentLength, setContentLength] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const checkForUpdate = useCallback(async () => {
    try {
      const availableUpdate = await check()

      if (!availableUpdate) return false

      setUpdate(availableUpdate)
      setStatus('available')
      setError(null)
      return true
    } catch (err) {
      // Update checks should fail quietly when the user is offline. Installation
      // errors are shown in the dialog because the user initiated that action.
      console.error(err)
      return false
    }
  }, [])

  const installUpdate = useCallback(async () => {
    if (!update) return

    setDownloadedBytes(0)
    setContentLength(null)
    setError(null)
    setStatus('downloading')

    try {
      await update.downloadAndInstall((event) => {
        switch (event.event) {
          case 'Started':
            setContentLength(event.data.contentLength ?? null)
            break
          case 'Progress':
            setDownloadedBytes((downloaded) => downloaded + event.data.chunkLength)
            break
          case 'Finished':
            setStatus('installing')
            break
        }
      })

      setStatus('installing')
      await relaunch()
    } catch (err) {
      console.error(err)
      setError(formatError(err))
      setStatus('error')
    }
  }, [update])

  const dismissUpdate = useCallback(() => {
    if (status === 'downloading' || status === 'installing') return

    if (update) void update.close()
    setUpdate(null)
    setStatus('idle')
    setDownloadedBytes(0)
    setContentLength(null)
    setError(null)
  }, [status, update])

  return {
    update,
    status,
    downloadedBytes,
    contentLength,
    error,
    checkForUpdate,
    installUpdate,
    dismissUpdate,
  }
}

export default useUpdater
