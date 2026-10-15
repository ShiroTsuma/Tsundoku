import type { BookImportRowDto, BookImportSessionDto } from '@/api/types'

export function getImportSessionStats(session: BookImportSessionDto | null) {
  const invalidRows = session?.rows.filter((row) => !row.isValid) ?? []
  const totalRows = session?.totalRows ?? 0
  const validRows = session?.validRows ?? 0

  return {
    invalidRows,
    invalidRowsCount: session?.invalidRows ?? 0,
    progressPercent: totalRows === 0 ? 0 : (validRows / totalRows) * 100,
    totalRows,
    validRows,
  }
}

export type ImportIssueGroup = {
  key: string
  label: string
  /** Row field the fix writes to, when the group can be fixed by replacing one value. */
  field?: 'status' | 'contentType'
  /** Closest allowed value for a misspelt status or type. */
  suggestion?: string | undefined
  rowIds: string[]
}

const fieldLabels: Record<string, string> = { status: 'Status', contentType: 'Type' }

/** Groups invalid rows that share the same problem so they can be fixed or dropped together. */
export function getImportIssueGroups(session: BookImportSessionDto | null): ImportIssueGroup[] {
  if (!session) return []
  const groups = new Map<string, ImportIssueGroup>()

  for (const row of session.rows) {
    if (row.isValid) continue
    for (const issue of getRowIssues(row, session)) {
      const group = groups.get(issue.key)
      if (group) group.rowIds.push(row.rowId)
      else groups.set(issue.key, { ...issue, rowIds: [row.rowId] })
    }
  }

  return [...groups.values()].sort((a, b) => b.rowIds.length - a.rowIds.length)
}

/** Short descriptions of what is wrong with one row (no suggestions). */
export function getRowIssueLabels(row: BookImportRowDto) {
  return getRowIssues(row, { availableStatuses: [], availableContentTypes: [] }).map(
    (issue) => issue.label,
  )
}

function getRowIssues(
  row: BookImportRowDto,
  session: Pick<BookImportSessionDto, 'availableStatuses' | 'availableContentTypes'>,
) {
  const issues: Omit<ImportIssueGroup, 'rowIds'>[] = []
  const fieldMessages = new Set<string>()

  for (const [field, messages] of Object.entries(row.fieldErrors)) {
    for (const message of messages) {
      fieldMessages.add(message)
      if (field === 'status' || field === 'contentType') {
        const value = (row[field] ?? '').trim()
        const options =
          field === 'status' ? session.availableStatuses : session.availableContentTypes
        issues.push({
          key: `${field}\u0000${value.toLowerCase()}`,
          label: value
            ? `${fieldLabels[field] ?? field} “${value}” does not exist`
            : `${fieldLabels[field] ?? field} is missing`,
          field,
          suggestion: value ? findClosestOption(value, options) : undefined,
        })
      } else {
        issues.push({ key: `${field}\u0000${message}`, label: message })
      }
    }
  }

  for (const message of row.errors) {
    if (!fieldMessages.has(message)) issues.push({ key: `\u0000${message}`, label: message })
  }

  return issues
}

/** The allowed value a typo most likely meant, or undefined when nothing is close. */
export function findClosestOption(value: string, options: string[]) {
  const target = value.trim().toLowerCase()
  let best: { option: string; distance: number } | undefined
  for (const option of options) {
    const candidate = option.toLowerCase()
    // A cut-off value ("plan" for "Plan To Read") counts as an exact match.
    const distance =
      target.length >= 3 && candidate.startsWith(target) ? 0 : editDistance(target, candidate)
    if (!best || distance < best.distance) best = { option, distance }
  }
  return best && best.distance <= Math.max(2, Math.floor(target.length / 3))
    ? best.option
    : undefined
}

function editDistance(a: string, b: string) {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index)
  for (let i = 1; i <= a.length; i++) {
    const current = [i]
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        (previous[j] ?? 0) + 1,
        (current[j - 1] ?? 0) + 1,
        (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
    }
    previous = current
  }
  return previous[b.length] ?? 0
}
