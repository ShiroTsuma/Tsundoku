import { useMediaQuery } from '@/lib/useMediaQuery'
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { BookAnalyticsDto } from '@/api/types'
import {
  analyticsTooltipProps,
  fieldQuery,
  formatCount,
  formatPercent,
  getActiveChartLabel,
  normalizedPercent,
  statusChartColor,
  compareStatusChartOrder,
  useBooksDrilldown,
} from './chartUtils'
import { DrilldownLink } from './DrilldownLink'
import {
  distributeStackedPercents,
  statusByTypeTooltipRows,
  type StatusByTypeTooltipEntry,
} from './statusByTypeData'

type StatusByTypeChartProps = {
  data: BookAnalyticsDto | undefined
}

type StatusByTypeTooltipProps = {
  active?: boolean
  label?: unknown
  payload?: StatusByTypeTooltipEntry[]
}

export function StatusByTypeChart({ data }: StatusByTypeChartProps) {
  const animate = !useMediaQuery('(prefers-reduced-motion: reduce)')
  const items = data?.composition.statusByType ?? []
  const openBooks = useBooksDrilldown()
  const statuses = Array.from(
    new Set(items.flatMap((item) => item.statuses.map((status) => status.status))),
  ).sort(compareStatusChartOrder)
  const chartData = items.map((item) => {
    const row: Record<string, number | string> = { type: item.type, totalBooks: item.totalBooks }
    const countsByStatus = Object.fromEntries(
      item.statuses.map((status) => [status.status, status.bookCount]),
    )
    const displayPercents = distributeStackedPercents(
      statuses.map((status) => countsByStatus[status] ?? 0),
      item.totalBooks,
    )
    statuses.forEach((status, statusIndex) => {
      const count = countsByStatus[status] ?? 0
      row[status] = displayPercents[statusIndex] ?? 0
      row[`${status}Percent`] = normalizedPercent(count, item.totalBooks)
      row[`${status}Count`] = count
    })

    return row
  })

  if (!items.length) {
    return (
      <div className="grid min-h-56 place-items-center text-sm text-ink-3">
        No status/type data for this analytics scope.
      </div>
    )
  }

  return (
    <div className="grid gap-4">
      <div
        className="analytics-drilldown-chart w-full min-w-0"
        data-testid="status-by-type-chart"
        style={{ height: Math.max(120, items.length * 44 + 40) }}
      >
        <ResponsiveContainer>
          <BarChart
            data={chartData}
            layout="vertical"
            margin={{ left: 8, right: 16 }}
            onClick={(event) => {
              const type = getActiveChartLabel(event)
              if (typeof type === 'string') {
                openBooks(fieldQuery('type', type))
              }
            }}
          >
            <XAxis
              domain={[0, 100]}
              tickFormatter={(value) => formatPercent(Number(value))}
              type="number"
            />
            <YAxis dataKey="type" tickLine={false} type="category" width={96} />
            <Tooltip {...analyticsTooltipProps} content={<StatusByTypeTooltip />} />
            {statuses.map((status) => (
              <Bar
                isAnimationActive={animate}
                className="analytics-drilldown-shape"
                dataKey={status}
                barSize={24}
                fill={statusChartColor(status)}
                key={status}
                stackId="books"
                stroke="var(--color-surface)"
                strokeWidth={2}
                onClick={(entry, _index, event) => {
                  event.stopPropagation()
                  const payload = getChartPayload(entry)
                  const type = payload.type
                  const count = payload[`${status}Count`]
                  if (typeof type === 'string' && Number(count) > 0) {
                    openBooks(`${fieldQuery('type', type)} ${fieldQuery('status', status)}`)
                  }
                }}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
        <div className="sr-only">
          {items.map((item) => (
            <DrilldownLink key={item.type} query={fieldQuery('type', item.type)}>
              Open {item.type} books
            </DrilldownLink>
          ))}
          {items.flatMap((item) =>
            item.statuses.map((status) => (
              <DrilldownLink
                key={`${item.type}-${status.status}`}
                query={`${fieldQuery('type', item.type)} ${fieldQuery('status', status.status)}`}
              >
                Open {item.type} {status.status} books
              </DrilldownLink>
            )),
          )}
        </div>
      </div>
      <ul
        aria-label="Statuses"
        className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1.5 p-0 text-[13px]"
      >
        {statuses.map((status) => (
          <li className="flex items-center gap-1.5 text-ink-2" key={status}>
            <span
              aria-hidden="true"
              className="size-2.5 rounded-sm"
              style={{ backgroundColor: statusChartColor(status) }}
            />
            {status}
          </li>
        ))}
      </ul>
      <ul className="m-0 flex list-none flex-col p-0 text-sm">
        {items.map((item) => (
          <li
            className="flex flex-wrap items-center justify-between gap-3 border-t border-line-soft py-2 first:border-t-0"
            key={item.type}
          >
            <span className="font-semibold text-ink">{item.type}</span>
            <span className="text-ink-3 tabular-nums">{formatCount(item.totalBooks)} books</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function StatusByTypeTooltip({ active, label, payload }: StatusByTypeTooltipProps) {
  const rows = statusByTypeTooltipRows(payload)

  if (!active || !rows.length) {
    return null
  }

  return (
    <div className="ui-chart-tooltip">
      <p className="font-bold text-ink">{String(label)}</p>
      <div className="mt-2 grid gap-1.5">
        {rows.map((row) => (
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3" key={row.status}>
            <span className="flex min-w-0 items-center gap-2">
              <span
                aria-hidden="true"
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: row.color }}
              />
              <span className="min-w-0 whitespace-normal break-words text-ink-2">{row.status}</span>
            </span>
            <span className="whitespace-nowrap font-semibold text-ink">
              {formatPercent(row.percent)} ({formatCount(row.count)} books)
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function getChartPayload(entry: unknown): Record<string, unknown> {
  if (
    entry &&
    typeof entry === 'object' &&
    'payload' in entry &&
    entry.payload &&
    typeof entry.payload === 'object'
  ) {
    return entry.payload as Record<string, unknown>
  }

  return {}
}
