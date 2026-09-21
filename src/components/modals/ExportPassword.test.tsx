import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock('~/components/Modal', () => ({
  default: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div>{children}</div> : null,
  Buttons: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

import ExportPasswordModal from '~/components/modals/ExportPassword'

describe('ExportPasswordModal', () => {
  it('requires a confirmed password of at least eight characters', () => {
    const onSubmit = vi.fn()
    render(<ExportPasswordModal open busy={false} onClose={vi.fn()} onSubmit={onSubmit} />)

    fireEvent.change(screen.getByLabelText('modals.exportPasswordLabel'), {
      target: { value: 'short' },
    })
    fireEvent.change(screen.getByLabelText('modals.repeatPassword'), {
      target: { value: 'short' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'modals.export' }))
    expect(screen.getByText('modals.passwordInsecure')).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('modals.exportPasswordLabel'), {
      target: { value: 'backup password' },
    })
    fireEvent.change(screen.getByLabelText('modals.repeatPassword'), {
      target: { value: 'different password' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'modals.export' }))
    expect(screen.getByText('modals.passwordNoMatch')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('modals.repeatPassword'), {
      target: { value: 'backup password' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'modals.export' }))
    expect(onSubmit).toHaveBeenCalledWith('backup password')
  })

  it('disables controls while encrypting', () => {
    render(<ExportPasswordModal open busy onClose={vi.fn()} onSubmit={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'modals.encrypting' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'modals.cancel' })).toBeDisabled()
  })
})
