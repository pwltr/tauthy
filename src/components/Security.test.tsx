import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock('~/components/modals/Password', () => ({ default: () => null }))
vi.mock('~/components/modals/PasswordReset', () => ({ default: () => null }))
vi.mock('~/components/modals/Reset', () => ({
  default: ({ open }: { open: boolean }) => (open ? <div>Delete confirmation</div> : null),
}))

import Security from '~/components/Security'

describe('Security settings', () => {
  it('keeps local vault deletion in a separate danger zone', () => {
    render(<Security />)

    expect(screen.getByText('security.dangerZone')).toBeInTheDocument()
    fireEvent.click(screen.getByText('security.deleteVault'))
    expect(screen.getByText('Delete confirmation')).toBeInTheDocument()
  })
})
