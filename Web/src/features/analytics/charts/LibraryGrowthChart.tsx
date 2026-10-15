import type { BookAnalyticsDto, BookAnalyticsLibraryGrowthPointDto } from '@/api/types'
import { fieldQuery, focusedValueDomain, formatCount } from './chartUtils'
import { SplitTrendChart } from './SplitTrendChart'
import { DrilldownLink } from './DrilldownLink'
import { compactGrowthPoints, libraryGrowthChartPoints } from './libraryGrowthData'

type LibraryGrowthChartProps = {
  data: BookAnalyticsDto | undefined
}

export function LibraryGrowthChart({ data }: LibraryGrowthChartProps) {
  const points = data?.libraryGrowth.points ?? []
  const openingCount = data?.libraryGrowth.openingCount ?? 0
  const bucket = data?.scope.bucket ?? 'day'
  const chartPoints = libraryGrowthChartPoints(points, bucket)
  const cumulativeDomain = focusedValueDomain(chartPoints.map((point) => point.cumulativeBooks))
  const displayPoints = compactGrowthPoints(points, bucket)
  const newestDisplayPoints = [...displayPoints].reverse()

  if (!points.length) {
    return (
      <div className="grid min-h-56 place-items-center text-center text-sm text-ink-2">
        <div>
          <div>No library growth points in this time range.</div>
          <div className="mt-1">Opening count: {formatCount(openingCount)} books.</div>
        </div>
      </div>
    )
  }

  return (
    <div className="grid gap-4">
      <p className="text-sm text-ink-2">
        Opening count: {formatCount(openingCount)} books. Buckets with 0 additions stay in the
        series so import jumps remain visible.
      </p>
      <SplitTrendChart
        ariaLabel="Library growth trend"
        cumulative={{ key: 'cumulativeBooks', label: 'Books in the library' }}
        cumulativeDomain={cumulativeDomain}
        data={chartPoints}
        perBucket={{ key: 'booksAdded', label: 'Books added per bucket' }}
      />
      <div className="grid gap-2">
        {newestDisplayPoints.map((point) => (
          <div
            className="rounded-field border border-line-soft px-3 py-2 text-sm"
            key={point.label}
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="font-semibold text-ink">{point.label}</span>
              <span className="text-ink-2">
                +{formatCount(point.booksAdded)} added · {formatCount(point.cumulativeBooks)}{' '}
                cumulative
              </span>
            </div>
            <div className="mt-1 flex flex-wrap gap-2 text-ink-2">{typeSummary(point)}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function typeSummary(point: BookAnalyticsLibraryGrowthPointDto & { endExclusive?: string }) {
  if (!point.byType.length) {
    return <span>No additions by type.</span>
  }

  return point.byType.map((item) => (
    <DrilldownLink
      key={item.type}
      query={`${fieldQuery('type', item.type)} created:>=${point.date} created:<${point.endExclusive ?? point.date}`}
    >
      {item.type}: {formatCount(item.bookCount)}
    </DrilldownLink>
  ))
}
