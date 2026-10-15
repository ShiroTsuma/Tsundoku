import { useState } from 'react'
import type { BookAnalyticsRelationCountDto } from '@/api/types'
import { fieldQuery, formatCount, formatPercent } from './chartUtils'
import { DrilldownLink } from './DrilldownLink'
import { toLimitedRelationRows } from './topRelationsData'
import { buttonStyles } from '@/components/ui/buttonStyles'

type TopRelationsChartProps = {
  field: 'genre' | 'tag'
  items: BookAnalyticsRelationCountDto[]
  title: string
}

const topLimit = 5

export function TopRelationsChart({ field, items, title }: TopRelationsChartProps) {
  const moreLimit = field === 'tag' ? 20 : 50
  const [visibleLimit, setVisibleLimit] = useState(topLimit)
  const rows = toLimitedRelationRows(items, visibleLimit)
  const remainingCount = Math.max(0, items.length - visibleLimit)
  const nextBatchCount = Math.min(moreLimit, remainingCount)
  const expanded = visibleLimit > topLimit

  if (!items.length) {
    return (
      <div className="grid min-h-56 place-items-center text-sm text-ink-3">
        No {title.toLowerCase()} data for this analytics scope.
      </div>
    )
  }

  return (
    <div className="grid gap-3">
      <p className="text-sm text-ink-3">
        Multi-value books can count in more than one {title.toLowerCase()} bucket; shares are
        measured against matching books.
      </p>
      {rows.map((item) => (
        <div className="grid gap-1" key={item.name}>
          <div className="flex items-center justify-between gap-3 text-sm">
            {item.isOther ? (
              <span className="font-semibold text-ink">Other</span>
            ) : (
              <DrilldownLink query={fieldQuery(field, item.name)}>{item.name}</DrilldownLink>
            )}
            <span className="text-ink-3">
              {formatCount(item.bookCount)} books · {formatPercent(item.shareOfBooks)}
            </span>
          </div>
          <div className="ui-progress-track">
            <div
              className="ui-progress-fill"
              style={{ width: `${Math.min(100, item.shareOfBooks)}%` }}
            />
          </div>
        </div>
      ))}
      {remainingCount > 0 || expanded ? (
        <div className="flex flex-wrap gap-2">
          {remainingCount > 0 ? (
            <button
              aria-expanded={expanded}
              className={buttonStyles({ variant: 'ghost', size: 'sm' })}
              type="button"
              onClick={() => setVisibleLimit((current) => current + moreLimit)}
            >
              Show {nextBatchCount} more
            </button>
          ) : null}
          {expanded ? (
            <button
              aria-expanded={expanded}
              className={buttonStyles({ variant: 'ghost', size: 'sm' })}
              type="button"
              onClick={() => setVisibleLimit(topLimit)}
            >
              Show top {topLimit}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
