import { ArrowDown, ArrowUp, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useEffect, useEffectEvent, useRef, useState } from 'react'
import type { Dispatch, RefObject, SetStateAction } from 'react'
import { bookListPageSizeOptions } from './bookListState'
import { fieldClass } from '@/components/ui/fieldStyles'

const paginationDirectionButtonClass =
  'inline-flex min-h-9 min-w-9 items-center justify-center gap-1 rounded-control border border-line bg-transparent px-2.5 text-sm text-ink transition hover:border-line-strong hover:bg-hover'

const paginationPageButtonClass =
  'pagination-page-button inline-flex min-h-9 min-w-9 items-center justify-center rounded-control bg-transparent px-3 text-sm font-medium text-ink-2 tabular-nums transition hover:bg-hover hover:text-ink'

const paginationActivePageButtonClass =
  'pagination-page-button inline-flex min-h-9 min-w-9 items-center justify-center rounded-control bg-raised px-3 text-sm font-semibold text-ink tabular-nums'

export function BookListFooter({
  activePageGapId,
  canGoBack,
  canGoForward,
  currentPage,
  pageSize,
  pageSizeOptions = bookListPageSizeOptions,
  setActivePageGapId,
  setPageSize,
  skip,
  total,
  totalPages,
  visiblePages,
  onGoToPage,
  bare = false,
}: {
  /** No top border or padding: the footer sits on the page, below a boxed list. */
  bare?: boolean
  activePageGapId: string | null
  canGoBack: boolean
  canGoForward: boolean
  currentPage: number
  pageSize: number
  pageSizeOptions?: readonly number[]
  setActivePageGapId: Dispatch<SetStateAction<string | null>>
  setPageSize: (nextPageSize: string) => void
  skip: number
  total: number
  totalPages: number
  visiblePages: (number | 'ellipsis')[]
  onGoToPage: (page: number) => void
}) {
  return (
    <div
      className={bare ? 'text-sm text-ink-2' : 'border-t border-line px-4 py-3 text-sm text-ink-2'}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="tabular-nums">
          {total
            ? `Showing ${skip + 1}–${Math.min(skip + pageSize, total)} of ${total}`
            : '0 results'}
        </span>
        <div className="flex flex-wrap items-center justify-end gap-3">
          <label className="flex items-center gap-2">
            <span>Per page</span>
            <span className="relative inline-flex">
              <select
                className={cn(fieldClass, 'h-9 w-[4.75rem] appearance-none py-0 pr-8 text-sm')}
                value={pageSize}
                onChange={(event) => setPageSize(event.target.value)}
              >
                {pageSizeOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
              <ChevronDown
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 text-ink-2"
              />
            </span>
          </label>
          <div className="flex flex-wrap items-center gap-1.5">
            {canGoBack ? (
              <button
                aria-label="Previous page"
                className={paginationDirectionButtonClass}
                type="button"
                onClick={() => onGoToPage(currentPage - 1)}
              >
                <ChevronLeft aria-hidden="true" className="size-4" />
                <span className="hidden sm:inline">Previous</span>
              </button>
            ) : null}
            {visiblePages.map((item, index) =>
              item === 'ellipsis' ? (
                <PageGapJump
                  gapId={`ellipsis-${index}`}
                  isOpen={activePageGapId === `ellipsis-${index}`}
                  key={`ellipsis-${index}`}
                  totalPages={totalPages}
                  onGoToPage={onGoToPage}
                  onOpen={() => setActivePageGapId(`ellipsis-${index}`)}
                  onClose={() =>
                    setActivePageGapId((current) =>
                      current === `ellipsis-${index}` ? null : current,
                    )
                  }
                />
              ) : (
                <button
                  aria-current={item === currentPage ? 'page' : undefined}
                  className={
                    item === currentPage
                      ? paginationActivePageButtonClass
                      : paginationPageButtonClass
                  }
                  key={item}
                  type="button"
                  onClick={() => onGoToPage(item)}
                >
                  {item}
                </button>
              ),
            )}
            {canGoForward ? (
              <button
                aria-label="Next page"
                className={paginationDirectionButtonClass}
                type="button"
                onClick={() => onGoToPage(currentPage + 1)}
              >
                <span className="hidden sm:inline">Next</span>
                <ChevronRight aria-hidden="true" className="size-4" />
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}

export function ScrollShortcutButtons({
  showBackToTop,
  showGoDown,
  onBackToTop,
  onGoDown,
}: {
  showBackToTop: boolean
  showGoDown: boolean
  onBackToTop: () => void
  onGoDown: () => void
}) {
  if (!showBackToTop && !showGoDown) {
    return null
  }

  return (
    <div className="fixed bottom-6 right-6 z-40 flex flex-col gap-2">
      {showBackToTop ? (
        <button
          aria-label="Back to top"
          className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-line-strong bg-raised text-ink shadow-popover transition hover:bg-selected"
          type="button"
          onClick={onBackToTop}
        >
          <ArrowUp className="h-4 w-4" />
        </button>
      ) : null}
      {showGoDown ? (
        <button
          aria-label="Go to bottom"
          className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-line-strong bg-raised text-ink shadow-popover transition hover:bg-selected"
          type="button"
          onClick={onGoDown}
        >
          <ArrowDown className="h-4 w-4" />
        </button>
      ) : null}
    </div>
  )
}

function PageGapJump({
  gapId,
  isOpen,
  totalPages,
  onGoToPage,
  onOpen,
  onClose,
}: {
  gapId: string
  isOpen: boolean
  totalPages: number
  onGoToPage: (page: number) => void
  onOpen: () => void
  onClose: () => void
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)

  return (
    <div className="relative" ref={containerRef}>
      <button
        aria-label="Jump between pages"
        aria-expanded={isOpen}
        className={paginationPageButtonClass}
        type="button"
        onClick={() => {
          if (isOpen) {
            onClose()
            return
          }

          onOpen()
        }}
      >
        ...
      </button>
      {isOpen ? (
        <PageGapJumpPopover
          containerRef={containerRef}
          gapId={gapId}
          totalPages={totalPages}
          onClose={onClose}
          onGoToPage={onGoToPage}
        />
      ) : null}
    </div>
  )
}

function PageGapJumpPopover({
  containerRef,
  gapId,
  totalPages,
  onGoToPage,
  onClose,
}: {
  containerRef: RefObject<HTMLDivElement | null>
  gapId: string
  totalPages: number
  onGoToPage: (page: number) => void
  onClose: () => void
}) {
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)

  const parsed = Number(value)
  const isValid = Number.isInteger(parsed) && parsed >= 1 && parsed <= totalPages

  function submit() {
    if (!isValid) {
      return false
    }

    onGoToPage(parsed)
    setValue('')
    return true
  }

  const handleOutsidePointerDown = useEffectEvent((event: PointerEvent) => {
    if (containerRef.current?.contains(event.target as Node)) {
      return
    }

    if (submit()) {
      return
    }

    onClose()
  })

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      handleOutsidePointerDown(event)
    }

    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [])

  return (
    <div className="ui-popover absolute bottom-full left-1/2 mb-2 w-32 -translate-x-1/2 p-3">
      <input
        ref={inputRef}
        aria-invalid={!isValid && value.length > 0 ? 'true' : undefined}
        data-gap-id={gapId}
        aria-label="Page number"
        className={cn(fieldClass, 'w-full text-center')}
        inputMode="numeric"
        max={totalPages}
        min={1}
        placeholder={`1-${totalPages}`}
        value={value}
        onChange={(event) => setValue(event.target.value.replace(/[^\d]/g, ''))}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            submit()
          }
          if (event.key === 'Escape') {
            onClose()
          }
        }}
      />
    </div>
  )
}
