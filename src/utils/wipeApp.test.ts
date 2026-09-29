import { beforeEach, describe, expect, it, vi } from 'vitest'
import { wipeApp } from './wipeApp'

const mocks = vi.hoisted(() => ({ destroy: vi.fn() }))
vi.mock('~/utils/storage', () => ({ vault: { destroy: mocks.destroy } }))

describe('wipeApp', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    mocks.destroy.mockReset()
  })

  it('deletes the vault, clears browser state, and restarts at onboarding', async () => {
    const restart = vi.fn()
    localStorage.setItem('showWelcome', 'false')
    localStorage.setItem('theme', 'dark')
    sessionStorage.setItem('tauthy:developer-settings', 'true')
    mocks.destroy.mockResolvedValue(undefined)

    await wipeApp(restart)

    expect(mocks.destroy).toHaveBeenCalledOnce()
    expect(localStorage.length).toBe(0)
    expect(sessionStorage.length).toBe(0)
    expect(restart).toHaveBeenCalledExactlyOnceWith('/welcome')
  })

  it('retains settings and does not restart if vault deletion fails', async () => {
    const restart = vi.fn()
    localStorage.setItem('showWelcome', 'false')
    mocks.destroy.mockRejectedValue(new Error('deletion failed'))

    await expect(wipeApp(restart)).rejects.toThrow('deletion failed')

    expect(localStorage.getItem('showWelcome')).toBe('false')
    expect(restart).not.toHaveBeenCalled()
  })
})
