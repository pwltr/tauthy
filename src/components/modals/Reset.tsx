import toast from 'react-hot-toast'
import Button from '@mui/material/Button'

import { vault } from '~/App'
// import { deleteVault } from '~/utils'
import Modal, { Buttons } from '~/components/Modal'

const ResetModal = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
  const handleResetVault = async () => {
    try {
      await vault.reset()
      toast.success('Vault resetted.')
      onClose()
    } catch (err) {
      console.error(err)
      toast.error('An error occured')
    }
  }

  return (
    <Modal open={open} onClose={onClose}>
      <div>This will delete your vault and can not be undone. Are you sure?</div>
      <Buttons>
        <Button color="error" variant="contained" onClick={handleResetVault}>
          Delete
        </Button>
        <Button variant="contained" onClick={onClose}>
          Cancel
        </Button>
      </Buttons>
    </Modal>
  )
}

export default ResetModal
