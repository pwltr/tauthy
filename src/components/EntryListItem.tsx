import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { useContext, type ClipboardEvent, type KeyboardEvent, type MouseEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Draggable, DraggableStyle } from '@hello-pangea/dnd'
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
import { formatCode } from '~/utils/formatCode'
import { AppSettingsContext, ListOptionsContext } from '~/context'
import { copyToClipboard, recordEntryUsage } from '~/utils'
const appWindow = getCurrentWebviewWindow()

const lockToVerticalAxis = (style?: DraggableStyle): DraggableStyle | undefined => {
  if (!style?.transform) return style

  const translation = style.transform.match(
    /^translate\((-?\d+(?:\.\d+)?)px,\s*(-?\d+(?:\.\d+)?)px\)/,
  )
  if (!translation) return style

  const headerBottom = document
    .querySelector<HTMLElement>('[data-tauthy-app-bar]')
    ?.getBoundingClientRect().bottom
  const initialTop = 'top' in style ? style.top : undefined
  const verticalOffset = Number(translation[2])
  const constrainedOffset =
    headerBottom !== undefined && initialTop !== undefined
      ? Math.max(verticalOffset, headerBottom - initialTop)
      : verticalOffset

  return {
    ...style,
    transform: style.transform.replace(translation[0], `translate(0px, ${constrainedOffset}px)`),
  }
}

const ListItem = styled(MuiListItem)`
  cursor: pointer;

  .MuiListItemSecondaryAction-root {
    display: none;
  }

  &:hover,
  &:focus-within {
    .MuiListItemSecondaryAction-root {
      display: block;
    }
  }
`

const Icon = styled('img')(
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
  isDragDisabled: boolean
  setQrEntry: (entry: ListEntry) => void
  onContextMenu: (event: MouseEvent<HTMLLIElement>, uuid: string) => void
  setRowRef: (element: HTMLDivElement | null) => void
  moveFocus: (direction: -1 | 1) => void
}

const EntryListItem = ({
  item,
  index,
  isDragDisabled,
  setQrEntry,
  onContextMenu,
  setRowRef,
  moveFocus,
}: EntryListItemProps) => {
  const navigate = useNavigate()
  const { minimizeOnCopy } = useContext(AppSettingsContext)
  const { groupByTwos } = useContext(ListOptionsContext)

  const onCopy = async (token: string) => {
    await copyToClipboard(token)
    recordEntryUsage(item.uuid)

    if (minimizeOnCopy) {
      await appWindow.minimize()
    }
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || document.querySelector('[role="dialog"], [aria-modal="true"]')) {
      return
    }

    if (!event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        moveFocus(event.key === 'ArrowDown' ? 1 : -1)
      }
    } else if (
      (event.ctrlKey || event.metaKey) &&
      !event.altKey &&
      !event.shiftKey &&
      event.key.toLowerCase() === 'c' &&
      item.token &&
      !window.getSelection()?.toString()
    ) {
      event.preventDefault()
      event.stopPropagation()
      void onCopy(item.token)
    }
  }

  const handleCopy = (event: ClipboardEvent<HTMLDivElement>) => {
    if (
      !item.token ||
      event.defaultPrevented ||
      window.getSelection()?.toString() ||
      document.querySelector('[role="dialog"], [aria-modal="true"]')
    ) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    void onCopy(item.token)
  }

  return (
    <Draggable draggableId={item.uuid} index={index} isDragDisabled={isDragDisabled}>
      {(provided, snapshot) => (
        <ListItem
          ref={provided.innerRef}
          {...provided.draggableProps}
          style={
            snapshot.isDragging
              ? lockToVerticalAxis(provided.draggableProps.style)
              : provided.draggableProps.style
          }
          disablePadding
          onContextMenu={(event) => onContextMenu(event, item.uuid)}
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
          <ListItemButton
            {...provided.dragHandleProps}
            ref={setRowRef}
            data-code-row
            onKeyDown={handleKeyDown}
            onCopy={handleCopy}
          >
            <ListItemAvatar>
              <Avatar>
                {item.icon ? (
                  <Icon src={`data:image/svg+xml;base64,${item.icon}`} alt="" />
                ) : (
                  item.name.charAt(0).toUpperCase()
                )}
              </Avatar>
            </ListItemAvatar>
            <ListItemText
              slotProps={{
                primary: { sx: { fontSize: 12 } },
                secondary: { sx: { fontSize: 20 } },
              }}
              primary={
                <Name>{`${item.issuer ?? ''} ${item.issuer ? `(${item.name})` : item.name}`}</Name>
              }
              secondary={<Token>{formatCode(item.token ?? '', groupByTwos)}</Token>}
            />
          </ListItemButton>
        </ListItem>
      )}
    </Draggable>
  )
}

export default EntryListItem
