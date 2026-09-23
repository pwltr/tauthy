import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ toastSuccess: vi.fn() }))

vi.mock('@tauri-apps/api/app', () => ({ getVersion: () => Promise.resolve('0.4.0') }))
vi.mock('@tauri-apps/plugin-shell', () => ({ open: vi.fn() }))
vi.mock('react-hot-toast', () => ({ default: { success: mocks.toastSuccess } }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

import About from '~/components/About'

describe('About logo recovery gesture', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
    mocks.toastSuccess.mockReset()
  })

  it('enables sync recovery tools only after five presses', () => {
    render(<About />)
    const logo = screen.getByRole('button', { name: 'Tauthy' })

    for (let press = 0; press < 4; press += 1) fireEvent.click(logo)
    expect(window.sessionStorage.getItem('tauthy:sync-recovery-tools')).toBeNull()
    expect(mocks.toastSuccess).not.toHaveBeenCalled()

    fireEvent.click(logo)
    expect(window.sessionStorage.getItem('tauthy:sync-recovery-tools')).toBe('true')
    expect(mocks.toastSuccess).toHaveBeenCalledWith('about.syncRecoveryEnabled')
  })
})
