import { SplitTrendChart } from './SplitTrendChart'
import type { BookAnalyticsDto } from '@/api/types'
import { focusedValueDomain, formatCount } from './chartUtils'
import { compactActivityPoints, readingActivityChartPoints } from './readingActivityData'

type ReadingActivityChartProps = {
  data: BookAnalyticsDto | undefined
}

export function ReadingActivityChart({ data }: ReadingActivityChartProps) {
  const points = data?.activity.points ?? []
  const baselineChapters = data?.activity.baselineChapters ?? 0
  const bucket = data?.scope.bucket ?? 'day'
  const chartPoints = readingActivityChartPoints(points, bucket, baselineChapters)
  const cumulativeDomain = focusedValueDomain(chartPoints.map((point) => point.cumulativeChapters))
  const displayPoints = compactActivityPoints(points, bucket, baselineChapters)
  const newestDisplayPoints = [...displayPoints].reverse()

  if (!points.length) {
    return (
      <div className="grid min-h-56 place-items-center text-sm text-ink-2">
        No reading activity in this time range.
      </div>
    )
  }

  return (
    <div className="grid gap-4">
      <SplitTrendChart
        ariaLabel="Reading activity trend"
        cumulative={{ key: 'cumulativeChapters', label: 'Chapters tracked in total' }}
        cumulativeDomain={cumulativeDomain}
        data={chartPoints}
        perBucket={{ key: 'dailyChapters', label: 'Chapters per bucket' }}
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
                {formatCount(point.progressEvents)} events · {formatCount(point.booksTouched)} books
                touched
              </span>
            </div>
            <div className="mt-1 text-ink-2">
              Daily: {formatCount(point.dailyChapters)} chapters. Cumulative:{' '}
              {formatCount(point.cumulativeChapters)} chapters.
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
