import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: { format?: string }) =>
      values?.format ? `${key}:${values.format}` : key,
  }),
}))
vi.mock('~/components/Modal', () => ({
  default: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div>{children}</div> : null,
  Buttons: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

import ImportPasswordModal from '~/components/modals/ImportPassword'

describe('ImportPasswordModal', () => {
  it('shows the selected format and submits a non-empty password', () => {
    const onSubmit = vi.fn()
    render(
      <ImportPasswordModal
        open
        busy={false}
        formatName="Aegis"
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />,
    )

    expect(screen.getByText('modals.importPasswordDescription:Aegis')).toBeInTheDocument()
    const submit = screen.getByRole('button', { name: 'modals.import' })
    expect(submit).toBeDisabled()

    fireEvent.change(screen.getByLabelText('modals.importPasswordLabel'), {
      target: { value: 'backup password' },
    })
    fireEvent.click(submit)

    expect(onSubmit).toHaveBeenCalledWith('backup password')
  })

  it('shows an authentication error and disables controls while decrypting', () => {
    render(
      <ImportPasswordModal
        open
        busy
        error="Wrong password"
        formatName="Aegis"
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />,
    )

    expect(screen.getByText('Wrong password')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'modals.decrypting' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'modals.cancel' })).toBeDisabled()
  })
})
