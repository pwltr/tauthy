import type { EntryUsageMap } from './sorting'

export const ENTRY_USAGE_STORAGE_KEY = 'entryUsage'

export const recordEntryUsage = (uuid: string, usedAt = Date.now()) => {
  let usage: EntryUsageMap = {}

  try {
    const parsed = JSON.parse(window.localStorage.getItem(ENTRY_USAGE_STORAGE_KEY) ?? '{}')
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) usage = parsed
  } catch {
    // Replace malformed local-only metadata rather than interrupting a code copy.
  }

  const previous = usage[uuid]
  usage[uuid] = {
    count: Math.min((previous?.count ?? 0) + 1, Number.MAX_SAFE_INTEGER),
    lastUsedAt: usedAt,
  }
  window.localStorage.setItem(ENTRY_USAGE_STORAGE_KEY, JSON.stringify(usage))
  window.dispatchEvent(new Event('local-storage'))
}
