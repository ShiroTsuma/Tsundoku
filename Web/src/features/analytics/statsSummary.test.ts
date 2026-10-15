import { describe, expect, it } from 'vitest'
import type { BookAnalyticsActivityPointDto, BookAnalyticsDto } from '@/api/types'
import { buildCalendar, chaptersByWeekday, getFinishForecast, longestStreak } from './statsSummary'

function day(date: string, chaptersAdvanced: number, progressEvents = chaptersAdvanced ? 1 : 0) {
  return {
    date,
    chaptersAdvanced,
    progressEvents,
    booksTouched: progressEvents,
  } satisfies BookAnalyticsActivityPointDto
}

describe('longestStreak', () => {
  it('counts the longest run of days with progress', () => {
    expect(
      longestStreak([
        day('2026-01-01', 3),
        day('2026-01-02', 0),
        day('2026-01-03', 1),
        day('2026-01-04', 2),
        day('2026-01-05', 0, 1),
      ]),
    ).toBe(3)
    expect(longestStreak([])).toBe(0)
  })
})

describe('buildCalendar', () => {
  it('lays days out in Monday-first weeks with quartile levels', () => {
    // 2026-01-01 is a Thursday.
    const points = [
      day('2026-01-01', 1),
      day('2026-01-02', 0),
      day('2026-01-03', 4),
      day('2026-01-04', 10),
      day('2026-01-05', 20),
    ]
    const { weeks, months } = buildCalendar(points)

    expect(weeks).toHaveLength(2)
    expect(weeks[0]?.slice(0, 3)).toEqual([null, null, null])
    expect(weeks[0]?.[3]).toMatchObject({ date: '2026-01-01', level: 1 })
    expect(weeks[0]?.[4]).toMatchObject({ date: '2026-01-02', level: 0 })
    expect(weeks[0]?.[6]).toMatchObject({ date: '2026-01-04', level: 3 })
    expect(weeks[1]?.[0]).toMatchObject({ date: '2026-01-05', level: 4 })
    expect(months).toEqual([{ label: 'Jan', week: 0 }])
  })
})

describe('chaptersByWeekday', () => {
  it('adds chapters per weekday, Monday first', () => {
    // 2026-01-05 is a Monday, 2026-01-10 a Saturday.
    const totals = chaptersByWeekday([
      day('2026-01-05', 3),
      day('2026-01-10', 5),
      day('2026-01-17', 7),
    ])
    expect(totals[0]).toMatchObject({ name: 'Monday', chapters: 3 })
    expect(totals[5]).toMatchObject({ name: 'Saturday', chapters: 12 })
  })
})

describe('getFinishForecast', () => {
  it('applies the range pace to the chapters left in Reading books', () => {
    const forecast = getFinishForecast(
      {
        scope: { from: '2026-01-01', to: '2026-01-11', bucket: 'day' },
        activity: { baselineChapters: 0, points: [day('2026-01-02', 30), day('2026-01-05', 20)] },
        progress: {
          typeVolumes: [
            {
              type: 'Novel',
              bookCount: 3,
              currentChapters: 90,
              readingBooks: 3,
              readingBooksWithKnownTotal: 2,
              remainingChapters: 100,
            },
          ],
        },
      } as unknown as BookAnalyticsDto,
      { Novel: 6 },
    )

    // 50 chapters over 10 days = 5 a day; 100 left = 20 days; 100 × 6 min = 10 h.
    expect(forecast.pace).toBe(5)
    expect(forecast.days).toBe(20)
    expect(forecast.hoursLeft).toBe(10)
    expect(forecast.readingBooks).toBe(3)
    expect(forecast.booksWithTotal).toBe(2)
  })

  it('gives no finish date without reading in the range', () => {
    const forecast = getFinishForecast(
      {
        scope: { from: '2026-01-01', to: '2026-01-11', bucket: 'day' },
        activity: { baselineChapters: 0, points: [] },
        progress: { typeVolumes: [] },
      } as unknown as BookAnalyticsDto,
      {},
    )
    expect(forecast.days).toBeNull()
    expect(forecast.finishDate).toBeNull()
  })
})
