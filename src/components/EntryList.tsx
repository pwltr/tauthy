import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { Menu } from '@tauri-apps/api/menu'
import { confirm } from '@tauri-apps/plugin-dialog'
import { useContext, useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
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
  onDelete?: (uuid: string) => Promise<void>
}

const EntryList = ({ className, entries, header, onDelete }: ListProps) => {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const { searchTerm } = useContext(SearchContext)
  const { sortOption, setSortOption, customOrder, setCustomOrder, entryUsage } =
    useContext(SortContext)
  const { minimizeOnCopy } = useContext(AppSettingsContext)
  const { dense } = useContext(ListOptionsContext)
  const [qrEntry, setQrEntry] = useState<ListEntry | null>(null)
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const selectedEntryId = useRef<string | null>(null)
  const entriesRef = useRef(entries)
  const menuRef = useRef<Promise<Menu> | null>(null)
  const copyRef = useRef<(uuid: string, token: string) => Promise<void>>(async () => {})
  const deleteRef = useRef(onDelete)
  entriesRef.current = entries
  deleteRef.current = onDelete

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
  copyRef.current = onCopy

  useEffect(() => {
    const selectedEntry = () =>
      entriesRef.current.find((entry) => entry.uuid === selectedEntryId.current)
    const menu = Menu.new({
      items: [
        {
          id: 'account-copy',
          text: t('contextMenu.copyCode'),
          action: () => {
            const entry = selectedEntry()
            if (entry?.token) {
              void copyRef
                .current(entry.uuid, entry.token)
                .catch(() => toast.error(t('toasts.copyFailed')))
            }
          },
        },
        {
          id: 'account-edit',
          text: t('contextMenu.edit'),
          action: () => {
            const entry = selectedEntry()
            if (entry) navigate(`edit/${entry.uuid}`)
          },
        },
        {
          id: 'account-qr',
          text: t('contextMenu.showQrCode'),
          action: () => {
            const entry = selectedEntry()
            if (entry?.token) setQrEntry(entry)
          },
        },
        { item: 'Separator' },
        {
          id: 'account-delete',
          text: t('contextMenu.delete'),
          action: () => {
            const entry = selectedEntry()
            if (!entry || !deleteRef.current) return
            void (async () => {
              const accepted = await confirm(t('contextMenu.deleteConfirm', { name: entry.name }), {
                title: t('contextMenu.delete'),
                kind: 'warning',
              })
              if (accepted) await deleteRef.current?.(entry.uuid)
            })().catch(() => toast.error(t('contextMenu.deleteFailed')))
          },
        },
      ],
    })
    menuRef.current = menu
    void menu.catch(() => {})
    return () => {
      menuRef.current = null
      void menu.then((ready) => ready.close()).catch(() => {})
    }
  }, [i18n.resolvedLanguage, navigate, t])

  const openContextMenu = (event: MouseEvent<HTMLLIElement>, uuid: string) => {
    event.preventDefault()
    event.stopPropagation()
    selectedEntryId.current = uuid
    const menu = menuRef.current
    if (!menu) return
    void menu
      .then(async (ready) => {
        const hasCode = Boolean(entriesRef.current.find((entry) => entry.uuid === uuid)?.token)
        for (const id of ['account-copy', 'account-qr']) {
          const item = await ready.get(id)
          if (item && 'setEnabled' in item) await item.setEnabled(hasCode)
        }
        await ready.popup()
      })
      .catch(() => toast.error(t('contextMenu.unavailable')))
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
                        onContextMenu={openContextMenu}
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
