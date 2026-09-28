import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  language: 'en',
  translate: (key: string) =>
    ({
      'appearance.language': 'Language',
      'appearance.pageTitle': 'Appearance',
      'appearance.theme': 'Theme',
      'appearance.themes.light': 'Light',
    })[key] ?? key,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: {
      language: mocks.language,
      resolvedLanguage: mocks.language,
    },
    t: mocks.translate,
  }),
}))

import Appearance from '~/components/Appearance'

describe('Appearance', () => {
  it('shows the active language for a base locale', () => {
    render(<Appearance />)

    const languageRow = screen.getByText('Language').closest('li')
    expect(languageRow).not.toBeNull()
    expect(within(languageRow!).getByText('English')).toBeInTheDocument()
  })
})
