import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useTranslation } from 'react-i18next'
import { useLocalStorage } from './useLocalStorage'
import { sortEntries, type EntryUsageMap } from '~/utils/sorting'
import { searchEntries } from '~/utils/search'
import type {
  QuickPickerEntry,
  QuickPickerResponse,
  QuickPickerSnapshot,
} from '~/types/quickPicker'

export const useQuickPicker = () => {
  const { i18n } = useTranslation()
  const [usage] = useLocalStorage<EntryUsageMap>('entryUsage', {})
  const [listOptions] = useLocalStorage('listOptions', { dense: false, groupByTwos: false })
  const [snapshot, setSnapshot] = useState<QuickPickerSnapshot | null>(null)
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const active = useRef(false)
  const session = useRef(0)
  const copyOperation = useRef<number | null>(null)
  const nextCopyOperation = useRef(0)
  const request = useRef<(metadata: boolean) => void>(() => {})

  useEffect(() => {
    let disposed = false
    let inFlight = false
    let pending = false
    let metadataPending = false
    let revision = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    let knownIds = new Set<string>()
    const removers: Array<() => void> = []
    const cancelTimer = () => clearTimeout(timer)
    const schedule = (delay: number, metadata = false) => {
      cancelTimer()
      timer = setTimeout(() => enqueue(metadata), delay)
    }
    const enqueue = (metadata: boolean) => {
      if (!active.current || disposed) return
      if (metadata) {
        revision += 1
        metadataPending = true
      }
      pending = true
      cancelTimer()
      void drain()
    }
    const drain = async () => {
      if (inFlight) return
      inFlight = true
      try {
        while (pending && active.current && !disposed) {
          const requestSession = session.current
          const requestRevision = revision
          const includeMetadata = metadataPending
          pending = false
          metadataPending = false
          try {
            const data = await invoke<QuickPickerResponse>('quick_picker_snapshot', {
              includeMetadata,
            })
            if (
              disposed ||
              !active.current ||
              session.current !== requestSession ||
              revision !== requestRevision
            )
              continue
            if (data.locked) {
              knownIds.clear()
              setSnapshot({ locked: true, entries: [] })
            } else if (data.entries) {
              knownIds = new Set(data.entries.map(({ uuid }) => uuid))
              setSnapshot({ locked: false, entries: data.entries })
            } else if (data.codes) {
              const codes = new Map(data.codes.map(({ uuid, code }) => [uuid, code]))
              if (
                codes.size !== knownIds.size ||
                [...codes.keys()].some((id) => !knownIds.has(id))
              ) {
                // Recover metadata even if an account-change event was missed.
                setSnapshot(null)
                enqueue(true)
                continue
              }
              setSnapshot(
                (previous) =>
                  previous && {
                    locked: false,
                    entries: previous.entries.map((entry) => ({
                      ...entry,
                      code: codes.get(entry.uuid) ?? null,
                    })),
                  },
              )
            } else {
              throw new Error('Invalid picker response')
            }
            setError((previous) => (previous === 'unavailable' ? '' : previous))
            if (!data.locked) {
              // Use the backend's skew-aware boundary, with a small margin.
              const expiry = data.expiresAtMs ?? Date.now() + 30_000
              schedule(Math.max(1, Math.min(30_000, expiry - Date.now() + 10)))
            }
          } catch {
            if (
              !disposed &&
              active.current &&
              session.current === requestSession &&
              revision === requestRevision
            ) {
              setSnapshot(null)
              setError('unavailable')
              schedule(1000, true)
            }
          }
        }
      } finally {
        inFlight = false
      }
    }
    request.current = enqueue
    const opened = () => {
      active.current = true
      session.current += 1
      setSnapshot(null)
      setQuery('')
      setSelectedId(null)
      setError('')
      copyOperation.current = null
      enqueue(true)
      input.current?.focus()
    }
    const closed = () => {
      active.current = false
      session.current += 1
      revision += 1
      pending = false
      metadataPending = false
      knownIds.clear()
      cancelTimer()
      setSnapshot(null)
      setQuery('')
      setSelectedId(null)
    }
    const subscribe = async (event: string, callback: () => void) => {
      const remove = await listen(event, callback)
      if (disposed) remove()
      else removers.push(remove)
    }
    void Promise.all([
      subscribe('tauthy://picker-open', opened),
      subscribe('tauthy://picker-close', closed),
      subscribe('tauthy://picker-refresh', () => {
        if (!active.current) return
        // A lock/update must immediately invalidate displayed codes, including
        // any older code-only request that is still resolving.
        setSnapshot(null)
        enqueue(true)
      }),
    ])
      .then(() => {
        if (!disposed) void invoke('quick_picker_ready').catch(console.error)
      })
      .catch(console.error)
    const focused = () => enqueue(false)
    window.addEventListener('focus', focused)
    return () => {
      disposed = true
      active.current = false
      session.current += 1
      cancelTimer()
      removers.forEach((remove) => remove())
      window.removeEventListener('focus', focused)
      request.current = () => {}
    }
  }, [])

  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (event.key === 'i18nextLng' && event.newValue) void i18n.changeLanguage(event.newValue)
    }
    window.addEventListener('storage', changed)
    return () => window.removeEventListener('storage', changed)
  }, [i18n])

  const entries = useMemo(
    () =>
      searchEntries(
        sortEntries(snapshot?.entries ?? [], 'recent', [], usage, i18n.language),
        query,
      ),
    [snapshot, query, usage, i18n.language],
  )
  const index = entries.findIndex(({ uuid }) => uuid === selectedId)
  const selection = index >= 0 ? index : 0
  useEffect(() => {
    if (snapshot) setSelectedId(entries[selection]?.uuid ?? null)
  }, [snapshot, entries, selection])
  useEffect(() => {
    document.getElementById(`picker-option-${selection}`)?.scrollIntoView?.({ block: 'nearest' })
  }, [selection, query])

  const copy = useCallback(async (entry: QuickPickerEntry | undefined) => {
    if (!active.current || !entry?.code || copyOperation.current !== null) return
    const operation = ++nextCopyOperation.current
    const copySession = session.current
    copyOperation.current = operation
    try {
      await invoke('quick_picker_copy', { uuid: entry.uuid })
    } catch {
      if (active.current && session.current === copySession) {
        setError('copyFailed')
        request.current(true)
      }
    } finally {
      if (copyOperation.current === operation) copyOperation.current = null
    }
  }, [])
  const changeQuery = (value: string) => {
    setQuery(value)
    setSelectedId(null)
    setError('')
  }
  const select = (index: number) => setSelectedId(entries[index]?.uuid ?? null)
  const moveSelection = (direction: number) =>
    select(Math.max(0, Math.min(entries.length - 1, selection + direction)))
  const canCopySelection = () => {
    const search = input.current
    const selectedText =
      window.getSelection()?.toString() ||
      (search && document.activeElement === search && search.selectionStart !== search.selectionEnd)
    return active.current && !snapshot?.locked && Boolean(entries[selection]?.code) && !selectedText
  }
  const dismiss = () => void invoke('quick_picker_dismiss').catch(console.error)
  const openMain = () => void invoke('quick_picker_open_main').catch(console.error)

  return {
    snapshot,
    entries,
    selection,
    query,
    error,
    input,
    changeQuery,
    select,
    moveSelection,
    canCopySelection,
    copy,
    dismiss,
    openMain,
    groupByTwos: listOptions.groupByTwos,
  }
}
