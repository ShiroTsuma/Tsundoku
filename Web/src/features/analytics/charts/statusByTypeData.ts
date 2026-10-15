import type { BookAnalyticsDto } from '@/api/types'
import { formatCount, formatPercent, normalizedPercent, percent } from './chartUtils'

export type StatusByTypeTooltipEntry = {
  name?: unknown
  value?: unknown
  color?: string
  payload?: Record<string, unknown>
}

export function distributeStackedPercents(
  counts: number[],
  total: number,
  minimumPositivePercent = 3,
) {
  if (total <= 0) {
    return counts.map(() => 0)
  }

  const rawPercents = counts.map((count) => normalizedPercent(count, total))
  const positiveIndexes = rawPercents
    .map((value, index) => ({ value, index }))
    .filter((item) => item.value > 0)
  if (!positiveIndexes.length) {
    return rawPercents
  }

  const minimum =
    positiveIndexes.length * minimumPositivePercent >= 100
      ? 100 / positiveIndexes.length
      : minimumPositivePercent
  const small = positiveIndexes.filter((item) => item.value < minimum)
  const large = positiveIndexes.filter((item) => item.value >= minimum)
  const fixedSmallTotal = small.length * minimum
  const largeRawTotal = large.reduce((sum, item) => sum + item.value, 0)
  const remainingForLarge = Math.max(0, 100 - fixedSmallTotal)
  const result = rawPercents.map((value) => (value > 0 ? value : 0))

  for (const item of small) {
    result[item.index] = minimum
  }

  if (large.length && largeRawTotal > 0) {
    for (const item of large) {
      result[item.index] = (item.value / largeRawTotal) * remainingForLarge
    }
  } else if (small.length) {
    const equal = 100 / small.length
    for (const item of small) {
      result[item.index] = equal
    }
  }

  return result
}

export function statusByTypeTooltipRows(payload: readonly StatusByTypeTooltipEntry[] | undefined) {
  return (payload ?? [])
    .map((entry) => {
      const status = readEntryName(entry.name)
      const count = finiteNumber(entry.payload?.[`${status}Count`])
      const percentValue = entry.payload?.[`${status}Percent`] ?? entry.value

      return {
        color: entry.color ?? 'var(--color-status-unknown)',
        count,
        percent: finiteNumber(percentValue),
        status,
      }
    })
    .filter((row) => row.status && row.count > 0)
    .sort(
      (first, second) =>
        second.percent - first.percent ||
        second.count - first.count ||
        first.status.localeCompare(second.status),
    )
}

export function statusByTypeRows(data?: BookAnalyticsDto) {
  return (data?.composition.statusByType ?? []).flatMap((item) =>
    item.statuses.map((status) => [
      item.type,
      status.status,
      formatCount(status.bookCount),
      formatPercent(percent(status.bookCount, item.totalBooks)),
    ]),
  )
}

function finiteNumber(value: unknown) {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

function readEntryName(name: unknown) {
  if (typeof name === 'string') {
    return name
  }
  return typeof name === 'number' ? String(name) : ''
}
