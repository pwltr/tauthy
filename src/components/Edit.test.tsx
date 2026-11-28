import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getVault: vi.fn(),
  editCode: vi.fn(),
  deleteAccount: vi.fn(),
  confirm: vi.fn(),
  error: vi.fn(),
  t: (key: string) => key,
}))
vi.mock('~/utils/storage', () => ({ vault: { getVault: mocks.getVault } }))
vi.mock('~/utils', () => ({ editCode: mocks.editCode }))
vi.mock('~/utils/accountDeletion', () => ({ deleteAccountWithUndo: mocks.deleteAccount }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ confirm: mocks.confirm }))
vi.mock('react-hot-toast', () => ({ default: { error: mocks.error } }))
vi.mock('~/components/modals/Icons', () => ({ default: () => null }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: mocks.t }) }))

import Edit from '~/components/Edit'

const entry = { uuid: 'faceit', name: 'FaceIt', secret: 'JBSWY3DPEHPK3PXP' }
const setup = async () => {
  render(
    <MemoryRouter initialEntries={['/', '/edit/faceit']} initialIndex={1}>
      <Routes>
        <Route path="/" element={<div>Codes screen</div>} />
        <Route path="/edit/:id" element={<Edit />} />
      </Routes>
    </MemoryRouter>,
  )
  await screen.findByDisplayValue(entry.secret)
}

describe('account edit safeguards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getVault.mockResolvedValue([entry])
    mocks.confirm.mockResolvedValue(false)
    mocks.editCode.mockResolvedValue(undefined)
    mocks.deleteAccount.mockResolvedValue(undefined)
  })

  it('does not delete or leave the editor when confirmation is cancelled', async () => {
    await setup()
    fireEvent.click(screen.getByRole('button', { name: 'edit.delete' }))
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledOnce())
    expect(mocks.deleteAccount).not.toHaveBeenCalled()
    expect(screen.getByLabelText('edit.secret')).toBeInTheDocument()
  })

  it('deletes with Undo only after confirmation', async () => {
    mocks.confirm.mockResolvedValue(true)
    await setup()
    fireEvent.click(screen.getByRole('button', { name: 'edit.delete' }))
    await screen.findByText('Codes screen')
    expect(mocks.deleteAccount).toHaveBeenCalledWith('faceit', expect.any(Function))
  })

  it('confirms a changed secret without putting the secret in the dialog', async () => {
    await setup()
    fireEvent.change(screen.getByLabelText('edit.secret'), { target: { value: 'GEZDGNBV' } })
    fireEvent.click(screen.getByRole('button', { name: 'edit.save' }))
    await waitFor(() =>
      expect(mocks.confirm).toHaveBeenCalledWith('edit.secretConfirm', {
        title: 'edit.secretTitle',
        kind: 'warning',
      }),
    )
    expect(mocks.editCode).not.toHaveBeenCalled()
    mocks.confirm.mockResolvedValue(true)
    fireEvent.click(screen.getByRole('button', { name: 'edit.save' }))
    await screen.findByText('Codes screen')
    expect(mocks.editCode).toHaveBeenCalledWith('faceit', { secret: 'GEZDGNBV' })
  })

  it.each(['name', 'issuer', 'group'])('saves only the edited %s field', async (field) => {
    await setup()
    fireEvent.change(screen.getByLabelText(`edit.${field}`), {
      target: { value: 'Updated' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'edit.save' }))
    await screen.findByText('Codes screen')
    expect(mocks.confirm).not.toHaveBeenCalled()
    expect(mocks.editCode).toHaveBeenCalledExactlyOnceWith('faceit', { [field]: 'Updated' })
  })

  it('omits a secret with equivalent formatting when saving a rename', async () => {
    await setup()
    fireEvent.change(screen.getByLabelText('edit.name'), { target: { value: 'New name' } })
    fireEvent.change(screen.getByLabelText('edit.secret'), {
      target: { value: entry.secret.toLowerCase() + '=' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'edit.save' }))
    await screen.findByText('Codes screen')
    expect(mocks.confirm).not.toHaveBeenCalled()
    expect(mocks.editCode).toHaveBeenCalledExactlyOnceWith('faceit', { name: 'New name' })
  })

  it('confirms a period change and saves the account settings', async () => {
    mocks.confirm.mockResolvedValue(true)
    await setup()
    fireEvent.click(screen.getByRole('button', { name: 'totp.settings' }))
    fireEvent.change(await screen.findByRole('spinbutton', { name: 'totp.period' }), {
      target: { value: '60' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'edit.save' }))
    await screen.findByText('Codes screen')
    expect(mocks.confirm).toHaveBeenCalledWith('totp.changeConfirm', {
      title: 'totp.changeTitle',
      kind: 'warning',
    })
    expect(mocks.editCode).toHaveBeenCalledWith('faceit', { totp: { period: 60 } })
  })

  it('shows save failure and keeps the editor open', async () => {
    mocks.editCode.mockRejectedValue(new Error('save failed'))
    await setup()
    fireEvent.change(screen.getByLabelText('edit.name'), { target: { value: 'New name' } })
    fireEvent.click(screen.getByRole('button', { name: 'edit.save' }))
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith('edit.saveFailed'))
    expect(screen.queryByText('Codes screen')).not.toBeInTheDocument()
  })

  it('prevents duplicate saves while the secret confirmation is open', async () => {
    let answer: (accepted: boolean) => void = () => {}
    mocks.confirm.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          answer = resolve
        }),
    )
    await setup()
    fireEvent.change(screen.getByLabelText('edit.secret'), { target: { value: 'GEZDGNBV' } })
    const save = screen.getByRole('button', { name: 'edit.save' })
    fireEvent.click(save)
    fireEvent.click(save)
    expect(mocks.confirm).toHaveBeenCalledOnce()
    answer(true)
    await screen.findByText('Codes screen')
    expect(mocks.editCode).toHaveBeenCalledOnce()
  })
})
