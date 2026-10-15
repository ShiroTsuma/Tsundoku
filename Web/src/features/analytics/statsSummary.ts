import { addDays, differenceInCalendarDays, format, parseISO, startOfWeek } from 'date-fns'
import type { BookAnalyticsActivityPointDto, BookAnalyticsDto } from '@/api/types'

const bucketNouns: Record<string, [string, string]> = {
  day: ['day', 'days'],
  week: ['week', 'weeks'],
  month: ['month', 'months'],
}

export function bucketNoun(bucket: string, count: number) {
  const [one, many] = bucketNouns[bucket] ?? ['period', 'periods']
  return count === 1 ? one : many
}

/** Headline numbers for the selected range. */
export function getRangeSummary(data: BookAnalyticsDto | undefined) {
  const points = data?.activity.points ?? []
  const bucket = data?.scope.bucket ?? 'day'
  const active = points.filter((point) => point.chaptersAdvanced > 0 || point.progressEvents > 0)
  const best = points.reduce<BookAnalyticsActivityPointDto | undefined>(
    (current, point) =>
      point.chaptersAdvanced > (current?.chaptersAdvanced ?? 0) ? point : current,
    undefined,
  )

  return {
    bucket,
    chaptersRead: sum(points.map((point) => point.chaptersAdvanced)),
    progressUpdates: sum(points.map((point) => point.progressEvents)),
    booksAdded: sum((data?.libraryGrowth.points ?? []).map((point) => point.booksAdded)),
    activeBuckets: active.length,
    totalBuckets: points.length,
    best,
    longestStreak: bucket === 'day' ? longestStreak(points) : null,
  }
}

/** Longest run of consecutive days with any progress. */
export function longestStreak(points: readonly BookAnalyticsActivityPointDto[]) {
  let longest = 0
  let current = 0
  for (const point of points) {
    current = point.chaptersAdvanced > 0 || point.progressEvents > 0 ? current + 1 : 0
    longest = Math.max(longest, current)
  }
  return longest
}

export type CalendarCell = {
  date: string
  chapters: number
  events: number
  books: number
  /** 0 = no reading, 1–4 = quartile of the days with reading. */
  level: 0 | 1 | 2 | 3 | 4
}

/**
 * Lays daily points out as weeks (columns, Monday first) of seven days (rows).
 * Days outside the range are null so the grid keeps its shape.
 */
export function buildCalendar(points: readonly BookAnalyticsActivityPointDto[]) {
  if (!points.length) return { weeks: [] as (CalendarCell | null)[][], months: [] }
  const byDate = new Map(points.map((point) => [point.date, point]))
  const values = points
    .map((point) => point.chaptersAdvanced)
    .filter((value) => value > 0)
    .sort((a, b) => a - b)
  const quartile = (q: number) =>
    values[Math.min(values.length - 1, Math.floor(q * (values.length - 1)))] ?? 0
  const thresholds = [quartile(0.25), quartile(0.5), quartile(0.75)]
  const levelOf = (chapters: number, events: number): CalendarCell['level'] => {
    if (chapters <= 0) return events > 0 ? 1 : 0
    if (chapters <= (thresholds[0] ?? 0)) return 1
    if (chapters <= (thresholds[1] ?? 0)) return 2
    if (chapters <= (thresholds[2] ?? 0)) return 3
    return 4
  }

  const first = parseISO(points[0]?.date ?? '')
  const last = parseISO(points.at(-1)?.date ?? '')
  const weeks: (CalendarCell | null)[][] = []
  const months: { label: string; week: number }[] = []
  for (let day = startOfWeek(first, { weekStartsOn: 1 }); day <= last; day = addDays(day, 7)) {
    const week: (CalendarCell | null)[] = []
    for (let offset = 0; offset < 7; offset++) {
      const date = format(addDays(day, offset), 'yyyy-MM-dd')
      const point = byDate.get(date)
      week.push(
        point
          ? {
              date,
              chapters: point.chaptersAdvanced,
              events: point.progressEvents,
              books: point.booksTouched,
              level: levelOf(point.chaptersAdvanced, point.progressEvents),
            }
          : null,
      )
    }
    const firstInRange = week.find((cell) => cell !== null)
    const label = firstInRange ? format(parseISO(firstInRange.date), 'MMM') : ''
    if (label && months.at(-1)?.label !== label) months.push({ label, week: weeks.length })
    weeks.push(week)
  }
  return { weeks, months }
}

function sum(values: readonly number[]) {
  return values.reduce((total, value) => total + value, 0)
}

const weekdayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

/** Chapters read per weekday (Monday first) across daily points. */
export function chaptersByWeekday(points: readonly BookAnalyticsActivityPointDto[]) {
  const totals = weekdayNames.map((name) => ({ name, short: name.slice(0, 3), chapters: 0 }))
  for (const point of points) {
    const weekday = (parseISO(point.date).getDay() + 6) % 7
    const entry = totals[weekday]
    if (entry) entry.chapters += point.chaptersAdvanced
  }
  return totals
}

/**
 * How long the chapters left in books you are reading would take at the pace of the range.
 * Pace counts every calendar day of the range, including days off.
 */
export function getFinishForecast(
  data: BookAnalyticsDto | undefined,
  minutesPerType: Record<string, number>,
) {
  const types = data?.progress.typeVolumes ?? []
  const rangeDays = data
    ? Math.max(1, differenceInCalendarDays(parseISO(data.scope.to), parseISO(data.scope.from)))
    : 1
  const chaptersRead = sum((data?.activity.points ?? []).map((point) => point.chaptersAdvanced))
  const remainingChapters = sum(types.map((type) => type.remainingChapters ?? 0))
  const pace = chaptersRead / rangeDays
  const days = pace > 0 ? Math.ceil(remainingChapters / pace) : null

  return {
    pace,
    rangeDays,
    remainingChapters,
    readingBooks: sum(types.map((type) => type.readingBooks ?? 0)),
    booksWithTotal: sum(types.map((type) => type.readingBooksWithKnownTotal ?? 0)),
    days,
    finishDate: days === null ? null : addDays(new Date(), days),
    hoursLeft: sum(
      types.map((type) => ((type.remainingChapters ?? 0) * (minutesPerType[type.type] ?? 5)) / 60),
    ),
  }
}
