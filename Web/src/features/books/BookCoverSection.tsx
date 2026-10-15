import { X, ZoomIn } from 'lucide-react'
import { useEffect, type ReactNode } from 'react'
import type { BookCoverSummaryDto } from '@/api/types'
import { useBodyScrollLock } from '@/components/app/useBodyScrollLock'
import { useCoverLoadPermission } from './useCoverLoadPermission'
import { useResolvedCoverImage } from './useResolvedCoverImage'
import { buttonStyles } from '@/components/ui/buttonStyles'

type BookCoverArtworkProps = {
  title: string
  cover?: BookCoverSummaryDto | null | undefined
  imageUrl?: string | null | undefined
  preferredVariant?: 'full' | 'thumbnail' | undefined
  loading?: 'eager' | 'lazy' | undefined
  interactive?: boolean | undefined
  onClick?: (() => void) | undefined
  onRemove?: (() => void) | undefined
  className?: string | undefined
  emptyLabel?: string | undefined
  hint?: string | undefined
  removeLabel?: string | undefined
  emptyActionLabel?: string | undefined
  hoverFooter?: string | undefined
  /** Replaces the default empty state (e.g. a type-coloured placeholder). */
  placeholder?: ReactNode
}

type CoverLightboxProps = {
  open: boolean
  title: string
  imageUrl: string | null
  emptyLabel?: string | undefined
  footer?: string | undefined
  onClose: () => void
}

export function BookCoverArtwork({
  title,
  cover,
  imageUrl,
  preferredVariant = 'full',
  loading = 'eager',
  interactive = false,
  onClick,
  onRemove,
  className = '',
  emptyLabel = 'No cover',
  hint,
  removeLabel = 'Remove cover',
  emptyActionLabel,
  hoverFooter,
  placeholder,
}: BookCoverArtworkProps) {
  const { permitted: loadPermitted, setTarget: setLoadTarget } = useCoverLoadPermission(
    loading === 'lazy',
  )
  const blobUrl = useResolvedCoverImage(cover, preferredVariant, loadPermitted)
  const resolvedImageUrl = imageUrl ?? blobUrl
  const artworkClassName = [
    'book-cover-artwork group relative flex aspect-[2/3] w-full items-center justify-center overflow-hidden',
    interactive ? 'transition hover:border-slate-300' : '',
    interactive && resolvedImageUrl ? 'cursor-zoom-in' : '',
    interactive && !resolvedImageUrl ? 'cursor-pointer' : '',
  ]
    .filter(Boolean)
    .join(' ')
  const wrapperClassName = [artworkClassName, className].filter(Boolean).join(' ')

  const content = resolvedImageUrl ? (
    <img
      alt={title}
      className="h-full w-full object-cover"
      decoding="async"
      loading={loading}
      src={resolvedImageUrl}
    />
  ) : (
    (placeholder ?? (
      <div className="grid place-items-center gap-2 px-6 text-center text-slate-500">
        <div className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-400">
          No Cover
        </div>
        <div className="text-sm">{emptyLabel}</div>
        {hint ? <div className="whitespace-pre-line text-xs text-slate-400">{hint}</div> : null}
        {emptyActionLabel ? (
          <div className="inline-flex items-center rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold text-white">
            {emptyActionLabel}
          </div>
        ) : null}
      </div>
    ))
  )

  if (!interactive) {
    return (
      <div className={wrapperClassName} ref={setLoadTarget}>
        {content}
        {resolvedImageUrl && onRemove ? (
          <button
            aria-label={removeLabel}
            className={`${buttonStyles({ variant: 'danger', size: 'iconSm' })} rounded-full absolute left-3 top-3 opacity-0 group-hover:opacity-100`}
            type="button"
            onClick={onRemove}
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </div>
    )
  }

  const interactiveContent = (
    <>
      {content}
      {resolvedImageUrl ? (
        <span className="pointer-events-none absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-slate-950/75 px-2.5 py-1 text-[11px] font-medium text-white opacity-0 transition group-hover:opacity-100">
          <ZoomIn className="h-3 w-3" />
          Preview
        </span>
      ) : null}
      {resolvedImageUrl && hoverFooter ? (
        <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-slate-950/85 px-4 py-3 text-center text-xs font-medium text-white opacity-0 transition group-hover:opacity-100">
          {hoverFooter}
        </span>
      ) : null}
    </>
  )

  if (!onRemove) {
    return (
      <button className={wrapperClassName} ref={setLoadTarget} type="button" onClick={onClick}>
        {interactiveContent}
      </button>
    )
  }

  return (
    <div className={['group relative', className].filter(Boolean).join(' ')}>
      <button className={artworkClassName} ref={setLoadTarget} type="button" onClick={onClick}>
        {interactiveContent}
      </button>
      {resolvedImageUrl ? (
        <button
          aria-label={removeLabel}
          className={`${buttonStyles({ variant: 'danger', size: 'iconSm' })} rounded-full absolute left-3 top-3 z-10 opacity-0 group-hover:opacity-100 focus-visible:opacity-100`}
          type="button"
          onClick={onRemove}
        >
          <X className="h-4 w-4" />
        </button>
      ) : null}
    </div>
  )
}

export function CoverLightbox({
  open,
  title,
  imageUrl,
  emptyLabel = 'No cover available.',
  footer,
  onClose,
}: CoverLightboxProps) {
  useBodyScrollLock(open)

  useEffect(() => {
    if (!open) {
      return
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose, open])

  if (!open) {
    return null
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <div aria-modal="true" className="relative max-h-[90vh] w-full max-w-4xl" role="dialog">
        <button
          aria-label="Close preview"
          className={`${buttonStyles({ variant: 'ghost', size: 'iconSm' })} absolute right-3 top-3 z-10`}
          type="button"
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </button>
        {imageUrl ? (
          <div className="grid gap-3">
            <img
              alt={title}
              className="max-h-[82vh] w-full rounded-[var(--qs-dialog-radius)] bg-white object-contain shadow-2xl"
              src={imageUrl}
            />
            {footer ? (
              <div className="rounded-panel border border-line-strong bg-raised px-4 py-3 text-sm text-ink shadow-popover">
                {footer}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="grid min-h-[70vh] place-items-center rounded-[var(--qs-dialog-radius)] border border-dashed border-slate-600 bg-slate-900 px-8 text-center text-slate-200 shadow-2xl">
            <div className="grid gap-2">
              <div className="text-xs font-semibold uppercase tracking-[0.32em] text-slate-500">
                No Cover
              </div>
              <div className="text-lg font-medium">{emptyLabel}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
