import { afterEach, describe, expect, it, vi } from 'vitest'

import { imageToBase64 } from '~/utils/helpers'

describe('imageToBase64', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('converts an encoded SVG data URL without fetching it', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(imageToBase64('data:image/svg+xml,%3Csvg%3Eicon%3C%2Fsvg%3E')).resolves.toBe(
      'PHN2Zz5pY29uPC9zdmc+',
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns the payload of a base64 data URL without fetching it', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(imageToBase64('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=')).resolves.toBe(
      'PHN2Zz48L3N2Zz4=',
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
