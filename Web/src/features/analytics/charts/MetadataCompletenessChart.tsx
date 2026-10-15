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
      <div className="grid min-h-40 place-items-center text-sm text-ink-2">
        0 metadata fields reported for this scope.
      </div>
    )
  }

  const gaps = items
    .map((item) => ({ ...item, missing: Math.max(0, totalBooks - item.bookCount) }))
    .filter((item) => item.missing > 0)
    .sort((left, right) => right.missing - left.missing || left.field.localeCompare(right.field))
  const complete = items.filter((item) => item.bookCount >= totalBooks)

  return (
    <div className="flex flex-col gap-3">
      {gaps.length ? (
        <ul className="m-0 flex list-none flex-col p-0" aria-label="Fields with missing data">
          {gaps.map((item) => {
            const query = missingFieldQueries[item.field]
            const missingShare = 100 - Math.min(100, Math.max(0, item.shareOfBooks))
            return (
              <li
                className="grid grid-cols-[minmax(7rem,10rem)_minmax(0,1fr)_auto] items-center gap-3 border-t border-line-soft py-2 text-sm first:border-t-0"
                key={item.field}
              >
                <span className="truncate font-medium">{formatFieldName(item.field)}</span>
                <span
                  aria-label={`${formatFieldName(item.field)} missing for ${formatPercent(missingShare)} of books`}
                  className="h-2 overflow-hidden rounded-full bg-line-soft"
                  role="img"
                >
                  <span
                    className="block h-full rounded-full bg-chart-1"
                    style={{ width: `${String(missingShare)}%` }}
                  />
                </span>
                <span className="flex items-center gap-2 text-ink-2 tabular-nums">
                  {formatPercent(missingShare)}
                  {query ? (
                    <DrilldownLink className="min-h-0" query={query}>
                      Fix {formatCount(item.missing)}
                    </DrilldownLink>
                  ) : (
                    `${formatCount(item.missing)} missing`
                  )}
                </span>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="m-0 text-sm text-ink-2">Every tracked field is filled in for these books.</p>
      )}
      {complete.length ? (
        <p className="m-0 text-[13px] text-ink-3">
          Complete everywhere: {complete.map((item) => formatFieldName(item.field)).join(', ')}
        </p>
      ) : null}
    </div>
  )
}
