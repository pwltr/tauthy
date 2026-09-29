import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import { AppBarTitleContext } from '~/context'

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  writeTextFile: vi.fn(),
  exportDiagnostics: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}))
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: mocks.save }))
vi.mock('@tauri-apps/plugin-fs', () => ({ writeTextFile: mocks.writeTextFile }))
vi.mock('~/utils/diagnostics', () => ({ exportDiagnostics: mocks.exportDiagnostics }))
vi.mock('react-hot-toast', () => ({
  default: { success: mocks.success, error: mocks.error },
}))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

import Settings from './Settings'

const renderSettings = () =>
  render(
    <MemoryRouter>
      <AppBarTitleContext.Provider value={{ appBarTitle: '', setAppBarTitle: vi.fn() }}>
        <Settings />
      </AppBarTitleContext.Provider>
    </MemoryRouter>,
  )

beforeEach(() => {
  Object.values(mocks).forEach((mock) => mock.mockReset())
  mocks.writeTextFile.mockResolvedValue(undefined)
  mocks.exportDiagnostics.mockResolvedValue('safe diagnostic text')
})

it('exports only after the user chooses a destination', async () => {
  mocks.save.mockResolvedValue('/chosen/tauthy-logs.txt')
  renderSettings()
  fireEvent.click(screen.getByText('diagnostics.export'))

  await waitFor(() =>
    expect(mocks.writeTextFile).toHaveBeenCalledWith(
      '/chosen/tauthy-logs.txt',
      'safe diagnostic text',
    ),
  )
  expect(mocks.success).toHaveBeenCalledWith('diagnostics.exported')
})

it('does not export when the save dialog is canceled', async () => {
  mocks.save.mockResolvedValue(null)
  renderSettings()
  fireEvent.click(screen.getByText('diagnostics.export'))

  await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce())
  expect(mocks.exportDiagnostics).not.toHaveBeenCalled()
  expect(mocks.writeTextFile).not.toHaveBeenCalled()
})

it('reports a failed write without claiming an export succeeded', async () => {
  mocks.save.mockResolvedValue('/chosen/tauthy-logs.txt')
  mocks.writeTextFile.mockRejectedValue(new Error('permission denied'))
  renderSettings()
  fireEvent.click(screen.getByText('diagnostics.export'))

  await waitFor(() => expect(mocks.error).toHaveBeenCalledWith('diagnostics.exportFailed'))
  expect(mocks.success).not.toHaveBeenCalled()
})
