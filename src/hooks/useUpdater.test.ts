import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { relaunch } from '@tauri-apps/plugin-process'
import { check, type DownloadEvent, type Update } from '@tauri-apps/plugin-updater'

vi.mock('@tauri-apps/plugin-process', () => ({ relaunch: vi.fn() }))
vi.mock('@tauri-apps/plugin-updater', () => ({ check: vi.fn() }))

import useUpdater from '~/hooks/useUpdater'

const checkMock = vi.mocked(check)
const relaunchMock = vi.mocked(relaunch)

const createUpdate = () =>
  ({
    currentVersion: '0.3.1',
    version: '0.3.2',
    body: 'Release notes',
    close: vi.fn().mockResolvedValue(undefined),
    downloadAndInstall: vi.fn().mockResolvedValue(undefined),
  }) as unknown as Update

describe('useUpdater', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    relaunchMock.mockResolvedValue(undefined)
  })

  it('opens the updater when a release is available', async () => {
    const update = createUpdate()
    checkMock.mockResolvedValue(update)
    const { result } = renderHook(() => useUpdater())

    await act(async () => {
      expect(await result.current.checkForUpdate()).toBe(true)
    })

    expect(result.current.update).toBe(update)
    expect(result.current.status).toBe('available')
  })

  it('tracks download progress and relaunches after installation', async () => {
    const update = createUpdate()
    let reportProgress: ((event: DownloadEvent) => void) | undefined
    let finishDownload: (() => void) | undefined
    vi.mocked(update.downloadAndInstall).mockImplementation(
      (onEvent) =>
        new Promise<void>((resolve) => {
          reportProgress = onEvent
          finishDownload = resolve
        }),
    )
    checkMock.mockResolvedValue(update)
    const { result } = renderHook(() => useUpdater())

    await act(async () => {
      await result.current.checkForUpdate()
    })

    let installation: Promise<void> | undefined
    act(() => {
      installation = result.current.installUpdate()
    })
    expect(result.current.status).toBe('downloading')

    act(() => {
      reportProgress?.({ event: 'Started', data: { contentLength: 100 } })
      reportProgress?.({ event: 'Progress', data: { chunkLength: 40 } })
    })
    expect(result.current.contentLength).toBe(100)
    expect(result.current.downloadedBytes).toBe(40)

    await act(async () => {
      reportProgress?.({ event: 'Finished' })
      finishDownload?.()
      await installation
    })

    expect(result.current.status).toBe('installing')
    expect(relaunchMock).toHaveBeenCalledOnce()
  })

  it('keeps the dialog open with a retry state when installation fails', async () => {
    const update = createUpdate()
    vi.mocked(update.downloadAndInstall).mockRejectedValue(new Error('network unavailable'))
    checkMock.mockResolvedValue(update)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { result } = renderHook(() => useUpdater())

    await act(async () => {
      await result.current.checkForUpdate()
    })

    await act(async () => {
      await result.current.installUpdate()
    })

    expect(result.current.status).toBe('error')
    expect(result.current.error).toBe('network unavailable')
    expect(relaunchMock).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })
})
