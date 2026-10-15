import { Check, Pencil } from 'lucide-react'
import { useState } from 'react'
import type { BookAnalyticsDto } from '@/api/types'
import { Button } from '@/components/ui/Button'
import { formatChapterCount } from '@/features/books/bookFormatters'
import { DrilldownLink } from './DrilldownLink'
import { fieldQuery, formatCount } from './chartUtils'
import { formatHours, getMinutesByType, normalizeMinutes } from './estimatedReadingTimeData'

/**
 * Books, chapters read and reading time per content type, with the minutes-per-chapter
 * estimate editable in place. Replaces the one-bar chapter volume charts.
 */
export function ByTypeTable({
  data,
  settings,
  isSaving = false,
  onSave,
}: {
  data: BookAnalyticsDto | undefined
  settings: Record<string, number>
  isSaving?: boolean
  onSave: (settings: Record<string, number>) => Promise<unknown>
}) {
  const types = data?.progress.typeVolumes ?? []
  const savedMinutes = getMinutesByType(types, settings)
  const [draft, setDraft] = useState<Record<string, number> | null>(null)
  const minutes = draft ?? savedMinutes
  const maxChapters = Math.max(1, ...types.map((type) => type.currentChapters))
  const rows = types.map((type) => {
    const perChapter = minutes[type.type] ?? 5
    return {
      ...type,
      perChapter,
      hoursRead: (type.currentChapters * perChapter) / 60,
      hoursLeft: ((type.remainingChapters ?? 0) * perChapter) / 60,
    }
  })
  const total = rows.reduce(
    (sum, row) => ({
      books: sum.books + row.bookCount,
      chapters: sum.chapters + row.currentChapters,
      hoursRead: sum.hoursRead + row.hoursRead,
      left: sum.left + (row.remainingChapters ?? 0),
      hoursLeft: sum.hoursLeft + row.hoursLeft,
    }),
    { books: 0, chapters: 0, hoursRead: 0, left: 0, hoursLeft: 0 },
  )

  if (!types.length) {
    return (
      <div className="grid min-h-40 place-items-center text-sm text-ink-3">
        No chapter data for this analytics scope.
      </div>
    )
  }

  async function toggleEditing() {
    if (draft) {
      await onSave(draft)
      setDraft(null)
      return
    }
    setDraft(savedMinutes)
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[44rem] border-collapse text-left text-sm tabular-nums">
          <caption className="sr-only">Books, chapters and reading time per type</caption>
          <thead className="text-xs font-semibold tracking-[0.04em] text-ink-3 uppercase">
            <tr className="border-b border-line">
              <th className="py-2 pr-3" scope="col">
                Type
              </th>
              <th className="px-3 py-2 text-right" scope="col">
                Books
              </th>
              <th className="w-[30%] px-3 py-2" scope="col">
                Chapters read
              </th>
              <th className="px-3 py-2 text-right" scope="col">
                Avg · median
              </th>
              <th className="px-3 py-2 text-right" scope="col">
                Min / ch
              </th>
              <th className="px-3 py-2 text-right" scope="col">
                Time read
              </th>
              <th className="py-2 pl-3 text-right" scope="col">
                Left (Reading)
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr className="border-b border-line-soft" key={row.type}>
                <th className="py-2.5 pr-3 font-semibold" scope="row">
                  <DrilldownLink className="min-h-0 px-0" query={fieldQuery('type', row.type)}>
                    {row.type}
                  </DrilldownLink>
                </th>
                <td className="px-3 py-2.5 text-right">{formatCount(row.bookCount)}</td>
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-line-soft">
                      <span
                        className="block h-full rounded-full bg-chart-1"
                        style={{ width: `${String((row.currentChapters / maxChapters) * 100)}%` }}
                      />
                    </span>
                    <span className="w-16 text-right">
                      {formatChapterCount(row.currentChapters)}
                    </span>
                  </div>
                </td>
                <td className="px-3 py-2.5 text-right text-ink-2">
                  {formatOptional(row.averageCurrentChapter)} ·{' '}
                  {formatOptional(row.medianCurrentChapter)}
                </td>
                <td className="px-3 py-2.5 text-right">
                  {draft ? (
                    <input
                      aria-label={`${row.type} minutes per chapter`}
                      className="h-8 w-16 rounded-control border border-line-strong bg-ground px-2 text-right text-sm outline-none focus:border-ink"
                      min="0"
                      step="1"
                      type="number"
                      value={row.perChapter}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          [row.type]: normalizeMinutes(Number(event.target.value)),
                        }))
                      }
                    />
                  ) : (
                    formatCount(row.perChapter)
                  )}
                </td>
                <td className="px-3 py-2.5 text-right">{formatHours(row.hoursRead)}</td>
                <td className="py-2.5 pl-3 text-right text-ink-2">
                  {row.remainingChapters
                    ? `${formatChapterCount(row.remainingChapters)} ch · ${formatHours(row.hoursLeft)}`
                    : '—'}
                </td>
              </tr>
            ))}
          </tbody>
          {rows.length > 1 ? (
            <tfoot className="font-semibold">
              <tr>
                <th className="py-2.5 pr-3" scope="row">
                  Total
                </th>
                <td className="px-3 py-2.5 text-right">{formatCount(total.books)}</td>
                <td className="px-3 py-2.5 text-right">{formatChapterCount(total.chapters)}</td>
                <td />
                <td />
                <td className="px-3 py-2.5 text-right">{formatHours(total.hoursRead)}</td>
                <td className="py-2.5 pl-3 text-right">
                  {total.left
                    ? `${formatChapterCount(total.left)} ch · ${formatHours(total.hoursLeft)}`
                    : '—'}
                </td>
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
      <Button
        aria-pressed={draft !== null}
        className="self-start"
        disabled={isSaving}
        size="sm"
        onClick={() => void toggleEditing()}
      >
        {draft ? (
          <Check aria-hidden="true" className="size-4" />
        ) : (
          <Pencil aria-hidden="true" className="size-4" />
        )}
        {draft ? 'Save estimates' : 'Edit minutes per chapter'}
      </Button>
    </div>
  )
}

function formatOptional(value: number | null | undefined) {
  return value == null ? '—' : formatChapterCount(Math.round(value * 10) / 10)
}
