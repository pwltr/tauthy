import { act, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  generateTOTPs: vi.fn(),
  getVault: vi.fn(),
  translate: (key: string) => key,
}))

vi.mock('~/utils/storage', () => ({ vault: { getVault: mocks.getVault } }))
vi.mock('~/utils', () => ({
  SYNC_COMPLETE_EVENT: 'tauthy:sync-complete',
  generateTOTPs: mocks.generateTOTPs,
  getTOTPRefreshDelay: (expiresAtMs: number) => Math.max(expiresAtMs - Date.now(), 1),
}))
vi.mock('~/components/EntryList', () => ({
  default: ({ entries }: { entries: Array<{ token?: string }> }) => (
    <div data-testid="account-list">{entries[0]?.token}</div>
  ),
}))
vi.mock('~/components/ProgressBar', () => ({
  default: ({ durationMs }: { durationMs: number }) => (
    <div data-testid="progress" data-duration={durationMs} />
  ),
}))
vi.mock('react-i18next', () => ({
  Trans: () => null,
  useTranslation: () => ({ t: mocks.translate }),
}))

import Codes from '~/components/Codes'

const flushPromises = () =>
  act(async () => {
    for (let index = 0; index < 5; index += 1) await Promise.resolve()
  })

describe('code expiration timing', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(20_000)
    mocks.getVault.mockReset()
    mocks.generateTOTPs.mockReset()
    mocks.getVault.mockResolvedValue([
      { uuid: 'account', name: 'Account', issuer: 'Issuer', secret: 'secret' },
    ])
    mocks.generateTOTPs
      .mockResolvedValueOnce({ codes: ['111111'], expiresAtMs: 28_000 })
      .mockResolvedValueOnce({ codes: ['222222'], expiresAtMs: 58_000 })
  })

  afterEach(() => vi.useRealTimers())

  it('starts with the actual remaining lifetime and refreshes at expiry', async () => {
    render(
      <MemoryRouter>
        <Codes />
      </MemoryRouter>,
    )
    await flushPromises()

    expect(screen.getByTestId('account-list')).toHaveTextContent('111111')
    expect(screen.getByTestId('progress')).toHaveAttribute('data-duration', '8000')

    await act(() => vi.advanceTimersByTimeAsync(7_999))
    expect(mocks.generateTOTPs).toHaveBeenCalledOnce()

    await act(() => vi.advanceTimersByTimeAsync(1))
    await flushPromises()

    expect(mocks.generateTOTPs).toHaveBeenCalledTimes(2)
    expect(screen.getByTestId('account-list')).toHaveTextContent('222222')
    expect(screen.getByTestId('progress')).toHaveAttribute('data-duration', '30000')
  })
})
