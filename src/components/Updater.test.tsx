import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Update } from '@tauri-apps/plugin-updater'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, string | number>) =>
      ({
        'updater.title': 'Tauthy update',
        'updater.version': `Version ${values?.version}`,
        'updater.available': `Tauthy ${values?.version} is available; you have ${values?.currentVersion}.`,
        'updater.installPrompt': 'Install it now?',
        'updater.releaseNotes': 'Release notes',
        'updater.later': 'Not now',
        'updater.update': 'Update',
        'updater.retry': 'Try again',
        'updater.downloading': 'Downloading update…',
        'updater.downloadingProgress': `Downloading update… ${values?.progress}%`,
        'updater.downloadProgress': 'Update download progress',
        'updater.installing': 'Installing update…',
        'updater.installProgress': 'Update installation progress',
        'updater.error': 'The update could not be installed.',
      })[key] ?? key,
  }),
}))

import Updater from '~/components/Updater'

const update = {
  currentVersion: '0.3.1',
  version: '0.3.2',
  body: '## Improvements\n\n- A useful fix\n- Another improvement',
} as Update

const defaultProps = {
  update,
  status: 'available' as const,
  downloadedBytes: 0,
  contentLength: null,
  error: null,
  onInstall: vi.fn(),
  onDismiss: vi.fn(),
}

describe('Updater', () => {
  it('shows version details, release notes, and update choices', () => {
    const onInstall = vi.fn()
    const onDismiss = vi.fn()
    render(<Updater {...defaultProps} onInstall={onInstall} onDismiss={onDismiss} />)

    expect(screen.getByText('Tauthy 0.3.2 is available; you have 0.3.1.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Improvements' })).toBeInTheDocument()
    expect(screen.getByRole('list')).toBeInTheDocument()
    expect(screen.getByText('A useful fix')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Update' }))
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }))
    expect(onInstall).toHaveBeenCalledOnce()
    expect(onDismiss).toHaveBeenCalledOnce()
  })

  it('shows determinate download progress and prevents dismissal', () => {
    render(
      <Updater {...defaultProps} status="downloading" downloadedBytes={25} contentLength={100} />,
    )

    expect(screen.getByText('Downloading update… 25%')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'Update download progress' })).toHaveAttribute(
      'aria-valuenow',
      '25',
    )
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('offers retry or dismissal after an installation error', () => {
    const onInstall = vi.fn()
    render(
      <Updater
        {...defaultProps}
        status="error"
        error="network unavailable"
        onInstall={onInstall}
      />,
    )

    expect(screen.getByText(/network unavailable/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onInstall).toHaveBeenCalledOnce()
  })
})
