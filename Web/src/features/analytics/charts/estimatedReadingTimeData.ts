import type { BookAnalyticsDto } from '@/api/types'

export function getMinutesByType(
  items: NonNullable<BookAnalyticsDto['progress']>['typeVolumes'],
  settings: Record<string, number>,
) {
  return Object.fromEntries(
    items.map((item) => [item.type, normalizeMinutes(settings[item.type] ?? 5)]),
  )
}

export function getEstimatedReadingRows(
  items: NonNullable<BookAnalyticsDto['progress']>['typeVolumes'],
  settings: Record<string, number>,
) {
  return items.map((item) => {
    const minutesPerChapter = normalizeMinutes(settings[item.type] ?? 5)
    return {
      type: item.type,
      currentChapters: item.currentChapters,
      minutesPerChapter,
      hours: (item.currentChapters * minutesPerChapter) / 60,
    }
  })
}

export function normalizeMinutes(value: number) {
  return Number.isFinite(value) ? Math.max(0, value) : 0
}

export function formatHours(value: number) {
  return `${value.toLocaleString('en-US', { maximumFractionDigits: 1, minimumFractionDigits: 1 })} h`
}

export function formatDays(value: number) {
  return `${(value / 24).toLocaleString('en-US', { maximumFractionDigits: 1, minimumFractionDigits: 1 })} days`
}

export function formatMonths(value: number) {
  return `${(value / (24 * 30)).toLocaleString('en-US', { maximumFractionDigits: 1, minimumFractionDigits: 1 })} months`
}

export function formatYears(value: number) {
  return `${(value / (24 * 365)).toLocaleString('en-US', { maximumFractionDigits: 1, minimumFractionDigits: 1 })} years`
}
