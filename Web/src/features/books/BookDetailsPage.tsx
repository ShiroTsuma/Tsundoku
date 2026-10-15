import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ArrowUpRight, MoreHorizontal, Pencil, Search, Star } from 'lucide-react'
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { api } from '@/api/client'
import type { BookDto, BookLinkDto } from '@/api/types'
import { HttpError } from '@/api/http'
import { Button } from '@/components/ui/Button'
import { buttonStyles } from '@/components/ui/buttonStyles'
import { Dialog } from '@/components/ui/Dialog'
import { Menu, type MenuItem } from '@/components/ui/Menu'
import { cn } from '@/lib/utils'
import { BookCoverArtwork, CoverLightbox } from './BookCoverSection'
import { BookFilesPanel } from './BookFilesPanel'
import { TypeCoverPlaceholder } from './BookListCells'
import { getBookListReturnTo } from './bookListNavigation'
import { getProgressHistoryWithDeltas } from './bookProgressHistory'
import { isLowRating } from './bookRating'
import { getStatusTone, statusToneClasses } from './bookStatus'
import { getDisplayCoverFailure } from './coverFailure'
import { DescribedMetadataPills } from './MetadataBadges'
import { ProgressDialog } from './ProgressDialog'
import { setFieldFilter } from './queryTokens'
import { StatusBadge } from './StatusBadge'
import { useResolvedCoverImage } from './useResolvedCoverImage'

const collapsedTagCount = 14
const numberFormat = new Intl.NumberFormat('en-US')

export function BookDetailsPage() {
  const { id } = useParams<{ id: string }>()
  const location = useLocation()
  const navigate = useNavigate()
  const bookListReturnTo = getBookListReturnTo(location.state)
  const queryClient = useQueryClient()
  const [previewOpen, setPreviewOpen] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [descriptionExpanded, setDescriptionExpanded] = useState(false)
  const [descriptionOverflowing, setDescriptionOverflowing] = useState(false)
  const [allTagsVisible, setAllTagsVisible] = useState(false)
  const [epubSearchOpen, setEpubSearchOpen] = useState(false)
  const descriptionRef = useRef<HTMLParagraphElement | null>(null)

  function requireBookId() {
    if (!id) {
      throw new Error('The book id is missing from the route.')
    }
    return id
  }

  const bookQuery = useQuery({
    queryKey: ['book', id],
    queryFn: () => api.getBook(requireBookId()),
    enabled: Boolean(id),
    refetchInterval: (query) => (query.state.data?.cover?.status === 'Pending' ? 2_000 : false),
  })
  const previewImageUrl = useResolvedCoverImage(bookQuery.data?.cover)
  const deleteMutation = useMutation({
    mutationFn: () => api.deleteBook(requireBookId()),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['books'] })
      toast.success('Book deleted.')
      void navigate(bookListReturnTo, { replace: true })
    },
    onError: (error) => {
      toast.error(error instanceof HttpError ? error.apiError.detail : 'Failed to delete the book.')
    },
  })
  const refreshCoverMutation = useMutation({
    mutationFn: () => api.refreshBookCover(requireBookId()),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['book', id] }),
        queryClient.invalidateQueries({ queryKey: ['books'] }),
      ])
      toast.success('Cover search queued.')
    },
    onError: (error) => {
      toast.error(error instanceof HttpError ? error.apiError.detail : 'Failed to refresh cover.')
    },
  })
  const book = bookQuery.data

  useEffect(() => {
    const element = descriptionRef.current
    if (!element || !book?.description) {
      setDescriptionOverflowing(false)
      return
    }

    if (descriptionExpanded) {
      return
    }

    const measureOverflow = () => {
      setDescriptionOverflowing(element.scrollHeight > element.clientHeight + 1)
    }

    measureOverflow()

    if (typeof ResizeObserver === 'undefined') {
      return
    }

    const observer = new ResizeObserver(measureOverflow)
    observer.observe(element)
    return () => observer.disconnect()
  }, [book?.description, descriptionExpanded])

  if (bookQuery.isLoading) {
    return <PageMessage>Loading…</PageMessage>
  }

  if (!book) {
    return <PageMessage>Book not found.</PageMessage>
  }

  const shouldOfferRefresh =
    book.cover?.source !== 'ManualUpload' && book.cover?.source !== 'ManualUrl'
  const refreshLabel = book.cover?.imageUrl ? 'Search again' : 'Search cover'
  const displayCoverFailure = getDisplayCoverFailure(book.cover?.failureReason)
  const coverSourceLabel = book.cover?.source ? coverSourceText(book.cover.source) : undefined
  const coverNote =
    book.cover?.imageUrl || !book.cover
      ? null
      : book.cover.status === 'Pending'
        ? 'Looking for a cover…'
        : displayCoverFailure
  const progressHistory = getProgressHistoryWithDeltas(book.progressHistory)
  const editState = { bookListReturnTo }
  const moreActions: MenuItem[] = [
    ...(shouldOfferRefresh
      ? [
          {
            label: refreshCoverMutation.isPending ? 'Searching…' : refreshLabel,
            description: 'Look for a cover online',
            disabled: refreshCoverMutation.isPending,
            onSelect: () => refreshCoverMutation.mutate(),
          },
        ]
      : []),
    {
      label: 'Delete book…',
      description: 'With its reading history, EPUB files and cover',
      danger: true,
      disabled: deleteMutation.isPending,
      onSelect: () => setDeleteConfirmOpen(true),
    },
  ]
  const hiddenTagCount = Math.max(0, book.tags.length - collapsedTagCount)
  const visibleTags = allTagsVisible ? book.tags : book.tags.slice(0, collapsedTagCount)

  const descriptionStyle: CSSProperties | undefined = !descriptionExpanded
    ? {
        display: '-webkit-box',
        WebkitBoxOrient: 'vertical',
        WebkitLineClamp: 6,
        overflow: 'hidden',
      }
    : undefined

  return (
    <>
      <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-7 pb-14">
        <Link
          className="inline-flex w-fit items-center gap-1.5 text-ink-2 hover:text-ink"
          to={bookListReturnTo}
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
          Library
        </Link>

        <section className="flex flex-wrap items-start gap-8">
          <div className="w-[200px] flex-none sm:w-[220px]">
            <BookCoverArtwork
              className="w-full shadow-cover"
              placeholder={
                <TypeCoverPlaceholder contentType={book.contentType} title={book.primaryTitle} />
              }
              cover={book.cover}
              emptyActionLabel={
                !book.cover?.imageUrl && shouldOfferRefresh ? refreshLabel : undefined
              }
              emptyLabel="No cover in library yet."
              hoverFooter={coverSourceLabel}
              interactive
              title={book.primaryTitle}
              onClick={() => {
                if (book.cover?.imageUrl) {
                  setPreviewOpen(true)
                  return
                }

                if (shouldOfferRefresh) {
                  refreshCoverMutation.mutate()
                }
              }}
            />
            {coverNote ? (
              <p className="m-0 mt-2 text-[13px] whitespace-pre-line text-ink-3">{coverNote}</p>
            ) : null}
          </div>

          <div className="flex min-w-0 flex-[999_1_480px] flex-col gap-3.5">
            <div className="flex flex-wrap items-center gap-2 text-ink-2">
              <StatusBadge status={book.status} />
              <span>{book.contentType}</span>
              <span aria-hidden="true">·</span>
              <span>
                by{' '}
                {book.author ? (
                  <Link
                    className="font-medium text-ink underline decoration-line-focus underline-offset-[3px] hover:decoration-ink"
                    to={`/books?${new URLSearchParams({ query: setFieldFilter('', 'author', book.author) }).toString()}`}
                  >
                    {book.author}
                  </Link>
                ) : (
                  <span className="font-medium text-ink">Unknown author</span>
                )}
              </span>
            </div>
            <h1 className="m-0 max-w-[900px] font-display text-[clamp(1.9rem,3.2vw,2.4rem)] leading-tight font-bold tracking-tight break-words">
              {book.primaryTitle}
            </h1>
            {book.alternativeTitles.length ? (
              <p className="m-0 text-ink-3">{book.alternativeTitles.join(' · ')}</p>
            ) : null}

            <div className="mt-1.5 flex flex-wrap gap-3">
              <ProgressCard book={book} lastLogged={progressHistory[0]?.changedAt} />
              <StatCard label="Rating">
                <RatingValue rating={book.rating} />
                {book.rating == null ? (
                  <Link
                    className="block text-[13px] font-normal text-ink-2 underline decoration-line-focus underline-offset-[3px] hover:text-ink"
                    state={editState}
                    to={`/books/${book.id}/edit#rating`}
                  >
                    Rate it
                  </Link>
                ) : null}
              </StatCard>
              <StatCard label="Priority">
                {book.priority != null ? (
                  <span className="tabular-nums">{book.priority}</span>
                ) : (
                  <span className="text-ink-disabled">—</span>
                )}
                <span className="block text-[13px] font-normal text-ink-3">
                  {book.priority != null ? '1 is next up' : 'not set'}
                </span>
              </StatCard>
            </div>

            <div className="flex flex-wrap gap-2">
              <ProgressDialog book={book} />
              <Link
                className={buttonStyles({ variant: 'secondary' })}
                state={editState}
                to={`/books/${book.id}/edit`}
              >
                <Pencil aria-hidden="true" className="size-4" />
                Edit
              </Link>
              <Button variant="secondary" onClick={() => setEpubSearchOpen(true)}>
                <Search aria-hidden="true" className="size-4" />
                Find EPUB
              </Button>
              <Menu
                align="start"
                label="More actions"
                sections={[{ items: moreActions }]}
                triggerClassName={buttonStyles({ variant: 'outline', size: 'icon' })}
                triggerContent={<MoreHorizontal aria-hidden="true" className="size-4" />}
                widthClassName="w-64"
              />
            </div>
          </div>
        </section>

        <div className="flex flex-wrap items-start gap-8">
          <div className="flex min-w-0 flex-[999_1_560px] flex-col gap-7">
            <Section title="About">
              {book.description ? (
                <>
                  <p
                    className="m-0 max-w-prose text-[15px] leading-relaxed whitespace-pre-line text-ink"
                    ref={descriptionRef}
                    style={descriptionStyle}
                  >
                    {book.description}
                  </p>
                  {descriptionOverflowing || descriptionExpanded ? (
                    <TextButton onClick={() => setDescriptionExpanded(!descriptionExpanded)}>
                      {descriptionExpanded ? 'Show less' : 'Show more'}
                    </TextButton>
                  ) : null}
                </>
              ) : (
                <p className="m-0 text-ink-3">No description yet.</p>
              )}
            </Section>

            <Section title="Genres & tags">
              {book.genres.length || book.tags.length ? (
                <>
                  <DescribedMetadataPills
                    descriptions={book.genreDescriptions}
                    empty={null}
                    linkTo={(genre) => libraryHref('genre', genre)}
                    maxVisible={book.genres.length}
                    values={book.genres}
                    variant="genre"
                  />
                  <div className="flex flex-wrap items-center gap-1.5">
                    <DescribedMetadataPills
                      descriptions={book.tagDescriptions}
                      empty={null}
                      linkTo={(tag) => libraryHref('tag', tag)}
                      maxVisible={visibleTags.length}
                      values={visibleTags}
                      variant="tag"
                    />
                    {hiddenTagCount > 0 ? (
                      <TextButton onClick={() => setAllTagsVisible(!allTagsVisible)}>
                        {allTagsVisible ? 'Show fewer' : `Show all ${book.tags.length}`}
                      </TextButton>
                    ) : null}
                  </div>
                </>
              ) : (
                <p className="m-0 text-ink-3">No genres or tags yet.</p>
              )}
            </Section>

            <Section title="Reading history">
              {progressHistory.length ? (
                <ol className="m-0 flex list-none flex-col gap-4 border-l border-line py-0 pr-0 pl-5">
                  {progressHistory.map((entry) => (
                    <li className="relative" key={entry.id}>
                      <span
                        aria-hidden="true"
                        className={cn(
                          'absolute top-1.5 -left-[26px] size-[11px] rounded-full border-2 border-ground',
                          statusToneClasses[getStatusTone(book.status)].dot,
                        )}
                      />
                      <div className="flex flex-wrap items-baseline gap-2 tabular-nums">
                        <strong>{historyTitle(entry)}</strong>
                        {entry.delta != null && entry.delta !== 0 ? (
                          <span
                            className={cn(
                              'rounded-full px-2 py-0.5 text-xs font-semibold',
                              entry.delta > 0
                                ? 'bg-status-finished-soft text-status-finished-ink'
                                : 'bg-danger-soft text-danger-ink',
                            )}
                          >
                            {entry.delta > 0 ? `+${entry.delta}` : entry.delta}
                          </span>
                        ) : null}
                        <span className="text-[13px] text-ink-3">
                          {entry.chapterNumber != null
                            ? `${numberFormat.format(entry.chapterNumber)} read · `
                            : ''}
                          {formatDate(entry.changedAt)}
                        </span>
                      </div>
                      {entry.comment ? (
                        <p className="m-0 mt-0.5 whitespace-pre-line text-ink-2">{entry.comment}</p>
                      ) : null}
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="m-0 text-ink-3">No progress logged yet.</p>
              )}
            </Section>
          </div>

          <aside className="flex max-w-full flex-[1_1_360px] flex-col gap-4 lg:max-w-[460px]">
            <BookFilesPanel
              bookId={book.id}
              searchOpen={epubSearchOpen}
              onSearchOpenChange={setEpubSearchOpen}
              searchBook={{
                id: book.id,
                title: book.primaryTitle,
                alternativeTitles: book.alternativeTitles,
                chaptersRead: book.currentChapterNumber ?? null,
                chapterLabel: book.currentChapterLabel ?? null,
              }}
            />
            <SidePanel title="Links">
              {book.links.length ? (
                book.links.map((link) => (
                  <a
                    className="flex items-center justify-between gap-2 rounded-control border border-line bg-sunk px-3 py-2.5 font-medium text-ink hover:border-line-strong"
                    href={link.url}
                    key={link.id}
                    rel="noreferrer"
                    target="_blank"
                  >
                    <span className="truncate">{getBookLinkLabel(link)}</span>
                    <ArrowUpRight aria-hidden="true" className="size-4 shrink-0 text-ink-2" />
                  </a>
                ))
              ) : (
                <p className="m-0 text-ink-3">No links.</p>
              )}
            </SidePanel>
            <SidePanel title="Notes">
              {book.notes ? (
                <p className="m-0 whitespace-pre-line text-ink-2">{book.notes}</p>
              ) : (
                <p className="m-0 text-ink-3">
                  No notes yet.{' '}
                  <Link
                    className="text-ink underline decoration-line-focus underline-offset-[3px] hover:decoration-ink"
                    state={editState}
                    to={`/books/${book.id}/edit#notes`}
                  >
                    Add one
                  </Link>
                </p>
              )}
            </SidePanel>
          </aside>
        </div>
      </div>

      <CoverLightbox
        emptyLabel="No cover has been saved for this book yet."
        footer={coverSourceLabel}
        imageUrl={previewImageUrl}
        open={previewOpen}
        title={book.primaryTitle}
        onClose={() => setPreviewOpen(false)}
      />
      <Dialog
        open={deleteConfirmOpen}
        onClose={() => setDeleteConfirmOpen(false)}
        dismissible={!deleteMutation.isPending}
        title="Delete book"
        widthClassName="max-w-md"
        footer={
          <>
            <span className="flex-1" />
            <Button
              variant="outline"
              disabled={deleteMutation.isPending}
              onClick={() => setDeleteConfirmOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={deleteMutation.isPending}
              onClick={() => deleteMutation.mutate()}
            >
              {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
            </Button>
          </>
        }
      >
        <p className="m-0 px-6 py-4 leading-relaxed text-ink-2">
          Delete <strong className="font-semibold text-ink">{book.primaryTitle}</strong>? Its
          reading history, EPUB files and cover go too. This cannot be undone.
        </p>
      </Dialog>
    </>
  )
}

function PageMessage({ children }: { children: ReactNode }) {
  return (
    <div className="w-full rounded-panel border border-line bg-surface p-6 text-ink-2">
      {children}
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5">
      <h2 className="m-0 text-base font-semibold">{title}</h2>
      {children}
    </section>
  )
}

function SidePanel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5 rounded-panel border border-line bg-surface p-4">
      <h2 className="m-0 text-base font-semibold">{title}</h2>
      {children}
    </section>
  )
}

function TextButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button
      className="w-fit border-0 bg-transparent p-0 font-medium text-ink underline decoration-line-focus underline-offset-4 hover:decoration-ink"
      type="button"
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function StatCard({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-[140px] flex-[1_1_140px] rounded-field border border-line bg-surface p-4">
      <div className="text-xs font-semibold tracking-wider text-ink-3 uppercase">{label}</div>
      <div className="mt-1 text-[26px] leading-tight font-semibold">{children}</div>
    </div>
  )
}

function ProgressCard({ book, lastLogged }: { book: BookDto; lastLogged?: string | undefined }) {
  const tone = getStatusTone(book.status)
  const current = typeof book.currentChapterNumber === 'number' ? book.currentChapterNumber : null
  const total = typeof book.totalChapters === 'number' ? book.totalChapters : null
  const finished = tone === 'finished'
  const percent = finished
    ? 100
    : current != null && total != null && total > 0
      ? Math.min(100, (current / total) * 100)
      : null
  const label = book.currentChapterLabel ?? (current != null ? String(current) : null)
  const details = [
    current != null ? `${numberFormat.format(current)} read` : null,
    total != null ? `of ${numberFormat.format(total)}` : 'total unknown',
    percent != null && !finished ? `${Math.round(percent)}%` : null,
    lastLogged ? `last logged ${formatDate(lastLogged, false)}` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="min-w-[300px] flex-[2_1_320px] rounded-field border border-line bg-surface p-4">
      <div className="text-xs font-semibold tracking-wider text-ink-3 uppercase">Progress</div>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-2.5 tabular-nums">
        <span
          className={cn(
            'text-[26px] leading-tight font-semibold',
            finished && 'text-status-finished-ink',
          )}
        >
          {finished ? 'Finished' : label ? `Ch. ${label}` : 'Not started'}
        </span>
        <span className="text-ink-3">{details}</span>
      </div>
      <div
        role="progressbar"
        aria-label="Reading progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent == null ? undefined : Math.round(percent)}
        aria-valuetext={percent == null ? 'Total chapters unknown' : `${Math.round(percent)}%`}
        className={cn(
          'mt-2.5 h-1.5 overflow-hidden rounded-full',
          percent == null
            ? 'bg-[repeating-linear-gradient(90deg,var(--color-line)_0_6px,transparent_6px_10px)]'
            : 'bg-line',
        )}
      >
        {percent != null ? (
          <div
            className={cn('h-full rounded-full', statusToneClasses[tone].bar)}
            style={{ width: `${percent}%` }}
          />
        ) : null}
      </div>
    </div>
  )
}

function RatingValue({ rating }: { rating?: number | null | undefined }) {
  if (typeof rating !== 'number') {
    return (
      <>
        <span className="text-ink-disabled">—</span>
        <span className="block text-[13px] font-normal text-ink-3">not rated</span>
      </>
    )
  }
  const value = Math.max(0, Math.min(10, rating))
  const low = isLowRating(value)
  return (
    <>
      <span
        className={cn('inline-flex items-center gap-1.5 tabular-nums', low && 'text-danger-ink')}
      >
        <Star
          aria-hidden="true"
          className={cn('size-5', low ? 'fill-danger text-danger' : 'fill-star text-star')}
        />
        {value}
        <span className="text-base font-normal text-ink-3">/10</span>
      </span>
      <span className="sr-only">Rated {value} out of 10</span>
    </>
  )
}

function libraryHref(field: string, value: string) {
  return `/books?${new URLSearchParams({ query: setFieldFilter('', field, value) }).toString()}`
}

function historyTitle(entry: { chapterLabel?: string | null; chapterNumber?: number | null }) {
  const label = entry.chapterLabel?.trim()
  if (label) return `Ch. ${label}`
  if (entry.chapterNumber != null) return `Ch. ${entry.chapterNumber}`
  return 'Note'
}

function coverSourceText(source: string) {
  switch (source) {
    case 'ManualUpload':
      return 'Uploaded manually'
    case 'ManualUrl':
      return 'Added from a link'
    default:
      return `Found via ${source}`
  }
}

function getBookLinkLabel(link: BookLinkDto) {
  const customLabel = link.label?.trim()
  if (customLabel) {
    return customLabel
  }

  const sourceType = link.sourceType.trim()
  if (sourceType && sourceType.toLowerCase() !== 'other') {
    return sourceType
  }

  try {
    return new URL(link.url).hostname.replace(/^www\./, '')
  } catch {
    return link.url
  }
}

function formatDate(value?: string | null, withTime = true) {
  if (!value) {
    return '—'
  }

  return new Intl.DateTimeFormat(
    'en-US',
    withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' },
  ).format(new Date(value))
}
