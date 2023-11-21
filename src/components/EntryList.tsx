import { appWindow } from '@tauri-apps/api/window'
import { FC, useContext, useEffect, useState } from 'react'
import {
  DragDropContext as _DragDropContext,
  Droppable as _Droppable,
  DragDropContextProps,
  DroppableProps,
  DropResult,
} from 'react-beautiful-dnd'
import Box from '@mui/material/Box'
import MuiList from '@mui/material/List'
import Grid from '@mui/material/Grid'

import { copyToClipboard, reorderList } from '~/utils'
import { AppSettingsContext, ListOptionsContext, SearchContext, SortContext } from '~/context'
import QRCodeModal from '~/components/modals/QRCode'
import EntryListItem from './EntryListItem'
import type { ListEntry } from './Codes'

// HACK: this fixes type incompatibility
const DragDropContext = _DragDropContext as unknown as FC<DragDropContextProps>
const Droppable = _Droppable as unknown as FC<DroppableProps>

type ListProps = {
  className?: string
  entries: ListEntry[]
}

const EntryList = ({ className, entries }: ListProps) => {
  const { searchTerm } = useContext(SearchContext)
  const { sortOption, setSortOption, customOrder, setCustomOrder } = useContext(SortContext)
  const { minimizeOnCopy } = useContext(AppSettingsContext)
  const { dense } = useContext(ListOptionsContext)
  const [qrEntry, setQrEntry] = useState<ListEntry | null>(null)

  const sortEntries = (entries: ListEntry[]) => {
    if (sortOption === 'a-z') {
      return entries.sort((a, b) => {
        return a.name < b.name ? -1 : 1
      })
    }
    if (sortOption === 'z-a') {
      return entries.sort((a, b) => {
        return a.name > b.name ? -1 : 1
      })
    }
    if (sortOption === 'custom' && customOrder.length) {
      const existing = customOrder.filter((uuid) => entries.find((i) => i.uuid === uuid))
      const sorted = existing.map((uuid) => entries.find((i) => i.uuid === uuid)!)
      const unsorted = entries.filter((entry) => !existing.includes(entry.uuid))
      return [...sorted, ...unsorted]
    }
    return entries
  }

  const sortedEntries = sortEntries(entries)

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
          onCopy(filteredEntries[0].token)
        }
      }
    }

    window.addEventListener('keydown', handleKeyPress)

    return () => {
      window.removeEventListener('keydown', handleKeyPress)
    }
  }, [filteredEntries.length === 1, filteredEntries[0]?.token])

  const onCopy = async (token: string) => {
    copyToClipboard(token)

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
          <Grid item xs={12} md={6}>
            <DragDropContext onDragEnd={onDragEnd}>
              <Droppable droppableId="droppable-list">
                {(provided) => (
                  <MuiList ref={provided.innerRef} dense={dense} {...provided.droppableProps}>
                    {filteredEntries.map((entry, index) => (
                      <EntryListItem
                        key={entry.uuid}
                        item={entry}
                        index={index}
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
