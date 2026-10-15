import { useId, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/utils'

type AnalyticsChartCardProps = {
  title: string
  description: string
  isLoading?: boolean
  isError?: boolean
  isEmpty?: boolean
  emptyMessage?: string
  onRetry?: () => void
  children: ReactNode
  columns: string[]
  rows: ReactNode[][]
  dataTableEnabled?: boolean
  className?: string
}

export function AnalyticsChartCard({
  title,
  description,
  isLoading = false,
  isError = false,
  isEmpty = false,
  emptyMessage = 'No analytics data for this card.',
  onRetry,
  children,
  columns,
  rows,
  dataTableEnabled = true,
  className,
}: AnalyticsChartCardProps) {
  const [showData, setShowData] = useState(false)
  const reactId = useId()
  const titleId = `${reactId}-title`
  const descriptionId = `${reactId}-description`
  const tableId = `${reactId}-data-table`

  return (
    <section
      aria-describedby={descriptionId}
      aria-labelledby={titleId}
      className={cn(
        'flex min-w-0 flex-col gap-4 rounded-panel border border-line bg-surface p-5',
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="m-0 text-base font-semibold" id={titleId}>
            {title}
          </h2>
          <p className="m-0 mt-1 text-[13px] text-ink-2" id={descriptionId}>
            {description}
          </p>
        </div>
        {dataTableEnabled ? (
          <Button
            aria-controls={tableId}
            aria-expanded={showData}
            aria-label={`${showData ? 'Hide' : 'View'} data for ${title}`}
            size="sm"
            variant="ghost"
            onClick={() => setShowData((current) => !current)}
          >
            {showData ? 'Hide data' : 'View data'}
          </Button>
        ) : null}
      </div>

      {isLoading ? (
        <div
          aria-label={`${title} loading`}
          className="flex h-64 animate-pulse flex-col gap-3 motion-reduce:animate-none"
          data-testid="analytics-card-skeleton"
          role="status"
        >
          <div className="h-4 w-1/3 rounded bg-raised" />
          <div className="mt-auto flex flex-col gap-2">
            <div className="h-8 rounded bg-raised" />
            <div className="h-12 rounded bg-raised" />
            <div className="h-20 rounded bg-raised" />
          </div>
        </div>
      ) : isError ? (
        <div
          className="grid min-h-64 place-items-center rounded-field border border-danger-line bg-danger-soft p-4 text-center text-danger-ink"
          role="alert"
        >
          <div>
            <p className="m-0 text-sm font-semibold">Could not load this chart.</p>
            {onRetry ? (
              <Button className="mt-3" size="sm" variant="danger" onClick={onRetry}>
                Retry
              </Button>
            ) : null}
          </div>
        </div>
      ) : isEmpty ? (
        <div className="grid min-h-64 place-items-center rounded-field border border-dashed border-line p-4 text-center text-sm text-ink-3">
          {emptyMessage}
        </div>
      ) : (
        <div className="analytics-chart-surface min-w-0">{children}</div>
      )}

      {dataTableEnabled && showData ? (
        <div className="max-h-80 overflow-auto rounded-xl border border-line bg-sunk" id={tableId}>
          <table className="min-w-full border-collapse text-left text-sm tabular-nums">
            <caption className="sr-only">{title} data table</caption>
            <thead className="sticky top-0 bg-sunk text-xs font-semibold tracking-[0.04em] text-ink-3 uppercase">
              <tr>
                {columns.map((column) => (
                  <th className="border-b border-line px-3 py-2.5" key={column} scope="col">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length ? (
                rows.map((row, rowIndex) => (
                  <tr
                    className="border-b border-line-soft last:border-b-0 hover:bg-hover"
                    key={rowIndex}
                  >
                    {row.map((cell, cellIndex) => (
                      <td className="px-3 py-2" key={cellIndex}>
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))
              ) : (
                <tr>
                  <td className="px-3 py-4 text-center text-ink-3" colSpan={columns.length}>
                    No rows.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  )
}
