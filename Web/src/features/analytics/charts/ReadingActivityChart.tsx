import { useState } from 'react'
import type { BookAnalyticsDto } from '@/api/types'
import { Button } from '@/components/ui/Button'
import { ActivityCalendar } from './ActivityCalendar'
import { focusedValueDomain, formatCount } from './chartUtils'
import { compactActivityPoints, readingActivityChartPoints } from './readingActivityData'
import { SplitTrendChart } from './SplitTrendChart'
import { chaptersByWeekday } from '../statsSummary'

type ReadingActivityChartProps = {
  data: BookAnalyticsDto | undefined
}

const recentLimit = 5

export function ReadingActivityChart({ data }: ReadingActivityChartProps) {
  const [showAll, setShowAll] = useState(false)
  const points = data?.activity.points ?? []
  const baselineChapters = data?.activity.baselineChapters ?? 0
  const bucket = data?.scope.bucket ?? 'day'
  const chartPoints = readingActivityChartPoints(points, bucket, baselineChapters)
  const cumulativeDomain = focusedValueDomain(chartPoints.map((point) => point.cumulativeChapters))
  const newestDisplayPoints = [...compactActivityPoints(points, bucket, baselineChapters)]
    .reverse()
    .filter((point) => point.progressEvents > 0)
  const shownPoints = showAll ? newestDisplayPoints : newestDisplayPoints.slice(0, recentLimit)

  if (!points.length) {
    return (
      <div className="grid min-h-56 place-items-center text-sm text-ink-2">
        No reading activity in this time range.
      </div>
    )
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,22rem)]">
      {bucket === 'day' ? (
        <div className="flex min-w-0 flex-wrap items-start gap-x-10 gap-y-6">
          <ActivityCalendar points={points} />
          <WeekdayBars points={points} />
        </div>
      ) : (
        <SplitTrendChart
          ariaLabel="Reading activity trend"
          cumulative={{ key: 'cumulativeChapters', label: 'Chapters tracked in total' }}
          cumulativeDomain={cumulativeDomain}
          data={chartPoints}
          perBucket={{ key: 'dailyChapters', label: `Chapters per ${bucket}` }}
        />
      )}
      <div className="flex min-w-0 flex-col gap-1">
        <h3 className="m-0 mb-1 text-xs font-semibold tracking-[0.04em] text-ink-3 uppercase">
          Latest reading
        </h3>
        {newestDisplayPoints.length ? null : (
          <p className="m-0 text-sm text-ink-3">No progress logged in this range.</p>
        )}
        <ul className="m-0 flex list-none flex-col p-0 text-sm">
          {shownPoints.map((point) => (
            <li className="border-t border-line-soft py-2 first:border-t-0" key={point.label}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="font-semibold text-ink">{point.label}</span>
                <span className="text-ink-2 tabular-nums">
                  {formatCount(point.dailyChapters)} ch
                </span>
              </div>
              <div className="text-[13px] text-ink-3">
                {plural(point.progressEvents, 'event')} · {plural(point.booksTouched, 'book')}{' '}
                touched · {formatCount(point.cumulativeChapters)} in total
              </div>
            </li>
          ))}
        </ul>
        {newestDisplayPoints.length > recentLimit ? (
          <Button
            aria-expanded={showAll}
            className="self-start"
            size="sm"
            variant="ghost"
            onClick={() => setShowAll((current) => !current)}
          >
            {showAll ? 'Show fewer' : `Show all ${String(newestDisplayPoints.length)}`}
          </Button>
        ) : null}
      </div>
    </div>
  )
}

function plural(count: number, noun: string) {
  return `${formatCount(count)} ${count === 1 ? noun : `${noun}s`}`
}

/** Chapters per weekday: when in the week the reading happens. */
function WeekdayBars({ points }: { points: Parameters<typeof chaptersByWeekday>[0] }) {
  const totals = chaptersByWeekday(points)
  const max = Math.max(...totals.map((day) => day.chapters))
  const top = totals.reduce((best, day) => (day.chapters > best.chapters ? day : best))

  return (
    <figure className="m-0 flex w-full max-w-72 min-w-56 flex-col gap-2">
      <figcaption className="text-xs font-semibold tracking-[0.04em] text-ink-3 uppercase">
        By weekday
      </figcaption>
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-[13px]">
        {totals.map((day) => (
          <li
            className="grid grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-2"
            key={day.name}
          >
            <span className="text-ink-3">{day.short}</span>
            <span className="h-2 overflow-hidden rounded-full bg-line-soft">
              <span
                className="block h-full rounded-full bg-chart-1"
                style={{ width: max ? `${String((day.chapters / max) * 100)}%` : 0 }}
              />
            </span>
            <span className="text-ink-2 tabular-nums">{formatCount(day.chapters)}</span>
          </li>
        ))}
      </ul>
      {max > 0 ? <p className="m-0 text-[13px] text-ink-2">Most reading on {top.name}s.</p> : null}
    </figure>
  )
}
