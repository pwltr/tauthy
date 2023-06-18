import { QRCodeSVG } from 'qrcode.react'
import { Buffer } from 'buffer'
import { styled } from '@mui/material/styles'

import Modal from '~/components/Modal'
import { ListEntry } from '~/components/Codes'

const getOtpUri = (name: string, secret: string, issuer = '', group = '') => {
  // TODO: add period, icon
  const params = new URLSearchParams({ secret, issuer, group })
  return `otpauth://totp/${encodeURIComponent(name)}?${params.toString()}`
}

const Container = styled('div')`
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
`

const Code = styled('div')`
  display: flex;
  justify-content: center;
  align-items: center;
  background: white;
  border-radius: 10px;
  box-shadow: 0 0 8px 0 rgba(0, 0, 0, 0.2);
  overflow: hidden;
  padding: 16px;
`

const Icon = styled('div')`
  height: 70px;
  width: 70px;
  position: absolute;
  border-radius: 50%;
`

const Text = styled('div')`
  margin-top: 1rem;
`

const QRCodeModal = ({
  entry,
  open,
  onClose,
}: {
  entry: ListEntry
  open: boolean
  onClose: () => void
}) => (
  <Modal open={open} onClose={onClose}>
    <Container onClick={onClose}>
      <Code>
        <QRCodeSVG
          value={getOtpUri(entry.name, entry.secret, entry.issuer, entry.group)}
          size={280}
        />

        {entry.icon && (
          <Icon
            dangerouslySetInnerHTML={{
              __html: Buffer.from(entry.icon, 'base64').toString('utf8'),
            }}
          />
        )}
      </Code>

      <Text>
        {entry.name} {entry.issuer && `(${entry.issuer})`}
      </Text>
    </Container>
  </Modal>
)

export default QRCodeModal
