import { beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.hoisted(() => vi.fn())

vi.mock('@tauri-apps/api/core', () => ({ invoke }))
vi.mock('~/utils/storage', () => ({ vault: {} }))

import { generateTOTPs, getTOTPRefreshDelay } from '~/utils/codes'

describe('TOTP refresh timing', () => {
  beforeEach(() => invoke.mockReset())

  it('uses the backend expiry to schedule the next refresh', () => {
    expect(getTOTPRefreshDelay(28_000, 20_000)).toBe(8_000)
    expect(getTOTPRefreshDelay(28_000, 27_999)).toBe(1)
    expect(getTOTPRefreshDelay(28_000, 28_001)).toBe(1)
  })

  it('preserves codes and their shared expiry from the backend', async () => {
    invoke.mockResolvedValue({ codes: ['123456', null], expiresAtMs: 28_000 })

    await expect(generateTOTPs(['valid', 'invalid'])).resolves.toEqual({
      codes: ['123456', null],
      expiresAtMs: 28_000,
    })
  })

  it('retries quickly after a backend failure', async () => {
    const before = Date.now()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    invoke.mockRejectedValueOnce(new Error('backend unavailable'))

    const result = await generateTOTPs(['secret'])
    consoleError.mockRestore()

    expect(result.codes).toEqual([null])
    expect(result.expiresAtMs).toBeGreaterThanOrEqual(before + 1000)
    expect(result.expiresAtMs).toBeLessThanOrEqual(Date.now() + 1000)
  })
})
