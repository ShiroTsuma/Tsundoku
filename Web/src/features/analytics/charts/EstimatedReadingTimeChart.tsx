import { Check, Pencil } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { BookAnalyticsDto } from '@/api/types'
import { buttonVariants, inputClass } from '@/components/app/designTokens'
import { formatChapterCount } from '@/features/books/bookFormatters'
import { formatCount } from './chartUtils'
import {
  formatDays,
  formatHours,
  formatMonths,
  formatYears,
  getEstimatedReadingRows,
  getMinutesByType,
  normalizeMinutes,
} from './estimatedReadingTimeData'

type EstimatedReadingTimeChartProps = {
  data: BookAnalyticsDto | undefined
  settings: Record<string, number>
  isSaving?: boolean
  onSave: (settings: Record<string, number>) => Promise<unknown>
}

export function EstimatedReadingTimeChart({
  data,
  settings,
  isSaving = false,
  onSave,
}: EstimatedReadingTimeChartProps) {
  const items = useMemo(() => data?.progress.typeVolumes ?? [], [data])
  const minutesPerType = useMemo(() => getMinutesByType(items, settings), [items, settings])
  const [draftMinutesPerType, setDraftMinutesPerType] = useState<Record<string, number>>({})
  const [isEditing, setIsEditing] = useState(false)
  const estimates = useMemo(
    () => getEstimatedReadingRows(items, isEditing ? draftMinutesPerType : minutesPerType),
    [draftMinutesPerType, isEditing, items, minutesPerType],
  )
  const totalHours = estimates.reduce((sum, item) => sum + item.hours, 0)

  async function toggleEditing() {
    if (isEditing) {
      await onSave(draftMinutesPerType)
      setIsEditing(false)
      return
    }

    setDraftMinutesPerType(minutesPerType)
    setIsEditing(true)
  }

  if (!items.length) {
    return (
      <div className="grid min-h-56 place-items-center text-sm text-ink-3">
        No chapter data to estimate reading time.
      </div>
    )
  }

  return (
    <div className="grid gap-4">
      <div className="rounded-field border border-line bg-raised p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-ink">Estimated total</div>
            <div className="mt-1 text-3xl font-semibold text-ink">{formatHours(totalHours)}</div>
          </div>
          <button
            aria-pressed={isEditing}
            className={buttonVariants.secondary}
            type="button"
            disabled={isSaving}
            onClick={() => void toggleEditing()}
          >
            {isEditing ? <Check className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
            {isEditing ? 'Done' : 'Edit estimates'}
          </button>
        </div>
        <div className="mt-2 text-sm text-ink-3">
          {formatDays(totalHours)} · {formatMonths(totalHours)} · {formatYears(totalHours)} based on
          known current chapters.
        </div>
      </div>
      <div className="grid gap-2">
        {estimates.map((item) => (
          <div className="rounded-field border border-line-soft grid gap-2 p-3" key={item.type}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="font-semibold text-ink">{item.type}</span>
              <span className="text-sm text-ink-3">
                {formatChapterCount(item.currentChapters)} chapters · {formatHours(item.hours)}
              </span>
            </div>
            {isEditing ? (
              <div className="flex flex-wrap items-center gap-3">
                <input
                  aria-label={`${item.type} minutes per chapter`}
                  className={`${inputClass} w-28`}
                  min="0"
                  step="1"
                  type="number"
                  value={item.minutesPerChapter}
                  onChange={(event) => {
                    const nextValue = normalizeMinutes(Number(event.target.value))
                    setDraftMinutesPerType((current) => ({ ...current, [item.type]: nextValue }))
                  }}
                />
                <span className="text-sm text-ink-2">minutes per chapter</span>
              </div>
            ) : (
              <div className="text-sm text-ink-2">
                {formatCount(item.minutesPerChapter)} minutes per chapter
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
