import { useMediaQuery } from '@/lib/useMediaQuery'
import {
  Bar,
  BarChart,
  Rectangle,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type BarShapeProps,
} from 'recharts'
import type { BookAnalyticsDto } from '@/api/types'
import {
  analyticsTooltipProps,
  seriesColor,
  formatCount,
  formatPercent,
  getActiveChartLabel,
  noneQuery,
  numberQuery,
  percent,
  useBooksDrilldown,
} from './chartUtils'
import { DrilldownLink } from './DrilldownLink'

type RatingDistributionChartProps = {
  data: BookAnalyticsDto | undefined
}

export function RatingDistributionChart({ data }: RatingDistributionChartProps) {
  const animate = !useMediaQuery('(prefers-reduced-motion: reduce)')
  const ratings = data?.ratings
  const counts = ratings?.counts ?? []
  const totalBooks = (ratings?.ratedBooks ?? 0) + (ratings?.unratedBooks ?? 0)
  const coverage = percent(ratings?.ratedBooks ?? 0, totalBooks)
  const openBooks = useBooksDrilldown()

  if (!ratings || totalBooks === 0) {
    return (
      <div className="grid min-h-56 place-items-center text-sm text-ink-3">
        No rating data for this analytics scope.
      </div>
    )
  }

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-[9rem_minmax(0,1fr)]">
        <div className="flex flex-col gap-2 rounded-field border border-line-soft p-4">
          <div className="text-xs font-semibold tracking-[0.06em] text-ink-3 uppercase">Rated</div>
          <div className="text-[26px] leading-none font-semibold">{formatPercent(coverage)}</div>
          <div
            aria-label={`${formatPercent(coverage)} of books rated`}
            aria-valuemax={100}
            aria-valuemin={0}
            aria-valuenow={Math.round(coverage)}
            className="ui-progress-track"
            role="progressbar"
          >
            <div className="ui-progress-fill" style={{ width: `${String(coverage)}%` }} />
          </div>
          <div className="text-sm text-ink-3">
            Avg {ratings.averageRating == null ? '-' : ratings.averageRating.toFixed(1)}
          </div>
          <DrilldownLink query={noneQuery('rating')}>
            Unrated: {formatCount(ratings.unratedBooks)}
          </DrilldownLink>
        </div>
        <div className="analytics-drilldown-chart h-64 min-w-0">
          <ResponsiveContainer>
            <BarChart
              data={counts}
              margin={{ left: 0, right: 8 }}
              onClick={(event) => {
                const rating = Number(getActiveChartLabel(event))
                if (Number.isFinite(rating)) {
                  openBooks(numberQuery('rating', rating))
                }
              }}
            >
              <XAxis dataKey="rating" tickLine={false} />
              <YAxis allowDecimals={false} tickLine={false} />
              <Tooltip
                {...analyticsTooltipProps}
                formatter={(value, _name, item) => [
                  `${formatCount(Number(value))} books`,
                  `Rating ${readRatingLabel(item.payload)}`,
                ]}
              />
              <Bar
                isAnimationActive={animate}
                dataKey="bookCount"
                maxBarSize={32}
                name="Books"
                radius={[4, 4, 0, 0]}
                shape={(props: BarShapeProps) => (
                  <Rectangle
                    {...props}
                    fill={
                      (counts[props.index]?.bookCount ?? 0) > 0 ? seriesColor : 'var(--color-line)'
                    }
                  />
                )}
              />
            </BarChart>
          </ResponsiveContainer>
          <div className="sr-only">
            {counts.map((item) => (
              <DrilldownLink key={item.rating} query={numberQuery('rating', item.rating)}>
                Open rating {item.rating} books
              </DrilldownLink>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function readRatingLabel(payload: unknown) {
  if (payload && typeof payload === 'object' && 'rating' in payload) {
    const rating = payload.rating
    if (typeof rating === 'number' || typeof rating === 'string') {
      return String(rating)
    }
  }
  return ''
}
