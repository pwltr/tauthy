import { useContext, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { clipboard } from '@tauri-apps/api'
import toast from 'react-hot-toast'
import { Buffer } from 'buffer'
import { styled } from '@mui/material/styles'
import Box from '@mui/material/Box'
import MuiList from '@mui/material/List'
import MuiListItem from '@mui/material/ListItem'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemAvatar from '@mui/material/ListItemAvatar'
import ListItemText from '@mui/material/ListItemText'
import Avatar from '@mui/material/Avatar'
import IconButton from '@mui/material/IconButton'
import Grid from '@mui/material/Grid'
import DescriptionIcon from '@mui/icons-material/Description'
import QrCodeIcon from '@mui/icons-material/QrCode'
import CopyIcon from '@mui/icons-material/ContentCopy'
import EditIcon from '@mui/icons-material/Edit'

import { ListOptionsContext, SearchContext, SortContext } from '~/context'
import QRCodeModal from '~/components/modals/QRCode'
import type { ListEntry } from '~/components/Codes'

const ListItem = styled(MuiListItem)`
  cursor: pointer;

  .MuiListItemButton-root {
    min-height: 80px;
  }

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
  font-size: 12px;
`,
)

const Token = styled('span')(
  ({ theme }) => `
  color: ${theme.palette.primary.main};
  font-size: 20px;
  font-weight: 600;
`,
)

type ListProps = {
  className?: string
  entries: ListEntry[]
}

const List = ({ className, entries }: ListProps) => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { searchTerm } = useContext(SearchContext)
  const { sorting } = useContext(SortContext)
  const { dense, groupByTwos } = useContext(ListOptionsContext)
  const [activeEntry, setActiveEntry] = useState<ListEntry | null>(null)
  const [openQRCodeModal, setOpenQRCodeModal] = useState(false)

  const filteredEntries = [...entries].filter(
    (entry) =>
      entry.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      entry.issuer?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      entry.group?.toLowerCase().includes(searchTerm.toLowerCase()),
  )

  const sortedEntries = [...filteredEntries].sort((a, b) => {
    if (sorting === 'a-z') {
      return a.name < b.name ? -1 : 1
    }
    if (sorting === 'z-a') {
      return a.name > b.name ? -1 : 1
    }
    return 0
  })

  return (
    <>
      <Box className={className} sx={{ flexGrow: 1, maxWidth: 752 }}>
        <Grid container spacing={2}>
          <Grid item xs={12} md={6}>
            <MuiList dense={dense}>
              {sortedEntries.map((entry) => (
                <ListItem
                  key={entry.uuid}
                  disablePadding
                  secondaryAction={
                    <>
                      {entry.token && (
                        <>
                          <IconButton aria-label="copy to clipboard">
                            <CopyIcon color="primary" />
                          </IconButton>
                          <IconButton
                            aria-label="show QR code"
                            onClick={(event) => {
                              event.stopPropagation()
                              setActiveEntry(entry)
                              setOpenQRCodeModal(true)
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
                          navigate(`edit/${entry.uuid}`)
                        }}
                      >
                        <EditIcon color="primary" />
                      </IconButton>
                    </>
                  }
                  onClick={() => {
                    if (entry.token) {
                      clipboard.writeText(String(entry.token))
                      toast.success(t('toasts.copied'), {
                        id: 'clipboard',
                        duration: 1200,
                      })
                    }
                  }}
                >
                  <ListItemButton>
                    <ListItemAvatar>
                      <Avatar>
                        {entry.icon ? (
                          <Icon
                            dangerouslySetInnerHTML={{
                              __html: Buffer.from(entry.icon, 'base64').toString('utf8'),
                            }}
                          />
                        ) : (
                          <DescriptionIcon />
                        )}
                      </Avatar>
                    </ListItemAvatar>
                    <ListItemText
                      primary={
                        <Name>{`${entry.issuer ?? ''} ${
                          entry.issuer ? `(${entry.name})` : entry.name
                        }`}</Name>
                      }
                      secondary={
                        <Token>
                          {groupByTwos ? (
                            <>
                              {String(entry.token).slice(0, 2)} {String(entry.token).slice(2, 4)}{' '}
                              {String(entry.token).slice(4, 6)}
                            </>
                          ) : (
                            <>
                              {String(entry.token).slice(0, 3)} {String(entry.token).slice(3, 6)}
                            </>
                          )}
                        </Token>
                      }
                    />
                  </ListItemButton>
                </ListItem>
              ))}
            </MuiList>
          </Grid>
        </Grid>
      </Box>

      {activeEntry && (
        <QRCodeModal
          entry={activeEntry}
          open={openQRCodeModal}
          onClose={() => setOpenQRCodeModal(false)}
        />
      )}
    </>
  )
}

export default List
