import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BACKUP_STATUS_EVENT,
  BACKUP_STATUS_KEY,
  WEEK_MS,
  getBackupStatus,
} from '~/utils/backupStatus'
import { enableDeveloperSettings } from '~/utils/developerSettings'
import DeveloperSettings from './DeveloperSettings'

const mocks = vi.hoisted(() => ({ error: vi.fn() }))
vi.mock('react-hot-toast', () => ({ default: { error: mocks.error } }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

const show = () =>
  render(
    <MemoryRouter initialEntries={['/developer']}>
      <Routes>
        <Route path="/developer" element={<DeveloperSettings />} />
        <Route path="/settings" element={<div>Settings destination</div>} />
        <Route path="/" element={<div>Home destination</div>} />
      </Routes>
    </MemoryRouter>,
  )

describe('developer backup reminder preview', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    vi.restoreAllMocks()
    mocks.error.mockReset()
  })

  it('rejects direct navigation until developer settings are enabled', () => {
    show()
    expect(screen.getByText('Settings destination')).toBeInTheDocument()
    expect(screen.queryByText('developer.previewBackup')).not.toBeInTheDocument()
  })

  it('resets the receipt and snooze, triggers refresh, and returns home', async () => {
    enableDeveloperSettings()
    localStorage.setItem(
      BACKUP_STATUS_KEY,
      JSON.stringify({ exportedAt: Date.now(), snoozedUntil: Date.now() + WEEK_MS }),
    )
    localStorage.setItem('unrelated', 'unchanged')
    const refresh = vi.fn()
    window.addEventListener(BACKUP_STATUS_EVENT, refresh)
    show()
    fireEvent.click(screen.getByRole('button', { name: 'developer.previewBackup' }))
    expect(screen.getByText('Home destination')).toBeInTheDocument()
    expect(refresh).toHaveBeenCalledOnce()
    const metadata = JSON.parse(localStorage.getItem(BACKUP_STATUS_KEY)!)
    expect(metadata.firstSeenAt).toBeLessThan(Date.now() - WEEK_MS)
    expect(metadata.exportedAt).toBeUndefined()
    expect(metadata.snoozedUntil).toBeUndefined()
    expect(localStorage.getItem('unrelated')).toBe('unchanged')
    expect((await getBackupStatus([{ uuid: 'test', name: 'Test', secret: 'ABC' }])).reminder).toBe(
      true,
    )
    window.removeEventListener(BACKUP_STATUS_EVENT, refresh)
  })

  it('shows an error and stays on the screen when storage fails', () => {
    enableDeveloperSettings()
    show()
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('unavailable')
    })
    fireEvent.click(screen.getByRole('button', { name: 'developer.previewBackup' }))
    expect(mocks.error).toHaveBeenCalledWith('developer.previewFailed')
    expect(screen.queryByText('Home destination')).not.toBeInTheDocument()
  })
})
