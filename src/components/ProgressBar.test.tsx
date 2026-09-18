import { describe, expect, it } from 'vitest'

import { getProgressAnimationDelayMs } from '~/components/ProgressBar'

describe('progress-bar timing', () => {
  it('starts a partial cycle at its elapsed position', () => {
    expect(getProgressAnimationDelayMs(8_000)).toBe(-22_000)
  })

  it('starts a full cycle without an offset', () => {
    expect(getProgressAnimationDelayMs(30_000)).toBe(0)
  })

  it('clamps timing outside the expected cycle', () => {
    expect(getProgressAnimationDelayMs(31_000)).toBe(0)
    expect(getProgressAnimationDelayMs(-1)).toBe(-30_000)
  })
})
