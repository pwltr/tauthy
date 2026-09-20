import { styled } from '@mui/material/styles'

const TOTP_PERIOD_MS = 30_000

export const getProgressAnimationDelayMs = (remainingMs: number) => {
  const elapsedMs = Math.min(Math.max(TOTP_PERIOD_MS - remainingMs, 0), TOTP_PERIOD_MS)
  return elapsedMs === 0 ? 0 : -elapsedMs
}

const Wrapper = styled('div', {
  shouldForwardProp: (prop: PropertyKey) => prop !== 'durationMs',
})<{ durationMs: number }>(
  ({ durationMs, theme }) => `
    background: ${theme.palette.background.paper};
    display: flex;
    height: 4px;
    width: 100%;
    transform-origin: left;

    @keyframes slide {
      from {transform: scaleX(1);}
      to {transform: scaleX(0);}
    }

    animation: ${TOTP_PERIOD_MS}ms slide linear forwards;
    animation-delay: ${getProgressAnimationDelayMs(durationMs)}ms;

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
