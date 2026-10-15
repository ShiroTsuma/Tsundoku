import { format } from 'date-fns'
import type { BookAnalyticsDto } from '@/api/types'
import { formatChapterCount } from '@/features/books/bookFormatters'
import { getFinishForecast } from '../statsSummary'
import { DrilldownLink } from './DrilldownLink'
import { formatCount } from './chartUtils'
import { formatHours } from './estimatedReadingTimeData'

/** "At this pace, when am I done?" for the books with status Reading. */
export function PaceForecast({
  data,
  minutesPerType,
}: {
  data: BookAnalyticsDto | undefined
  minutesPerType: Record<string, number>
}) {
  const forecast = getFinishForecast(data, minutesPerType)
  const withoutTotal = forecast.readingBooks - forecast.booksWithTotal

  if (!forecast.readingBooks) {
    return (
      <div className="grid min-h-40 place-items-center text-center text-sm text-ink-3">
        No books with status Reading match the query.
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-field border border-line-soft bg-line-soft">
      <Stat
        hint={`over the ${formatCount(forecast.rangeDays)} days of the range`}
        label="Pace"
        value={`${forecast.pace.toLocaleString('en-US', { maximumFractionDigits: 1 })} ch/day`}
      />
      <Stat
        hint={
          <>
            in {formatCount(forecast.booksWithTotal)} of {formatCount(forecast.readingBooks)} books
            you are reading
            {withoutTotal > 0 ? (
              <>
                {' · '}
                <DrilldownLink query="status:Reading total:none">
                  {formatCount(withoutTotal)} without a total
                </DrilldownLink>
              </>
            ) : null}
          </>
        }
        label="Chapters left"
        value={formatChapterCount(forecast.remainingChapters)}
      />
      <Stat
        hint={
          forecast.finishDate
            ? `around ${format(forecast.finishDate, 'MMM d, yyyy')}`
            : 'No reading in the range to measure a pace'
        }
        label="Done in"
        value={forecast.days === null ? '—' : `≈ ${formatCount(forecast.days)} days`}
      />
      <Stat
        hint="from your minutes per chapter"
        label="Reading time left"
        value={`≈ ${formatHours(forecast.hoursLeft)}`}
      />
    </div>
  )
}

function Stat({ hint, label, value }: { hint: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 bg-surface p-4">
      <div className="text-xs font-semibold tracking-[0.06em] text-ink-3 uppercase">{label}</div>
      <div className="text-2xl leading-tight font-semibold">{value}</div>
      <div className="text-[13px] text-ink-3">{hint}</div>
    </div>
  )
}
