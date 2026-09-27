import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ reminder: true, dismiss: vi.fn(), snooze: vi.fn() }))
vi.mock('~/hooks/useBackupStatus', () => ({ useBackupStatus: () => mocks }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
import BackupReminder from './BackupReminder'

const ExportDestination = () => {
  const location = useLocation()
  return <div>{location.state?.encryptedExport ? 'Encrypted export' : 'Import'}</div>
}
const show = () =>
  render(
    <MemoryRouter>
      <Routes>
        <Route path="/" element={<BackupReminder />} />
        <Route path="/import" element={<ExportDestination />} />
      </Routes>
    </MemoryRouter>,
  )
describe('backup reminder actions', () => {
  beforeEach(() => {
    localStorage.clear()
    mocks.reminder = true
    vi.clearAllMocks()
  })
  it('opens encrypted export directly', () => {
    show()
    fireEvent.click(screen.getByText('backup.export'))
    expect(screen.getByText('Encrypted export')).toBeInTheDocument()
  })
  it('allows snoozing and dismissing', () => {
    show()
    fireEvent.click(screen.getByText('backup.later'))
    expect(mocks.snooze).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(mocks.dismiss).toHaveBeenCalledOnce()
  })
  it('always enables reminders regardless of the old preference', () => {
    localStorage.setItem('backupReminders', 'false')
    show()
    expect(screen.getByText('backup.reminder')).toBeInTheDocument()
  })
  it('does not show a reminder until due', () => {
    mocks.reminder = false
    show()
    expect(screen.queryByText('backup.reminder')).not.toBeInTheDocument()
  })
})
