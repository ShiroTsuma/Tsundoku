import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { BookAnalyticsDto } from '@/api/types'
import { formatChapterCount } from '@/features/books/bookFormatters'
import {
  analyticsTooltipProps,
  seriesColor,
  fieldQuery,
  formatCount,
  getActiveChartLabel,
  useBooksDrilldown,
} from './chartUtils'
import { DrilldownLink } from './DrilldownLink'

type ChapterVolumeChartProps = {
  data: BookAnalyticsDto | undefined
}

export function ChapterVolumeChart({ data }: ChapterVolumeChartProps) {
  const items = data?.progress.typeVolumes ?? []
  const openBooks = useBooksDrilldown()

  if (!items.length) {
    return (
      <div className="grid min-h-56 place-items-center text-sm text-ink-3">
        No chapter volume data for this analytics scope.
      </div>
    )
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div>
        <div className="mb-2 text-sm font-semibold text-ink">Book count by type</div>
        <div className="analytics-drilldown-chart h-56 min-w-0">
          <ResponsiveContainer>
            <BarChart
              data={items}
              onClick={(event) => {
                const type = getActiveChartLabel(event)
                if (typeof type === 'string') {
                  openBooks(fieldQuery('type', type))
                }
              }}
            >
              <XAxis dataKey="type" tickLine={false} />
              <YAxis allowDecimals={false} tickLine={false} />
              <Tooltip
                {...analyticsTooltipProps}
                formatter={(value) => [`${formatCount(Number(value))} books`, 'Books']}
              />
              <Bar
                dataKey="bookCount"
                fill={seriesColor}
                maxBarSize={48}
                name="Books"
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
          <div className="sr-only">
            {items.map((item) => (
              <DrilldownLink key={item.type} query={fieldQuery('type', item.type)}>
                Open {item.type} books by count
              </DrilldownLink>
            ))}
          </div>
        </div>
      </div>
      <div>
        <div className="mb-2 text-sm font-semibold text-ink">Current chapters by type</div>
        <div className="analytics-drilldown-chart h-56 min-w-0">
          <ResponsiveContainer>
            <BarChart
              data={items}
              onClick={(event) => {
                const type = getActiveChartLabel(event)
                if (typeof type === 'string') {
                  openBooks(fieldQuery('type', type))
                }
              }}
            >
              <XAxis dataKey="type" tickLine={false} />
              <YAxis tickLine={false} />
              <Tooltip
                {...analyticsTooltipProps}
                formatter={(value) => [
                  `${formatChapterCount(Number(value))} chapters`,
                  'Current chapters',
                ]}
              />
              <Bar
                dataKey="currentChapters"
                fill={seriesColor}
                maxBarSize={48}
                name="Current chapters"
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
          <div className="sr-only">
            {items.map((item) => (
              <DrilldownLink key={item.type} query={fieldQuery('type', item.type)}>
                Open {item.type} books by current chapters
              </DrilldownLink>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
