import { useId } from 'react'
import { styled } from '@mui/material/styles'
import MuiModal from '@mui/material/Modal'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'

const StyledBox = styled(Box)(
  ({ theme }) => `
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 90%;
  max-height: 90vh;
  overflow-x: hidden;
  overflow-y: auto;
  background: ${theme.palette.background.paper};
  box-shadow: ${theme.shadows[24]};
  border-radius: ${theme.spacing(1)};
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
  title,
  children,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
}) => {
  const titleId = useId()

  return (
    <MuiModal open={open} onClose={onClose}>
      <StyledBox role="dialog" aria-labelledby={titleId}>
        <Typography
          id={titleId}
          variant="subtitle1"
          component="h2"
          color="text.primary"
          sx={{ fontWeight: 600 }}
          gutterBottom
        >
          {title}
        </Typography>
        {children}
      </StyledBox>
    </MuiModal>
  )
}

export default Modal
