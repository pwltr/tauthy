export type SortOption = 'custom' | 'a-z' | 'z-a' | 'frequent' | 'recent'

export type EntryUsage = {
  count: number
  lastUsedAt: number
}

export type EntryUsageMap = Record<string, EntryUsage>

type SortableEntry = {
  uuid: string
  name: string
  issuer?: string
}

const compareEntryLabels = <T extends SortableEntry>(
  first: T,
  second: T,
  collator: Intl.Collator,
) => {
  const firstIssuer = first.issuer?.trim() || first.name
  const secondIssuer = second.issuer?.trim() || second.name

  return (
    collator.compare(firstIssuer, secondIssuer) ||
    collator.compare(first.name, second.name) ||
    collator.compare(first.uuid, second.uuid)
  )
}

export const sortEntries = <T extends SortableEntry>(
  entries: T[],
  sortOption: SortOption,
  customOrder: string[],
  usage: EntryUsageMap,
  locales?: string | string[],
): T[] => {
  if (sortOption === 'custom') {
    const positions = new Map(customOrder.map((uuid, index) => [uuid, index]))
    return [...entries].sort((first, second) => {
      const firstPosition = positions.get(first.uuid)
      const secondPosition = positions.get(second.uuid)
      if (firstPosition === undefined && secondPosition === undefined) return 0
      if (firstPosition === undefined) return 1
      if (secondPosition === undefined) return -1
      return firstPosition - secondPosition
    })
  }

  const collator = new Intl.Collator(locales, { sensitivity: 'base', numeric: true })
  const alphabetical = (first: T, second: T) => compareEntryLabels(first, second, collator)

  if (sortOption === 'a-z') return [...entries].sort(alphabetical)
  if (sortOption === 'z-a') return [...entries].sort((first, second) => alphabetical(second, first))

  return [...entries].sort((first, second) => {
    const firstUsage = usage[first.uuid]
    const secondUsage = usage[second.uuid]

    if (sortOption === 'frequent') {
      const countDifference = (secondUsage?.count ?? 0) - (firstUsage?.count ?? 0)
      if (countDifference !== 0) return countDifference
    }

    const recencyDifference = (secondUsage?.lastUsedAt ?? 0) - (firstUsage?.lastUsedAt ?? 0)
    return recencyDifference || alphabetical(first, second)
  })
}
