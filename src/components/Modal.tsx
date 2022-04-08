import { styled, lighten } from '@mui/material/styles'
import MuiModal from '@mui/material/Modal'
import Box from '@mui/material/Box'

const StyledBox = styled(Box)(
  ({ theme }) => `
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 90%;
  max-height: 90vh;
  overflow: auto;
  background: ${theme.palette.background.paper};
  // background: ${lighten(theme.palette.background.paper, 0.1)};
  box-shadow: ${theme.shadows[24]};
  border-radius: 4px;
  color: ${theme.palette.primary.main};
  padding: ${theme.spacing(2)};
`,
)

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
      <StyledBox>
        {/* {title} */}
        {/* {content} */}
        {/* {buttons} */}
        {children}
      </StyledBox>
    </MuiModal>
  )
}

export default Modal
