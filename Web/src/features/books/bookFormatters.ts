export function formatAverageRating(value?: number | null) {
  return value == null ? '-' : value.toFixed(1)
}

export function formatBookCount(value?: number | null) {
  return value == null ? '-' : new Intl.NumberFormat('en-US').format(value)
}

export function formatChapterCount(value?: number | null) {
  if (value == null) {
    return '-'
  }

  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(value)
}

export function formatDate(value?: string | null) {
  if (!value) {
    return '-'
  }

  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value),
  )
}

export function formatShortDate(value: string) {
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(new Date(value))
}
