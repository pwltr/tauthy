import { styled } from '@mui/material/styles'
import MuiModal from '@mui/material/Modal'
import Box from '@mui/material/Box'

const style = {
  position: 'absolute',
  top: '50%',
  left: '50%',
  transform: 'translate(-50%, -50%)',
  width: '90%',
  bgcolor: 'background.paper',
  boxShadow: 24,
  borderRadius: 1,
  color: 'primary.main',
  p: 2,
}

export const Buttons = styled('div')`
  display: flex;
  justify-content: flex-end;
  grid-gap: 1rem;
  margin-top: 1rem;
`

const Modal = ({
  open,
  onClose,
  children,
}: {
  open: boolean
  onClose: () => void
  children: React.ReactNode
}) => {
  return (
    <MuiModal
      open={open}
      onClose={onClose}
      // aria-labelledby="modal-title"
      // aria-describedby="modal-modal-description"
    >
      <Box sx={style}>
        {/* {title} */}
        {/* {content} */}
        {/* {buttons} */}
        {children}
      </Box>
    </MuiModal>
  )
}

export default Modal
