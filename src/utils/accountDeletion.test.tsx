import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import toast, { Toaster } from 'react-hot-toast'
import type { TFunction } from 'i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ deleteCode: vi.fn(), restoreCode: vi.fn() }))
vi.mock('~/utils/codes', () => mocks)
vi.mock('~/utils/storage', () => ({ VAULT_LOCK_EVENT: 'tauthy:vault-lock' }))

import { deleteAccountWithUndo, DELETE_UNDO_MS } from '~/utils/accountDeletion'
const t = ((key: string) => key) as TFunction
const entry = { uuid: 'faceit', name: 'FaceIt', secret: 'private-secret' }

describe('delete Undo', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: false })),
    )
    mocks.deleteCode.mockReset().mockResolvedValue(entry)
    mocks.restoreCode.mockReset().mockResolvedValue(undefined)
    render(<Toaster />)
  })
  afterEach(() => {
    act(() => {
      window.dispatchEvent(new Event('tauthy:vault-lock'))
      toast.remove()
    })
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('offers one-shot Undo without displaying the secret', async () => {
    await act(() => deleteAccountWithUndo(entry.uuid, t))
    expect(screen.queryByText(entry.secret)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'edit.undo' }))
    await waitFor(() => expect(mocks.restoreCode).toHaveBeenCalledExactlyOnceWith(entry))
  })

  it.each(['expiry', 'lock'])('discards the Undo entry on %s', async (reason) => {
    vi.useFakeTimers()
    await act(() => deleteAccountWithUndo(entry.uuid, t))
    const button = screen.getByRole('button', { name: 'edit.undo' })
    act(() => {
      if (reason === 'expiry') vi.advanceTimersByTime(DELETE_UNDO_MS)
      else window.dispatchEvent(new Event('tauthy:vault-lock'))
    })
    fireEvent.click(button)
    expect(mocks.restoreCode).not.toHaveBeenCalled()
  })

  it('does not offer Undo when deletion fails', async () => {
    mocks.deleteCode.mockRejectedValue(new Error('delete failed'))
    await expect(deleteAccountWithUndo(entry.uuid, t)).rejects.toThrow('delete failed')
    expect(screen.queryByRole('button', { name: 'edit.undo' })).not.toBeInTheDocument()
  })

  it('does not expose Undo if the session ends while deletion is pending', async () => {
    let finish: (deleted: typeof entry) => void = () => {}
    mocks.deleteCode.mockImplementation(
      () =>
        new Promise<typeof entry>((resolve) => {
          finish = resolve
        }),
    )
    const deleting = deleteAccountWithUndo(entry.uuid, t)
    window.dispatchEvent(new Event('tauthy:vault-lock'))
    finish(entry)
    await act(() => deleting)
    expect(screen.queryByRole('button', { name: 'edit.undo' })).not.toBeInTheDocument()
  })

  it('reports a failed restore', async () => {
    mocks.restoreCode.mockRejectedValue(new Error('locked'))
    await act(() => deleteAccountWithUndo(entry.uuid, t))
    fireEvent.click(screen.getByRole('button', { name: 'edit.undo' }))
    expect(await screen.findByText('edit.undoFailed')).toBeInTheDocument()
  })

  it('replaces an older Undo slot and prevents repeated restoration', async () => {
    await act(() => deleteAccountWithUndo(entry.uuid, t))
    const oldButton = screen.getByRole('button', { name: 'edit.undo' })
    const second = { ...entry, uuid: 'second' }
    mocks.deleteCode.mockResolvedValue(second)
    await act(() => deleteAccountWithUndo(second.uuid, t))
    fireEvent.click(oldButton)
    expect(mocks.restoreCode).not.toHaveBeenCalled()
    const buttons = screen.getAllByRole('button', { name: 'edit.undo' })
    const currentButton = buttons.find((button) => button !== oldButton)!
    fireEvent.click(currentButton)
    fireEvent.click(currentButton)
    expect(mocks.restoreCode).toHaveBeenCalledExactlyOnceWith(second)
  })
})
