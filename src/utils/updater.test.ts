import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  ask: vi.fn(),
  check: vi.fn(),
  close: vi.fn(),
  downloadAndInstall: vi.fn(),
  relaunch: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({ ask: mocks.ask }))
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch: mocks.relaunch }))
vi.mock('@tauri-apps/plugin-updater', () => ({ check: mocks.check }))

import { checkUpdate } from '~/utils/updater'

describe('updater resource lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.check.mockResolvedValue({
      version: '0.7.0',
      close: mocks.close,
      downloadAndInstall: mocks.downloadAndInstall,
    })
  })

  it('closes the update resource when the user postpones the update', async () => {
    mocks.ask.mockResolvedValue(false)

    await expect(checkUpdate()).resolves.toBe(true)
    expect(mocks.downloadAndInstall).not.toHaveBeenCalled()
    expect(mocks.close).toHaveBeenCalledOnce()
  })

  it('closes the update resource after installing and requesting a relaunch', async () => {
    mocks.ask.mockResolvedValue(true)

    await expect(checkUpdate()).resolves.toBe(true)
    expect(mocks.downloadAndInstall).toHaveBeenCalledOnce()
    expect(mocks.relaunch).toHaveBeenCalledOnce()
    expect(mocks.close).toHaveBeenCalledOnce()
  })
})
