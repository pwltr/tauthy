import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
vi.mock('~/hooks/useVaultProtection', () => ({ useVaultProtection: () => false }))
vi.mock('~/utils/storage', () => ({ vault: { fileBackend: false } }))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock('~/components/modals/Password', () => ({ default: () => null }))
vi.mock('~/components/modals/PasswordReset', () => ({ default: () => null }))
vi.mock('~/components/modals/Reset', () => ({
  default: ({ open }: { open: boolean }) => (open ? <div>Delete confirmation</div> : null),
}))

import Security from '~/components/Security'
import { MemoryRouter } from 'react-router-dom'

describe('Security settings', () => {
  it('keeps local vault deletion in a separate danger zone', () => {
    render(
      <MemoryRouter>
        <Security />
      </MemoryRouter>,
    )

    expect(screen.getByText('security.dangerZone')).toBeInTheDocument()
    fireEvent.click(screen.getByText('security.deleteVault'))
    expect(screen.getByText('Delete confirmation')).toBeInTheDocument()
  })
})
