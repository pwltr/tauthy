import { styled } from '@mui/material/styles'

const Wrapper = styled('div')(
  ({ theme }) => `
    background: ${theme.palette.background.paper};
    display: flex;
    height: 5px;
    width: 100%;

    @keyframes slide {
      from {max-width: 100%;}
      to {max-width: 0%;}
    }

    animation: 30s slide infinite linear;
  `,
)

const Bar = styled('div')(
  ({ theme }) => `
    background: ${theme.palette.primary.main};
    width: 100%;
  `,
)

type ProgressBarProps = {
  className?: string
  animate?: boolean
}

const ProgressBar = ({ className }: ProgressBarProps) => {
  return (
    <Wrapper className={className}>
      <Bar />
    </Wrapper>
  )
}

export default ProgressBar
