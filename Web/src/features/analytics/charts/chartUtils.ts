import { useNavigate, useSearchParams } from 'react-router-dom'
import { addDays, addMonths, addWeeks, format, parseISO } from 'date-fns'

/** One colour for single-series charts. */
export const seriesColor = 'var(--color-chart-1)'

// Reading statuses keep their app hue family, in an order that passes the CVD checks
// when stacked (Reading, Completed, On hold, Plan to read, Dropped). Unknown is the neutral "other".
const statusChartColors: Record<string, string> = {
  reading: 'var(--color-chart-1)',
  completed: 'var(--color-chart-3)',
  'on hold': 'var(--color-chart-2)',
  'plan to read': 'var(--color-chart-7)',
  dropped: 'var(--color-chart-8)',
}
const statusChartOrder = ['reading', 'completed', 'on hold', 'plan to read', 'dropped']

export function statusChartColor(status: string) {
  return statusChartColors[status.trim().toLowerCase()] ?? 'var(--color-status-unknown)'
}

/** Sorts statuses into the stacking order the status colours were validated in. */
export function compareStatusChartOrder(a: string, b: string) {
  const rank = (status: string) => {
    const index = statusChartOrder.indexOf(status.trim().toLowerCase())
    return index === -1 ? statusChartOrder.length : index
  }
  return rank(a) - rank(b)
}

export const analyticsTooltipProps = {
  contentStyle: {
    backgroundColor: 'var(--color-raised)',
    border: '1px solid var(--color-line-strong)',
    borderRadius: '10px',
    boxShadow: 'var(--shadow-popover)',
    color: 'var(--color-ink)',
  },
  itemStyle: {
    color: 'var(--color-ink)',
  },
  labelStyle: {
    color: 'var(--color-ink)',
    fontWeight: 600,
  },
  cursor: { fill: 'var(--color-hover)' },
}

export function formatCount(value: number) {
  return new Intl.NumberFormat('en-US').format(value)
}

export function formatPercent(value: number) {
  const normalized = Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0))
  const rounded = Math.round(normalized * 10) / 10
  return `${rounded.toFixed(rounded >= 10 || rounded === 0 ? 0 : 1)}%`
}

export function percent(part: number, total: number) {
  return total > 0 ? (part / total) * 100 : 0
}

export function normalizedPercent(part: number, total: number) {
  return Math.round(percent(part, total) * 10) / 10
}

export function focusedValueDomain(values: readonly number[]): [number, number] {
  const finiteValues = values.filter(Number.isFinite)
  if (!finiteValues.length) {
    return [0, 1]
  }

  const minimum = Math.min(...finiteValues)
  const maximum = Math.max(...finiteValues)
  const span = maximum - minimum
  const magnitude = Math.max(Math.abs(minimum), Math.abs(maximum))
  const padding = Math.max(1, span * 0.12, magnitude * 0.002)

  return [Math.floor(minimum - padding), Math.ceil(maximum + padding)]
}

export function booksHref(query: string) {
  return `/books?query=${encodeURIComponent(query)}`
}

export function fieldQuery(field: string, value: string) {
  return `${field}:${quoteQueryValue(value)}`
}

export function numberQuery(field: string, value: string | number) {
  return `${field}:${value}`
}

export function noneQuery(field: string) {
  return `${field}:none`
}

export function quoteQueryValue(value: string) {
  return /^[A-Za-z0-9_-]+$/.test(value) ? value : `"${value.replaceAll('"', '\\"')}"`
}

export function useBooksDrilldown() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  return (query: string) => {
    void navigate(booksHref(mergeAnalyticsQuery(searchParams, query)))
  }
}

export function mergeAnalyticsQuery(searchParams: URLSearchParams, drilldownQuery: string) {
  const from = searchParams.get('from')?.trim()
  const to = searchParams.get('to')?.trim()
  return [
    searchParams.get('query')?.trim(),
    from ? `created:>=${from}` : '',
    to ? `created:<${to}` : '',
    drilldownQuery.trim(),
  ]
    .filter(Boolean)
    .join(' ')
}

export function getActiveChartLabel(event: unknown) {
  if (event && typeof event === 'object' && 'activeLabel' in event) {
    const label = event.activeLabel
    return typeof label === 'string' || typeof label === 'number' ? label : null
  }

  return null
}

export type AnalyticsDateBucket = 'day' | 'week' | 'month'

export function dateRangeForBucket(date: string, bucket: string): { start: string; end: string } {
  const start = parseISO(date)
  const end =
    bucket === 'month'
      ? addMonths(start, 1)
      : bucket === 'week'
        ? addWeeks(start, 1)
        : addDays(start, 1)

  return {
    start: format(start, 'yyyy-MM-dd'),
    end: format(end, 'yyyy-MM-dd'),
  }
}

export function formatDateRange(startText: string, endExclusiveText?: string) {
  const start = parseISO(startText)
  const endInclusive = endExclusiveText ? addDays(parseISO(endExclusiveText), -1) : start

  if (format(start, 'yyyy-MM-dd') === format(endInclusive, 'yyyy-MM-dd')) {
    return format(start, 'MMM d, yyyy')
  }

  if (start.getFullYear() !== endInclusive.getFullYear()) {
    return `${format(start, 'MMM d, yyyy')} – ${format(endInclusive, 'MMM d, yyyy')}`
  }

  if (start.getMonth() !== endInclusive.getMonth()) {
    return `${format(start, 'MMM d')} – ${format(endInclusive, 'MMM d, yyyy')}`
  }

  return `${format(start, 'MMMM d')}–${format(endInclusive, 'd, yyyy')}`
}
