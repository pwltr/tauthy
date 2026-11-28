import { styled } from '@mui/material/styles'
import { DEFAULT_TOTP } from '~/utils/totp'

const DEFAULT_PERIOD_MS = DEFAULT_TOTP.period * 1000

export const getProgressAnimationDelayMs = (remainingMs: number, periodMs = DEFAULT_PERIOD_MS) => {
  const elapsedMs = Math.min(Math.max(periodMs - remainingMs, 0), periodMs)
  return elapsedMs === 0 ? 0 : -elapsedMs
}

const Wrapper = styled('div', {
  shouldForwardProp: (prop: PropertyKey) => prop !== 'durationMs' && prop !== 'periodMs',
})<{ durationMs: number; periodMs: number }>(
  ({ durationMs, periodMs, theme }) => `
    background: ${theme.palette.background.paper};
    display: flex;
    height: 4px;
    width: 100%;
    transform-origin: left;

    @keyframes slide {
      from {transform: scaleX(1);}
      to {transform: scaleX(0);}
    }

    animation: ${periodMs}ms slide linear forwards;
    animation-delay: ${getProgressAnimationDelayMs(durationMs, periodMs)}ms;

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
  periodMs?: number
}

const ProgressBar = ({ className, durationMs, periodMs = DEFAULT_PERIOD_MS }: ProgressBarProps) => {
  return (
    <Wrapper className={className} durationMs={durationMs} periodMs={periodMs}>
      <Bar />
    </Wrapper>
  )
}

export default ProgressBar
