import { styled } from '@mui/material/styles'

const Wrapper = styled('div', {
  shouldForwardProp: (prop: PropertyKey) => prop !== 'durationMs',
})<{ durationMs: number }>(
  ({ durationMs, theme }) => `
    background: ${theme.palette.background.paper};
    display: flex;
    height: 5px;
    width: 100%;
    transform-origin: left;

    @keyframes slide {
      from {transform: scaleX(1);}
      to {transform: scaleX(0);}
    }

    animation: ${durationMs}ms slide linear;

    @media (prefers-reduced-motion: reduce) {
      display: none;
    }
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
  durationMs: number
}

const ProgressBar = ({ className, durationMs }: ProgressBarProps) => {
  return (
    <Wrapper className={className} durationMs={durationMs}>
      <Bar />
    </Wrapper>
  )
}

export default ProgressBar
