import type { BookAnalyticsDto } from '@/api/types'
import { formatCount, formatPercent } from './chartUtils'

type CoverAvailabilityChartProps = {
  data: BookAnalyticsDto | undefined
}

export function CoverAvailabilityChart({ data }: CoverAvailabilityChartProps) {
  const statuses = data?.quality.coverStatuses ?? []
  const sources = data?.quality.coverSources ?? []

  if (!statuses.length && !sources.length) {
    return (
      <div className="grid min-h-56 place-items-center text-sm text-ink-2">
        0 cover records reported for this scope.
      </div>
    )
  }

  return (
    <div className="grid gap-4">
      <p className="text-sm text-ink-2">
        Usable covers are counted only when the backend has a Found or Uploaded cover with an image
        or thumbnail.
      </p>
      <div className="grid gap-2">
        <h3 className="text-sm font-semibold text-ink">Cover status actions</h3>
        {statuses.map((item) => (
          <div
            className="rounded-field border border-line-soft px-3 py-2 text-sm"
            key={item.status}
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="font-semibold text-ink">{item.status || 'Unknown status'}</span>
              <span className="text-ink-2">
                {formatCount(item.bookCount)} books · {formatPercent(item.shareOfBooks)}
              </span>
            </div>
            <div className="mt-1 text-ink-2">{coverStatusAction(item.status, item.bookCount)}</div>
          </div>
        ))}
      </div>
      <div className="grid gap-2">
        <h3 className="text-sm font-semibold text-ink">Top cover providers</h3>
        {sources.length ? (
          sources.map((item) => (
            <div
              className="flex flex-wrap items-center justify-between gap-3 text-sm"
              key={item.source}
            >
              <span className="font-semibold text-ink">{item.source || 'Unknown provider'}</span>
              <span className="text-ink-2">
                {formatCount(item.bookCount)} books · {formatPercent(item.shareOfBooks)}
              </span>
            </div>
          ))
        ) : (
          <div className="text-sm text-ink-2">No cover providers reported.</div>
        )}
      </div>
    </div>
  )
}

function coverStatusAction(status: string, bookCount: number) {
  if (status === 'Failed') {
    return `Review failed fetches: ${formatCount(bookCount)}`
  }
  if (status === 'NotFound') {
    return `Search manually: ${formatCount(bookCount)}`
  }
  if (status === 'Pending') {
    return `Queued for processing: ${formatCount(bookCount)}`
  }
  if (status === 'Found' || status === 'Uploaded') {
    return `Usable when image or thumbnail exists: ${formatCount(bookCount)}`
  }
  return `Unknown status bucket: ${formatCount(bookCount)} books`
}
