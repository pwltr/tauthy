import { appWindow } from '@tauri-apps/api/window'
import { FC, useContext } from 'react'
import { useNavigate } from 'react-router-dom'
import { Buffer } from 'buffer'
import { DraggableProps, Draggable as _Draggable } from 'react-beautiful-dnd'
import MuiListItem from '@mui/material/ListItem'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemAvatar from '@mui/material/ListItemAvatar'
import ListItemText from '@mui/material/ListItemText'
import Avatar from '@mui/material/Avatar'
import IconButton from '@mui/material/IconButton'
import { styled } from '@mui/material/styles'
import QrCodeIcon from '@mui/icons-material/QrCode'
import CopyIcon from '@mui/icons-material/ContentCopy'
import EditIcon from '@mui/icons-material/Edit'

import { ListEntry } from './Codes'
import { AppSettingsContext, ListOptionsContext } from '~/context'
import { copyToClipboard } from '~/utils'

// HACK: this fixes type incompatibility
const Draggable = _Draggable as unknown as FC<DraggableProps>

const ListItem = styled(MuiListItem)`
  cursor: pointer;

  .MuiListItemSecondaryAction-root {
    display: none;
  }

  &:hover {
    .MuiListItemSecondaryAction-root {
      display: block;
    }
  }
`

const Icon = styled('div')(
  ({ theme }) => `
  background: ${theme.palette.background.default};
  height: 40px;
  width: 40px;
`,
)

const Name = styled('span')(
  ({ theme }) => `
  color: ${theme.palette.primary.main};
  `,
)

const Token = styled('span')(
  ({ theme }) => `
    color: ${theme.palette.primary.main};
    font-weight: 600;
`,
)

export type EntryListItemProps = {
  item: ListEntry
  index: number
  setQrEntry: (entry: ListEntry) => void
}

const EntryListItem = ({ item, index, setQrEntry }: EntryListItemProps) => {
  const navigate = useNavigate()
  const { minimizeOnCopy } = useContext(AppSettingsContext)
  const { groupByTwos } = useContext(ListOptionsContext)

  const onCopy = async (token: string) => {
    copyToClipboard(token)

    if (minimizeOnCopy) {
      await appWindow.minimize()
    }
  }

  return (
    <Draggable draggableId={item.uuid} index={index}>
      {(provided) => (
        <ListItem
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          disablePadding
          secondaryAction={
            <>
              {item.token && (
                <>
                  <IconButton aria-label="copy to clipboard">
                    <CopyIcon color="primary" />
                  </IconButton>
                  <IconButton
                    aria-label="show QR code"
                    onClick={(event) => {
                      event.stopPropagation()
                      setQrEntry(item)
                    }}
                  >
                    <QrCodeIcon color="primary" />
                  </IconButton>
                </>
              )}
              <IconButton
                edge="end"
                aria-label="edit"
                onClick={(event) => {
                  event.stopPropagation()
                  navigate(`edit/${item.uuid}`)
                }}
              >
                <EditIcon color="primary" />
              </IconButton>
            </>
          }
          onClick={() => {
            if (item.token) {
              onCopy(item.token)
            }
          }}
        >
          <ListItemButton>
            <ListItemAvatar>
              <Avatar>
                {item.icon ? (
                  <Icon
                    dangerouslySetInnerHTML={{
                      __html: Buffer.from(item.icon, 'base64').toString('utf8'),
                    }}
                  />
                ) : (
                  item.name.charAt(0).toUpperCase()
                )}
              </Avatar>
            </ListItemAvatar>
            <ListItemText
              primaryTypographyProps={{ fontSize: 12 }}
              secondaryTypographyProps={{ fontSize: 20 }}
              primary={
                <Name>{`${item.issuer ?? ''} ${item.issuer ? `(${item.name})` : item.name}`}</Name>
              }
              secondary={
                <Token>
                  {groupByTwos ? (
                    <>
                      {String(item.token).slice(0, 2)} {String(item.token).slice(2, 4)}{' '}
                      {String(item.token).slice(4, 6)}
                    </>
                  ) : (
                    <>
                      {String(item.token).slice(0, 3)} {String(item.token).slice(3, 6)}
                    </>
                  )}
                </Token>
              }
            />
          </ListItemButton>
        </ListItem>
      )}
    </Draggable>
  )
}

export default EntryListItem
