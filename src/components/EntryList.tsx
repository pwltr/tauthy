import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { useContext, useEffect, useRef, useState, type ReactNode } from 'react'
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
  header?: ReactNode
}

const EntryList = ({ className, entries, header }: ListProps) => {
  const { searchTerm } = useContext(SearchContext)
  const { sortOption, setSortOption, customOrder, setCustomOrder, entryUsage } =
    useContext(SortContext)
  const { minimizeOnCopy } = useContext(AppSettingsContext)
  const { dense } = useContext(ListOptionsContext)
  const [qrEntry, setQrEntry] = useState<ListEntry | null>(null)
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({})

  const sortedEntries = sortEntries(entries, sortOption, customOrder, entryUsage)

  const filteredEntries = sortedEntries.filter((entry) => {
    return (
      entry.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      entry.issuer?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      entry.group?.toLowerCase().includes(searchTerm.toLowerCase())
    )
  })

  useEffect(() => {
    const focusFirstRow = (event: KeyboardEvent) => {
      if (
        event.key !== 'ArrowDown' ||
        event.defaultPrevented ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        !filteredEntries.length ||
        document.querySelector('[role="dialog"], [aria-modal="true"]') ||
        (event.target instanceof Element &&
          event.target.closest(
            'input, textarea, select, button, a, [contenteditable], [role="button"], [role="textbox"]',
          ))
      ) {
        return
      }

      const firstRow = rowRefs.current[filteredEntries[0].uuid]
      if (firstRow) {
        event.preventDefault()
        firstRow.focus()
      }
    }

    window.addEventListener('keydown', focusFirstRow)
    return () => window.removeEventListener('keydown', focusFirstRow)
  }, [filteredEntries[0]?.uuid])

  useEffect(() => {
    const singleResultToCopy = (event: KeyboardEvent | ClipboardEvent) => {
      // Native menu Copy can target the window, so inspect the focused element too.
      const target = event.target instanceof Element ? event.target : document.activeElement
      const searchInput = target instanceof Element && target.closest('[data-tauthy-search]')
      const editing =
        target instanceof Element &&
        target.closest('input, textarea, select, [contenteditable], [role="textbox"]')
      const selectedInputText =
        (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) &&
        target.selectionStart !== null &&
        target.selectionStart !== target.selectionEnd
      const eligible =
        !event.defaultPrevented &&
        (!editing || searchInput) &&
        !selectedInputText &&
        !window.getSelection()?.toString() &&
        !document.querySelector('[role="dialog"], [aria-modal="true"]') &&
        filteredEntries.length === 1 &&
        Boolean(filteredEntries[0].token)
      return eligible ? filteredEntries[0] : undefined
    }

    const handleKeyPress = (event: KeyboardEvent) => {
      const entry = singleResultToCopy(event)
      if (
        entry?.token &&
        !event.altKey &&
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === 'c'
      ) {
        event.preventDefault()
        void onCopy(entry.uuid, entry.token)
      }
    }

    const handleCopy = (event: ClipboardEvent) => {
      const entry = singleResultToCopy(event)
      if (entry?.token) {
        event.preventDefault()
        void onCopy(entry.uuid, entry.token)
      }
    }

    window.addEventListener('keydown', handleKeyPress)
    window.addEventListener('copy', handleCopy)

    return () => {
      window.removeEventListener('keydown', handleKeyPress)
      window.removeEventListener('copy', handleCopy)
    }
  }, [filteredEntries.length, filteredEntries[0]?.uuid, filteredEntries[0]?.token, minimizeOnCopy])

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
        {header}
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
                        setRowRef={(element) => {
                          rowRefs.current[entry.uuid] = element
                        }}
                        moveFocus={(direction) => {
                          const next = filteredEntries[index + direction]
                          if (next) rowRefs.current[next.uuid]?.focus()
                        }}
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
