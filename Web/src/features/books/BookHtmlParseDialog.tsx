import { useMutation } from '@tanstack/react-query'
import { AlertTriangle, ArrowLeft, Braces, Check, FileCode2 } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { api } from '@/api/client'
import { HttpError } from '@/api/http'
import type { BookHtmlParseResult } from '@/api/types'
import { Dialog } from '@/components/ui/Dialog'
import { Pill } from '@/components/ui/ListParts'
import { useBodyScrollLock } from '@/components/app/useBodyScrollLock'
import type { BookFormValues } from './bookFormSchema'
import { buttonStyles } from '@/components/ui/buttonStyles'
import { fieldClass } from '@/components/ui/fieldStyles'

export type BookHtmlParseField =
  | 'primaryTitle'
  | 'authorName'
  | 'contentType'
  | 'alternativeTitles'
  | 'genres'
  | 'tags'
  | 'description'
  | 'canonicalUrl'
  | 'coverUrl'

type PreviewField = {
  key: BookHtmlParseField
  label: string
  value: string
  conflict: boolean
}

export function BookHtmlParseDialog({
  currentValues,
  hasDraftCover,
  open,
  onApply,
  onClose,
}: {
  currentValues: BookFormValues
  hasDraftCover: boolean
  open: boolean
  onApply: (result: BookHtmlParseResult, selected: ReadonlySet<BookHtmlParseField>) => void
  onClose: () => void
}) {
  const titleId = useId()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [html, setHtml] = useState('')
  const [result, setResult] = useState<BookHtmlParseResult | null>(null)
  const [selected, setSelected] = useState<Set<BookHtmlParseField>>(new Set())
  useBodyScrollLock(open)

  const parseMutation = useMutation({
    mutationFn: api.parseBookHtml,
    onSuccess: (parsed) => {
      setResult(parsed)
      setSelected(new Set(getAvailableFieldKeys(parsed)))
    },
  })

  const previewFields = useMemo(
    () => (result ? buildPreviewFields(result, currentValues, hasDraftCover) : []),
    [currentValues, hasDraftCover, result],
  )

  function closeAndReset() {
    parseMutation.reset()
    setHtml('')
    setResult(null)
    setSelected(new Set())
    onClose()
  }

  useEffect(() => {
    if (!open) return
    const frame = window.requestAnimationFrame(() => textareaRef.current?.focus())
    return () => window.cancelAnimationFrame(frame)
  }, [open])

  if (!open) return null

  const error =
    parseMutation.error instanceof HttpError
      ? parseMutation.error.apiError.detail
      : parseMutation.error instanceof Error
        ? parseMutation.error.message
        : null

  function toggleField(key: BookHtmlParseField) {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <Dialog
      open
      description="Paste the full HTML of a supported book page. For sites such as AniList, copy the loaded page HTML from your browser’s developer tools. Nothing changes until you review and apply it."
      footer={
        <>
          {result ? (
            <>
              <span className="flex-1" />
              <button
                className={buttonStyles({ size: 'sm' })}
                type="button"
                onClick={() => {
                  parseMutation.reset()
                  setResult(null)
                }}
              >
                <ArrowLeft className="h-4 w-4" /> Back to HTML
              </button>
              <button
                className={buttonStyles({ variant: 'primary', size: 'sm' })}
                disabled={selected.size === 0}
                type="button"
                onClick={() => {
                  onApply(result, selected)
                  closeAndReset()
                }}
              >
                <Check className="h-4 w-4" /> Apply selected
              </button>
            </>
          ) : (
            <>
              <div className="mr-auto flex items-center gap-2 text-[13px] text-ink-3">
                <Braces className="h-4 w-4" /> Parsed as text; scripts are never executed.
              </div>
              <button
                className={buttonStyles({ variant: 'primary', size: 'sm' })}
                disabled={!html.trim() || parseMutation.isPending}
                type="button"
                onClick={() => parseMutation.mutate(html)}
              >
                <FileCode2 className="h-4 w-4" />{' '}
                {parseMutation.isPending ? 'Parsing…' : 'Parse HTML'}
              </button>
            </>
          )}
        </>
      }
      scrollBody
      title="Parse page HTML"
      widthClassName="max-w-[880px]"
      onClose={closeAndReset}
    >
      {result ? (
        <div className="book-html-dialog__content">
          <div className="book-html-dialog__source-row">
            <div>
              <div className="text-sm font-semibold text-ink">Detected source</div>
              <div className="mt-1 text-xs text-ink-2">
                Select the metadata that should be applied to this draft.
              </div>
            </div>
            <Pill>{result.source}</Pill>
          </div>
          <div className="book-html-preview-grid">
            {previewFields.map((field) => (
              <label
                className={`book-html-preview ${selected.has(field.key) ? 'book-html-preview--selected' : ''}`}
                key={field.key}
              >
                <input
                  checked={selected.has(field.key)}
                  className="sr-only"
                  type="checkbox"
                  onChange={() => toggleField(field.key)}
                />
                <span className="book-html-preview__check" aria-hidden="true">
                  {selected.has(field.key) ? <Check className="h-3.5 w-3.5" /> : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="book-html-preview__heading">
                    <span>{field.label}</span>
                    {field.conflict ? (
                      <span className="book-html-preview__conflict">replace / merge</span>
                    ) : null}
                  </span>
                  <span className="book-html-preview__value">{field.value}</span>
                </span>
              </label>
            ))}
          </div>
          {result.warnings.length ? (
            <div className="book-html-warnings" role="status">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" />
              <div>
                <div className="text-sm font-semibold">
                  Review{' '}
                  {result.warnings.length === 1
                    ? 'one warning'
                    : `${result.warnings.length} warnings`}
                </div>
                <ul className="mt-1 grid gap-1 text-xs">
                  {result.warnings.map((warning, index) => (
                    <li key={`${warning}-${index}`}>{warning}</li>
                  ))}
                </ul>
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="book-html-dialog__content">
          <label className="grid gap-2" htmlFor={`${titleId}-input`}>
            <span className="text-sm font-semibold text-ink">Full page HTML</span>
            <textarea
              className={`${fieldClass} book-html-dialog__textarea`}
              id={`${titleId}-input`}
              placeholder="<!doctype html>…"
              ref={textareaRef}
              spellCheck={false}
              value={html}
              onChange={(event) => setHtml(event.target.value)}
            />
          </label>
          <div aria-live="polite">
            {error ? <div className="book-html-dialog__error">{error}</div> : null}
          </div>
        </div>
      )}
    </Dialog>
  )
}

function getAvailableFieldKeys(result: BookHtmlParseResult): BookHtmlParseField[] {
  const fields: BookHtmlParseField[] = []
  if (result.primaryTitle) fields.push('primaryTitle')
  if (result.authorName) fields.push('authorName')
  if (result.contentType?.id) fields.push('contentType')
  if (result.alternativeTitles.length) fields.push('alternativeTitles')
  if (result.genres.some((genre) => genre.id)) fields.push('genres')
  if (result.tags.length) fields.push('tags')
  if (result.description) fields.push('description')
  if (result.canonicalUrl) fields.push('canonicalUrl')
  if (result.coverUrl) fields.push('coverUrl')
  return fields
}

function buildPreviewFields(
  result: BookHtmlParseResult,
  values: BookFormValues,
  hasDraftCover: boolean,
): PreviewField[] {
  const fields: PreviewField[] = []
  if (result.primaryTitle)
    fields.push({
      key: 'primaryTitle',
      label: 'Primary title',
      value: result.primaryTitle,
      conflict: Boolean(values.primaryTitle.trim()),
    })
  if (result.authorName)
    fields.push({
      key: 'authorName',
      label: 'Author',
      value: result.authorName,
      conflict: Boolean(values.authorName?.trim()),
    })
  if (result.contentType?.id)
    fields.push({
      key: 'contentType',
      label: 'Content type',
      value: result.contentType.name,
      conflict: Boolean(values.contentTypeId),
    })
  if (result.alternativeTitles.length)
    fields.push({
      key: 'alternativeTitles',
      label: 'Alternative titles',
      value: result.alternativeTitles.join(' · '),
      conflict: values.alternativeTitles.some((title) => title.trim()),
    })
  const matchedGenres = result.genres.filter((genre) => genre.id)
  if (matchedGenres.length)
    fields.push({
      key: 'genres',
      label: 'Genres',
      value: matchedGenres.map((genre) => genre.name).join(' · '),
      conflict: values.genreIds.length > 0,
    })
  if (result.tags.length)
    fields.push({
      key: 'tags',
      label: 'Tags',
      value: result.tags.join(' · '),
      conflict: Boolean(values.tagsText.trim()),
    })
  if (result.description)
    fields.push({
      key: 'description',
      label: 'Description',
      value: result.description,
      conflict: Boolean(values.description?.trim()),
    })
  if (result.canonicalUrl)
    fields.push({
      key: 'canonicalUrl',
      label: 'Source link',
      value: result.canonicalUrl,
      conflict: values.links.some((link) => link.url.trim()),
    })
  if (result.coverUrl)
    fields.push({
      key: 'coverUrl',
      label: 'Cover',
      value: result.coverUrl,
      conflict: hasDraftCover,
    })
  return fields
}
