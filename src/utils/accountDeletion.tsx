import Button from '@mui/material/Button'
import toast from 'react-hot-toast'
import type { TFunction } from 'i18next'
import { deleteCode, restoreCode } from '~/utils/codes'
import { VAULT_LOCK_EVENT } from '~/utils/storage'
import type { VaultEntry } from '~/types'

export const DELETE_UNDO_MS = 10_000

// Only one short-lived, in-memory undo slot. Never persist deleted secrets in
// preferences, diagnostics or toast text; discard on expiry, lock or deletion.
let pending: { entry?: VaultEntry; toastId: string; clear: () => void } | undefined

export const deleteAccountWithUndo = async (id: string, t: TFunction) => {
  // A lock/delete can start while the save is pending. Do not introduce a new
  // undo slot after that session has ended.
  let sessionEnded = false
  const endSession = () => {
    sessionEnded = true
  }
  window.addEventListener(VAULT_LOCK_EVENT, endSession)
  let entry: VaultEntry
  try {
    entry = await deleteCode(id)
  } finally {
    window.removeEventListener(VAULT_LOCK_EVENT, endSession)
  }
  if (sessionEnded) return
  pending?.clear()
  const slot = {
    entry: entry as VaultEntry | undefined,
    toastId: '',
    clear: () => {
      slot.entry = undefined
      window.clearTimeout(timeout)
      window.removeEventListener(VAULT_LOCK_EVENT, slot.clear)
      toast.dismiss(slot.toastId)
      if (pending === slot) pending = undefined
    },
  }
  const timeout = window.setTimeout(() => slot.clear(), DELETE_UNDO_MS)
  window.addEventListener(VAULT_LOCK_EVENT, slot.clear)
  pending = slot
  slot.toastId = toast(
    <>
      {t('edit.deleted')}
      <Button
        size="small"
        color="inherit"
        sx={{ ml: 1, textTransform: 'none' }}
        onClick={async () => {
          const deleted = slot.entry
          if (!deleted) return
          slot.clear()
          try {
            await restoreCode(deleted)
          } catch {
            toast.error(t('edit.undoFailed'))
          }
        }}
      >
        {t('edit.undo')}
      </Button>
    </>,
    { duration: DELETE_UNDO_MS },
  )
}
