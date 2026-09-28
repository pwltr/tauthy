import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { CSSProperties } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  start: vi.fn(),
  poll: vi.fn(),
  cancel: vi.fn(),
  create: vi.fn(),
  join: vi.fn(),
  navigate: vi.fn(),
  copy: vi.fn(),
}))

vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.navigate }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn() } }))
vi.mock('qrcode.react', () => ({
  QRCodeSVG: ({ style }: { style?: CSSProperties }) => (
    <svg aria-label="Pubky QR code" style={style} />
  ),
}))
vi.mock('~/utils/helpers', () => ({ copyToClipboard: mocks.copy }))
vi.mock('~/utils/sync', () => ({
  startPubkySync: mocks.start,
  pollPubkySync: mocks.poll,
  cancelPubkySync: mocks.cancel,
  createPubkySync: mocks.create,
  joinPubkySync: mocks.join,
}))

import PubkyConnect from '~/components/PubkyConnect'

describe('Pubky connection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.start.mockResolvedValue('pubkyauth://example')
    mocks.cancel.mockResolvedValue(undefined)
  })

  it('creates sync only after approval and shows a 256-bit recovery code', async () => {
    mocks.poll.mockResolvedValue({ approved: true, publicKey: 'pubky-user', hasRemote: false })
    mocks.create.mockResolvedValue({ status: { enabled: true, provider: 'pubky' } })
    const { unmount } = render(<PubkyConnect />)

    expect(await screen.findByText('sync.pubkyApproval')).toHaveClass('MuiTypography-body2')
    expect(screen.getByTestId('pubky-qr-frame')).toHaveStyle({ padding: '8px' })
    expect(screen.getByLabelText('Pubky QR code')).toHaveStyle({ display: 'block' })
    expect(screen.getByText('sync.pubkyWaiting')).toHaveClass('MuiTypography-alignCenter')
    fireEvent.click(screen.getByRole('button', { name: 'sync.pubkyCopyLink' }))
    expect(mocks.copy).toHaveBeenCalledWith('pubkyauth://example')
    expect(screen.queryByRole('button', { name: 'modals.cancel' })).not.toBeInTheDocument()
    expect(await screen.findByText('pubky-user')).toHaveStyle({ fontFamily: 'monospace' })
    expect(screen.getByText('sync.pubkyConnected')).toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: 'sync.pubkyCreate' }))

    await waitFor(() => expect(mocks.create).toHaveBeenCalledOnce())
    const code = mocks.create.mock.calls[0][0]
    expect(code).toMatch(/^[0-9a-f]{64}$/)
    expect(screen.getByRole('button', { name: 'sync.pubkyCodeSaved' })).toBeInTheDocument()
    expect(screen.getByText('sync.pubkySaveCode')).toHaveClass('MuiTypography-body2')

    fireEvent.click(screen.getByRole('button', { name: 'sync.pubkyCodeSaved' }))
    expect(mocks.navigate).toHaveBeenCalledWith(-1)
    unmount()
    expect(mocks.cancel).not.toHaveBeenCalled()
  })

  it('joins existing sync with the supplied recovery code', async () => {
    mocks.poll.mockResolvedValue({ approved: true, publicKey: 'pubky-user', hasRemote: true })
    mocks.join.mockResolvedValue({ status: { enabled: true, provider: 'pubky' } })
    const { unmount } = render(<PubkyConnect />)

    expect(await screen.findByText('pubky-user')).toHaveStyle({ fontFamily: 'monospace' })
    const code = 'a'.repeat(64)
    fireEvent.change(await screen.findByLabelText('sync.pubkyRecoveryCode'), {
      target: { value: code },
    })
    fireEvent.click(screen.getByRole('button', { name: 'sync.join' }))

    await waitFor(() => expect(mocks.join).toHaveBeenCalledWith(code))
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith(-1))
    unmount()
    expect(mocks.cancel).not.toHaveBeenCalled()
  })

  it('cancels an unfinished authorization when leaving', async () => {
    mocks.poll.mockResolvedValue({ approved: false, publicKey: null, hasRemote: null })
    const { unmount } = render(<PubkyConnect />)

    expect(await screen.findByText('sync.pubkyApproval')).toBeInTheDocument()
    unmount()

    await waitFor(() => expect(mocks.cancel).toHaveBeenCalledOnce())
  })
})
