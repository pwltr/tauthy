import { useState } from 'react'
import toast from 'react-hot-toast'
import TextField from '@mui/material/TextField'
import Button from '@mui/material/Button'

import { vault } from '~/App'
import { useLocalStorage } from '~/hooks'
import Modal, { Buttons } from '~/components/Modal'

const PasswordModal = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
  const [, setIsPasswordSet] = useLocalStorage('isPasswordSet', false)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState(false)

  const handleSetPassword = async () => {
    if (password === confirmPassword) {
      try {
        // await vault.changePassword(password)
        setIsPasswordSet(true)
        toast.success('Vault encrypted.')
        onClose()
      } catch (err) {
        console.error(err)
        toast.error('An error occured')
      }
    } else {
      setError(true)
    }
  }

  return (
    <Modal open={open} onClose={onClose}>
      <div>Choose a password for your encrypted vault</div>
      <TextField
        type="password"
        label="New Password"
        variant="filled"
        size="small"
        fullWidth
        margin="normal"
        error={error}
        onChange={(event) => setPassword(event.target.value)}
      />
      <TextField
        type="password"
        label="Repeat Password"
        variant="filled"
        size="small"
        fullWidth
        margin="normal"
        helperText={error && "Passwords don't match"}
        error={error}
        onChange={(event) => setConfirmPassword(event.target.value)}
      />
      <Buttons>
        <Button onClick={onClose}>Cancel</Button>
        <Button color="primary" variant="contained" onClick={handleSetPassword}>
          Confirm
        </Button>
      </Buttons>
    </Modal>
  )
}

export default PasswordModal
