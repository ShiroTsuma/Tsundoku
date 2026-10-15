import type { BookAnalyticsDto } from '@/api/types'
import { formatCount, formatPercent, noneQuery } from './chartUtils'
import { DrilldownLink } from './DrilldownLink'
import { formatFieldName } from './metadataCompletenessData'

type MetadataCompletenessChartProps = {
  data: BookAnalyticsDto | undefined
}

const missingFieldQueries: Record<string, string> = {
  author: noneQuery('author'),
  description: noneQuery('description'),
  genre: noneQuery('genre'),
  tag: noneQuery('tag'),
  rating: noneQuery('rating'),
  priority: noneQuery('priority'),
  totalChapters: noneQuery('total'),
  link: noneQuery('link'),
  alternateTitle: noneQuery('alternateTitle'),
  usableCover: noneQuery('cover'),
}

export function MetadataCompletenessChart({ data }: MetadataCompletenessChartProps) {
  const items = [...(data?.quality.fieldCompleteness ?? [])].sort(
    (left, right) =>
      left.shareOfBooks - right.shareOfBooks || left.field.localeCompare(right.field),
  )
  const totalBooks = data?.overview.totalBooks ?? 0

  if (!items.length) {
    return (
      <div className="grid min-h-56 place-items-center text-sm text-ink-2">
        0 metadata fields reported for this scope.
      </div>
    )
  }

  return (
    <div className="grid gap-3">
      <p className="text-sm text-ink-2">
        Cleanup queue: fields with lower coverage are good candidates for metadata review.
      </p>
      {items.map((item) => {
        const missingCount = Math.max(0, totalBooks - item.bookCount)
        const query = missingFieldQueries[item.field]
        return (
          <div className="grid gap-1" key={item.field}>
            <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
              <span className="font-semibold text-ink">{formatFieldName(item.field)}</span>
              <span className="text-ink-2">
                {formatCount(item.bookCount)} complete · {formatPercent(item.shareOfBooks)}
              </span>
            </div>
            <div
              className="ui-progress-track"
              aria-label={`${formatFieldName(item.field)} completeness ${formatPercent(item.shareOfBooks)}`}
            >
              <div
                className="ui-progress-fill"
                style={{ width: `${Math.min(100, Math.max(0, item.shareOfBooks))}%` }}
              />
            </div>
            <div className="text-sm text-ink-2">
              Complete {formatCount(item.bookCount)} of {formatCount(totalBooks)} books. Missing:{' '}
              {query && missingCount > 0 ? (
                <DrilldownLink query={query}>{formatCount(missingCount)} books</DrilldownLink>
              ) : (
                `${formatCount(missingCount)} books`
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
