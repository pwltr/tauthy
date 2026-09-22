import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { useContext, useEffect, useState } from 'react'
import { DragDropContext, Droppable, DropResult } from '@hello-pangea/dnd'
import Box from '@mui/material/Box'
import MuiList from '@mui/material/List'
import Grid from '@mui/material/Grid'

import { copyToClipboard, recordEntryUsage, reorderList, sortEntries } from '~/utils'
import { AppSettingsContext, ListOptionsContext, SearchContext, SortContext } from '~/context'
import QRCodeModal from '~/components/modals/QRCode'
import EntryListItem from './EntryListItem'
import type { ListEntry } from './Codes'
const appWindow = getCurrentWebviewWindow()

type ListProps = {
  className?: string
  entries: ListEntry[]
}

const EntryList = ({ className, entries }: ListProps) => {
  const { searchTerm } = useContext(SearchContext)
  const { sortOption, setSortOption, customOrder, setCustomOrder, entryUsage } =
    useContext(SortContext)
  const { minimizeOnCopy } = useContext(AppSettingsContext)
  const { dense } = useContext(ListOptionsContext)
  const [qrEntry, setQrEntry] = useState<ListEntry | null>(null)

  const sortedEntries = sortEntries(entries, sortOption, customOrder, entryUsage)

  const filteredEntries = sortedEntries.filter((entry) => {
    return (
      entry.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      entry.issuer?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      entry.group?.toLowerCase().includes(searchTerm.toLowerCase())
    )
  })

  useEffect(() => {
    const handleKeyPress = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'c') {
        event.preventDefault()

        if (filteredEntries.length === 1 && filteredEntries[0].token) {
          onCopy(filteredEntries[0].uuid, filteredEntries[0].token)
        }
      }
    }

    window.addEventListener('keydown', handleKeyPress)

    return () => {
      window.removeEventListener('keydown', handleKeyPress)
    }
  }, [filteredEntries.length, filteredEntries[0]?.uuid, filteredEntries[0]?.token])

  const onCopy = async (uuid: string, token: string) => {
    await copyToClipboard(token)
    recordEntryUsage(uuid)

    if (minimizeOnCopy) {
      await appWindow.minimize()
    }
  }

  const onDragEnd = ({ destination, source }: DropResult) => {
    if (!destination) return

    const newItems = reorderList(sortedEntries, source.index, destination.index).map((i) => i.uuid)

    setSortOption('custom')
    setCustomOrder(newItems)
  }

  return (
    <>
      <Box className={className} sx={{ flexGrow: 1, maxWidth: 752 }}>
        <Grid container spacing={2}>
          <Grid size={{ xs: 12, md: 6 }}>
            <DragDropContext onDragEnd={onDragEnd}>
              <Droppable droppableId="droppable-list">
                {(provided) => (
                  <MuiList ref={provided.innerRef} dense={dense} {...provided.droppableProps}>
                    {filteredEntries.map((entry, index) => (
                      <EntryListItem
                        key={entry.uuid}
                        item={entry}
                        index={index}
                        isDragDisabled={sortOption !== 'custom' || Boolean(searchTerm)}
                        setQrEntry={setQrEntry}
                      />
                    ))}
                    {provided.placeholder as string}
                  </MuiList>
                )}
              </Droppable>
            </DragDropContext>
          </Grid>
        </Grid>
      </Box>

      {qrEntry && <QRCodeModal entry={qrEntry} open onClose={() => setQrEntry(null)} />}
    </>
  )
}

export default EntryList
