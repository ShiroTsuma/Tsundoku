import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { toast } from 'sonner'
import { api } from '@/api/client'
import type { BookDto } from '@/api/types'
import { HttpError } from '@/api/http'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { cn } from '@/lib/utils'

const chapterNumberPattern = /^\d+(?:\.\d+)?$/
const chapterLabelMaxLength = 100
const commentMaxLength = 1000
const numberFormat = new Intl.NumberFormat('en-US')

const fieldClass =
  'h-11 w-full rounded-control border border-line-strong bg-ground px-3 text-base text-ink outline-none focus:border-accent'

/** The fields the dialog needs; both the full book and a list item provide them. */
export type ProgressBook = Pick<
  BookDto,
  | 'id'
  | 'primaryTitle'
  | 'currentChapterNumber'
  | 'currentChapterLabel'
  | 'totalChapters'
  | 'status'
>

export function ProgressDialog({
  book,
  triggerLabel = 'Log progress',
  triggerVariant = 'primary',
  triggerSize = 'md',
}: {
  book: ProgressBook
  triggerLabel?: string
  triggerVariant?: 'primary' | 'secondary' | 'outline'
  triggerSize?: 'row' | 'sm' | 'md'
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button
        variant={triggerVariant}
        size={triggerSize}
        aria-label={`Log progress for ${book.primaryTitle}`}
        onClick={() => setOpen(true)}
      >
        {triggerLabel}
      </Button>
      {open ? <ProgressForm book={book} onClose={() => setOpen(false)} /> : null}
    </>
  )
}

function ProgressForm({ book, onClose }: { book: ProgressBook; onClose: () => void }) {
  const ids = { number: useId(), label: useId(), comment: useId(), error: useId() }
  const [currentChapterNumber, setCurrentChapterNumber] = useState(
    book.currentChapterNumber?.toString() ?? '',
  )
  const [currentChapterLabel, setCurrentChapterLabel] = useState(book.currentChapterLabel ?? '')
  const [comment, setComment] = useState('')
  const [completed, setCompleted] = useState(book.status.toLowerCase() === 'completed')
  const queryClient = useQueryClient()
  const totalChapters = typeof book.totalChapters === 'number' ? book.totalChapters : null
  const previous = typeof book.currentChapterNumber === 'number' ? book.currentChapterNumber : null
  const chapterNumberText = currentChapterNumber.trim()
  const chapterNumberInvalid =
    chapterNumberText.length > 0 && !chapterNumberPattern.test(chapterNumberText)
  const numericCurrent =
    chapterNumberText && !chapterNumberInvalid ? Number(chapterNumberText) : null
  const exceedsTotal =
    !completed &&
    numericCurrent != null &&
    totalChapters != null &&
    totalChapters > 0 &&
    numericCurrent > totalChapters
  const chapterNumberError = chapterNumberInvalid
    ? 'Chapter number must be a non-negative number without exponent notation.'
    : exceedsTotal
      ? 'Current chapter cannot be greater than total chapters.'
      : null
  const delta = numericCurrent != null && previous != null ? numericCurrent - previous : null

  const mutation = useMutation({
    mutationFn: () =>
      api.updateProgress(book.id, {
        currentChapterNumber: numericCurrent,
        currentChapterLabel: currentChapterLabel || null,
        comment: comment || null,
        completed,
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['book', book.id] }),
        queryClient.invalidateQueries({ queryKey: ['books'] }),
        queryClient.invalidateQueries({ queryKey: ['books-summary'] }),
        queryClient.invalidateQueries({ queryKey: ['book-analytics'] }),
        queryClient.invalidateQueries({ queryKey: ['crawler-monitor'] }),
      ])
      toast.success('Progress saved.')
      onClose()
    },
    onError: (error) => {
      toast.error(error instanceof HttpError ? error.apiError.detail : 'Failed to save progress.')
    },
  })

  return (
    <Dialog
      open
      onClose={onClose}
      title="Log progress"
      description={<span className="line-clamp-2">{book.primaryTitle}</span>}
      widthClassName="max-w-[520px]"
      dismissible={!mutation.isPending}
      footer={
        <>
          <span className="flex-1" />
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={mutation.isPending || Boolean(chapterNumberError)}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? 'Saving…' : 'Save progress'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 px-6 py-4">
        <div className="flex items-center gap-3 rounded-field border border-line bg-sunk px-3.5 py-3">
          <div className="min-w-0 flex-1">
            <div className="text-xs font-semibold tracking-wider text-ink-3 uppercase">
              Last logged
            </div>
            <div className="tabular-nums">
              <strong>Ch. {book.currentChapterLabel ?? previous ?? '—'}</strong>
              {previous != null ? (
                <span className="text-ink-2"> · {numberFormat.format(previous)} chapters read</span>
              ) : null}
              {totalChapters != null ? (
                <span className="text-ink-2"> of {numberFormat.format(totalChapters)}</span>
              ) : null}
            </div>
          </div>
          {delta != null && delta !== 0 ? (
            <span
              className={cn(
                'shrink-0 rounded-full px-2.5 py-1 font-semibold tabular-nums',
                delta > 0
                  ? 'bg-status-finished-soft text-status-finished-ink'
                  : 'bg-danger-soft text-danger-ink',
              )}
            >
              {delta > 0 ? '+' : ''}
              {numberFormat.format(delta)} ch
            </span>
          ) : null}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label htmlFor={ids.number} className="font-medium">
              Chapters read
            </label>
            <input
              id={ids.number}
              aria-invalid={chapterNumberError ? 'true' : undefined}
              aria-describedby={chapterNumberError ? ids.error : undefined}
              className={cn(
                fieldClass,
                'font-semibold tabular-nums',
                chapterNumberError && 'border-danger',
              )}
              inputMode="decimal"
              placeholder="Chapter number"
              value={currentChapterNumber}
              onChange={(event) => setCurrentChapterNumber(event.target.value)}
            />
            {chapterNumberError ? (
              <p id={ids.error} className="m-0 text-[13px] text-danger-ink">
                {chapterNumberError}
              </p>
            ) : (
              <p className="m-0 text-xs text-ink-3">
                Every finished chapter counts, so 32.1 and 32.2 are two.
              </p>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={ids.label} className="font-medium">
              Label in source
            </label>
            <input
              id={ids.label}
              className={fieldClass}
              maxLength={chapterLabelMaxLength}
              placeholder="Chapter label"
              value={currentChapterLabel}
              onChange={(event) => setCurrentChapterLabel(event.target.value)}
            />
            <p className="m-0 text-xs text-ink-3">For example v5c34, 32.2 or ex4.</p>
          </div>
        </div>

        <label className="flex cursor-pointer items-start gap-3 rounded-field border border-line bg-sunk px-3.5 py-3">
          <input
            type="checkbox"
            checked={completed}
            className="mt-1 size-4 accent-accent"
            onChange={(event) => {
              setCompleted(event.target.checked)
              if (
                event.target.checked &&
                totalChapters != null &&
                totalChapters > 0 &&
                currentChapterNumber === (book.currentChapterNumber?.toString() ?? '')
              ) {
                setCurrentChapterNumber(totalChapters.toString())
              }
            }}
          />
          <span>
            <span className="block font-medium">Completed</span>
            <span className="block text-[13px] text-ink-3">
              {completed
                ? numericCurrent != null
                  ? `Sets status to Completed and total chapters to ${numberFormat.format(numericCurrent)}.`
                  : 'Sets status to Completed. Enter the final chapter count above to update total chapters.'
                : 'Saving progress sets the status to Reading.'}
            </span>
          </span>
        </label>

        <div className="flex flex-col gap-1.5">
          <label htmlFor={ids.comment} className="font-medium">
            Note <span className="font-normal text-ink-3">· optional</span>
          </label>
          <textarea
            id={ids.comment}
            className={cn(fieldClass, 'h-auto min-h-20 resize-y py-2.5 text-sm')}
            maxLength={commentMaxLength}
            placeholder="Comment"
            value={comment}
            onChange={(event) => setComment(event.target.value)}
          />
        </div>
      </div>
    </Dialog>
  )
}
