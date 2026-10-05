import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  language: 'en',
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: {
      language: mocks.language,
      resolvedLanguage: mocks.language,
    },
    t: (key: string) => key,
  }),
}))

import Appearance from '~/components/Appearance'
import { ListOptionsContext } from '~/context'

describe('Appearance', () => {
  it.each([false, true])(
    'hides Compact and preserves the saved density when changing number grouping (dense: %s)',
    (dense) => {
      const setListOptions = vi.fn()
      render(
        <ListOptionsContext.Provider value={{ dense, groupByTwos: false, setListOptions }}>
          <Appearance />
        </ListOptionsContext.Provider>,
      )

      expect(screen.queryByText('appearance.compact')).not.toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'appearance.grouping' }))
      expect(setListOptions).toHaveBeenCalledWith({ dense, groupByTwos: true })
    },
  )

  it('shows the active language for a base locale', () => {
    render(<Appearance />)

    const languageRow = screen.getByText('appearance.language').closest('li')
    expect(languageRow).not.toBeNull()
    expect(within(languageRow!).getByText('English')).toBeInTheDocument()
  })
})
