import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { AppBarTitleContext, SortContext, ThemeContext } from '~/context'

const mocks = vi.hoisted(() => ({
  changeLanguage: vi.fn(),
  language: 'de-DE',
  translate: (key: string) =>
    ({
      'appearance.language': 'Language',
      'appearance.selectTheme': 'Select theme',
      'appearance.sortOrder': 'Sort order',
      'appearance.sortOptions.custom': 'Manual order',
      'appearance.sortOptions.a-z': 'Issuer, A–Z',
      'appearance.sortOptions.z-a': 'Issuer, Z–A',
      'appearance.sortOptions.frequent': 'Frequently used',
      'appearance.sortOptions.recent': 'Recently used',
      'appearance.theme': 'Theme',
      'appearance.themes.black': 'Black',
      'appearance.themes.dark': 'Dark',
      'appearance.themes.light': 'Light',
      'appearance.themes.system': 'System',
    })[key] ?? key,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: {
      changeLanguage: mocks.changeLanguage,
      language: mocks.language,
      resolvedLanguage: mocks.language,
    },
    t: mocks.translate,
  }),
}))

import Language from '~/components/modals/Language'
import Sort from '~/components/modals/Sort'
import Theme from '~/components/modals/Theme'

describe('selection modals', () => {
  it('shows the active theme and applies a new selection', () => {
    const onClose = vi.fn()
    const setTheme = vi.fn()
    const trigger = document.createElement('button')
    document.body.appendChild(trigger)
    trigger.focus()

    const { unmount } = render(
      <AppBarTitleContext.Provider value={{ appBarTitle: '', setAppBarTitle: vi.fn() }}>
        <ThemeContext.Provider value={{ theme: 'dark', setTheme }}>
          <Theme open onClose={onClose} />
        </ThemeContext.Provider>
      </AppBarTitleContext.Provider>,
    )

    expect(screen.getByRole('radio', { name: 'Dark' })).toBeChecked()

    fireEvent.click(screen.getByRole('radio', { name: 'System' }))

    expect(setTheme).toHaveBeenCalledWith('system')
    expect(onClose).toHaveBeenCalledOnce()
    unmount()
    trigger.remove()
  })

  it('normalizes the active language and applies a new selection', () => {
    const onClose = vi.fn()
    const trigger = document.createElement('button')
    document.body.appendChild(trigger)
    trigger.focus()

    const { unmount } = render(<Language open onClose={onClose} />)

    expect(screen.getByRole('radio', { name: 'Deutsch' })).toBeChecked()

    fireEvent.click(screen.getByRole('radio', { name: 'Français' }))

    expect(mocks.changeLanguage).toHaveBeenCalledWith('fr-FR')
    expect(onClose).toHaveBeenCalledOnce()
    unmount()
    trigger.remove()
  })

  it('shows the active sort order and applies a new selection', () => {
    const onClose = vi.fn()
    const setSortOption = vi.fn()
    const trigger = document.createElement('button')
    document.body.appendChild(trigger)
    trigger.focus()

    const { unmount } = render(
      <SortContext.Provider
        value={{
          sortOption: 'a-z',
          setSortOption,
          customOrder: [],
          setCustomOrder: vi.fn(),
          entryUsage: {},
        }}
      >
        <Sort open onClose={onClose} />
      </SortContext.Provider>,
    )

    expect(screen.getByRole('radio', { name: 'Issuer, A–Z' })).toBeChecked()
    fireEvent.click(screen.getByRole('radio', { name: 'Frequently used' }))

    expect(setSortOption).toHaveBeenCalledWith('frequent')
    expect(onClose).toHaveBeenCalledOnce()
    unmount()
    trigger.remove()
  })
})
