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

import SyncPasswordModal from '~/components/modals/SyncPassword'

describe('SyncPasswordModal', () => {
  it('requires confirmation when creating a sync file', () => {
    const onSubmit = vi.fn()
    render(
      <SyncPasswordModal mode="create" open busy={false} onClose={vi.fn()} onSubmit={onSubmit} />,
    )

    fireEvent.change(screen.getByLabelText('sync.password'), {
      target: { value: 'recovery password' },
    })
    fireEvent.change(screen.getByLabelText('modals.repeatPassword'), {
      target: { value: 'different password' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'sync.create' }))
    expect(screen.getByText('modals.passwordNoMatch')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('modals.repeatPassword'), {
      target: { value: 'recovery password' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'sync.create' }))
    expect(onSubmit).toHaveBeenCalledWith('recovery password')
  })

  it('accepts one recovery password when joining', () => {
    const onSubmit = vi.fn()
    render(
      <SyncPasswordModal mode="join" open busy={false} onClose={vi.fn()} onSubmit={onSubmit} />,
    )

    fireEvent.change(screen.getByLabelText('sync.password'), {
      target: { value: 'recovery password' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'sync.join' }))
    expect(onSubmit).toHaveBeenCalledWith('recovery password')
  })
})
