type SearchableEntry = { name: string; issuer?: string | null; group?: string | null }

const normalize = (value: string) => value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()

// Bounded optimal-string-alignment distance to a word or its prefix. An adjacent
// letter swap counts as one typo, as do inserting, deleting, or replacing a letter.
const typoDistance = (term: string, candidate: string, limit: number): number => {
  if (candidate.length < term.length - limit) return limit + 1
  // Only compare the portion the user could have typed. Trailing letters do
  // not count as missing characters, and long labels cannot inflate the matrix.
  const prefix = candidate.slice(0, term.length + limit)
  const minPrefixLength = Math.min(prefix.length, Math.max(3, term.length - limit))
  let previous = Array.from({ length: prefix.length + 1 }, (_, index) => index)
  let beforePrevious = previous
  for (let row = 1; row <= term.length; row += 1) {
    const current = [row]
    for (let column = 1; column <= prefix.length; column += 1) {
      current[column] = Math.min(
        previous[column] + 1,
        current[column - 1] + 1,
        previous[column - 1] + (term[row - 1] === prefix[column - 1] ? 0 : 1),
      )
      if (
        row > 1 &&
        column > 1 &&
        term[row - 1] === prefix[column - 2] &&
        term[row - 2] === prefix[column - 1]
      ) {
        current[column] = Math.min(current[column], beforePrevious[column - 2] + 1)
      }
    }
    if (Math.min(...current) > limit) return limit + 1
    beforePrevious = previous
    previous = current
  }
  return Math.min(...previous.slice(minPrefixLength))
}

/** Search account metadata only, placing literal matches before typo matches.
 * The caller's existing sort order breaks ties and is preserved for an empty query.
 */
export const searchEntries = <T extends SearchableEntry>(entries: T[], query: string): T[] => {
  const terms = normalize(query).trim().split(/\s+/).filter(Boolean)
  if (!terms.length) return [...entries]

  const matches: Array<{ entry: T; index: number; distance: number }> = []
  entries.forEach((entry, index) => {
    const fields = [entry.issuer ?? '', entry.name, entry.group ?? ''].map(normalize)
    const candidates = fields.flatMap((field) => [field, ...field.split(/[^\p{L}\p{N}]+/u)])
    let distance = 0
    for (const term of terms) {
      if (fields.some((field) => field.includes(term))) continue
      // Short searches stay literal to avoid noisy results. Long pasted strings
      // also stay literal, keeping fuzzy work bounded during typing/refreshes.
      if (term.length < 3 || term.length > 64) return
      const limit = term.length >= 6 ? 2 : 1
      const best = candidates.reduce(
        (best, candidate) => Math.min(best, typoDistance(term, candidate, limit)),
        limit + 1,
      )
      if (best > limit) return
      distance += best
    }
    matches.push({ entry, index, distance })
  })
  return matches
    .sort((first, second) => first.distance - second.distance || first.index - second.index)
    .map(({ entry }) => entry)
}
