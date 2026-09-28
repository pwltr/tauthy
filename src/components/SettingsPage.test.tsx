import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import SettingsPage from '~/components/SettingsPage'

describe('SettingsPage', () => {
  it('scrolls its content with space below the final item', () => {
    render(<SettingsPage data-testid="settings-page">Settings</SettingsPage>)

    expect(screen.getByTestId('settings-page')).toHaveStyle({
      flex: '1 1 0%',
      minHeight: '0',
      overflowY: 'auto',
      paddingBottom: '24px',
    })
  })
})
