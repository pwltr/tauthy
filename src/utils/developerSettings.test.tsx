import { useSyncExternalStore } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  developerSettingsEnabled,
  enableDeveloperSettings,
  subscribeDeveloperSettings,
} from '~/utils/developerSettings'

const DeveloperSettingsStatus = () => {
  const enabled = useSyncExternalStore(subscribeDeveloperSettings, developerSettingsEnabled)

  return (
    <button onClick={enableDeveloperSettings}>
      {enabled ? 'Developer settings on' : 'Developer settings off'}
    </button>
  )
}

describe('developer settings visibility', () => {
  beforeEach(() => window.sessionStorage.clear())

  it('updates subscribers immediately when developer settings are enabled', () => {
    render(<DeveloperSettingsStatus />)
    fireEvent.click(screen.getByRole('button', { name: 'Developer settings off' }))
    expect(screen.getByRole('button', { name: 'Developer settings on' })).toBeInTheDocument()
  })

  it('restores the enabled state from session storage', () => {
    enableDeveloperSettings()
    render(<DeveloperSettingsStatus />)
    expect(screen.getByRole('button', { name: 'Developer settings on' })).toBeInTheDocument()
  })
})
