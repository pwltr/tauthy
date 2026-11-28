import { QRCodeSVG } from 'qrcode.react'
import { useTranslation } from 'react-i18next'
import { styled } from '@mui/material/styles'

import Modal from '~/components/Modal'
import { ListEntry } from '~/components/Codes'
import { createOtpAuthUri } from '~/utils/totp'

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

const Icon = styled('img')`
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
}) => {
  const { t } = useTranslation()

  return (
    <Modal open={open} onClose={onClose} title={t('modals.qrCode')}>
      <Container onClick={onClose}>
        <Code>
          <QRCodeSVG value={createOtpAuthUri(entry)} size={280} />

          {entry.icon && <Icon src={`data:image/svg+xml;base64,${entry.icon}`} alt="" />}
        </Code>

        <Text>
          {entry.name} {entry.issuer && `(${entry.issuer})`}
        </Text>
      </Container>
    </Modal>
  )
}

export default QRCodeModal
