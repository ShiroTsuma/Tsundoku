import { format, parseISO } from 'date-fns'
import type { BookAnalyticsActivityPointDto } from '@/api/types'
import { cn } from '@/lib/utils'
import { buildCalendar, type CalendarCell } from '../statsSummary'
import { formatCount } from './chartUtils'

const levelClasses: Record<CalendarCell['level'], string> = {
  0: 'bg-line-soft',
  1: 'bg-chart-cal-1',
  2: 'bg-chart-cal-2',
  3: 'bg-chart-cal-3',
  4: 'bg-chart-cal-4',
}
const weekdayLabels = ['Mon', '', 'Wed', '', 'Fri', '', '']

/** One square per day, darker to brighter blue with more chapters read. */
export function ActivityCalendar({ points }: { points: readonly BookAnalyticsActivityPointDto[] }) {
  const { weeks, months } = buildCalendar(points)
  const activeDays = points.filter((point) => point.progressEvents > 0).length

  return (
    <figure className="m-0 flex min-w-0 flex-col gap-3">
      <div className="overflow-x-auto pb-1">
        <div
          aria-label={`Reading calendar: progress on ${formatCount(activeDays)} of ${formatCount(points.length)} days. The data table lists every day.`}
          className="inline-grid gap-[3px] [--cell:12px] sm:[--cell:16px]"
          role="img"
          style={{
            gridTemplateColumns: `auto repeat(${String(weeks.length)}, var(--cell))`,
            gridTemplateRows: 'auto repeat(7, var(--cell))',
          }}
        >
          {months.map((month, index) => (
            <span
              className="row-start-1 pb-1 text-[11px] leading-none whitespace-nowrap text-ink-3"
              key={`${month.label}-${String(month.week)}`}
              style={{
                gridColumnStart: month.week + 2,
                gridColumnEnd: (months[index + 1]?.week ?? weeks.length) + 2,
              }}
            >
              {month.label}
            </span>
          ))}
          {weekdayLabels.map((label, day) => (
            <span
              className="col-start-1 pr-1.5 text-[10px] leading-[var(--cell)] text-ink-3"
              key={day}
              style={{ gridRowStart: day + 2 }}
            >
              {label}
            </span>
          ))}
          {weeks.flatMap((week, weekIndex) =>
            week.map((cell, day) =>
              cell ? (
                <span
                  className={cn('rounded-[3px]', levelClasses[cell.level])}
                  data-level={cell.level}
                  key={cell.date}
                  style={{ gridColumnStart: weekIndex + 2, gridRowStart: day + 2 }}
                  title={describeDay(cell)}
                />
              ) : null,
            ),
          )}
        </div>
      </div>
      <figcaption className="flex items-center gap-1.5 text-[11px] text-ink-3">
        Fewer chapters
        {([0, 1, 2, 3, 4] as const).map((level) => (
          <span
            aria-hidden="true"
            className={cn('size-3 rounded-[3px]', levelClasses[level])}
            key={level}
          />
        ))}
        More
      </figcaption>
    </figure>
  )
}

function describeDay(cell: CalendarCell) {
  const date = format(parseISO(cell.date), 'EEE, MMM d, yyyy')
  if (!cell.events) return `${date}: no reading`
  return `${date}: ${formatCount(cell.chapters)} chapters · ${formatCount(cell.books)} ${cell.books === 1 ? 'book' : 'books'}`
}
