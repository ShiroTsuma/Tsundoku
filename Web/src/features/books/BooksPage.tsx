import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, Download, LayoutGrid, List, MoreHorizontal, Star } from 'lucide-react'
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
} from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { api } from '@/api/client'
import { HttpError } from '@/api/http'
import type { BookImportFinalizeResult, BookListItemDto, BookSummaryDto } from '@/api/types'
import { extractAnalyticsDateFilters } from '@/features/analytics/dateQueryFilters'
import { buttonStyles } from '@/components/ui/buttonStyles'
import { Menu } from '@/components/ui/Menu'
import { cn } from '@/lib/utils'
import { BookDataTable } from './BookDataTable'
import { isLowRating } from './bookRating'
import { CardCover, CoverThumb, ProgressCell, RatingCell, StatusCell } from './BookListCells'
import { ProgressDialog } from './ProgressDialog'
import { getStatusTone, statusToneClasses } from './bookStatus'
import { QueryBar, QuickFilters, SortMenu, StatusTabs, TypeChips } from './BookListControls'
import { setFieldFilter, setStatusFilter } from './queryTokens'
import { useDebouncedValue } from '@/lib/useDebouncedValue'
import { useMediaQuery } from '@/lib/useMediaQuery'
import { formatProgress } from './bookProgress'
import { saveBookListScrollPosition, takeBookListScrollPosition } from './bookListNavigation'
import { ColumnSettingsPopup, TotalChaptersColumnLabel } from './bookListColumns'
import {
  getVisibleColumns,
  useColumnPreferences,
  useViewMode,
  type BookViewMode,
  type ColumnDefinition,
} from './columnPreferences'
import { BookListFooter, ScrollShortcutButtons } from './BookListShared'
import {
  bookListPageSizeOptions,
  getNextSortDirection,
  useBookListPagination,
  useBookListScrollShortcuts,
  useBookListUrlState,
} from './bookListState'
import {
  cardSizeOptions,
  getCardColumnCount,
  getCardSizeScale,
  getCardDetailRowClass,
  getCardPageSizeOptions,
  getCardRowMinHeightClasses,
  getCardTextSizeClasses,
  getClosestPageSize,
  getCardGridColumns,
  useCardSize,
  type CardSize,
} from './bookCardLayout'
import {
  formatAverageRating,
  formatBookCount,
  formatChapterCount,
  formatDate,
  formatShortDate,
} from './bookFormatters'
import { ImportBooksDialog } from './ImportBooksDialog'
import { FileImportDialog } from './files/FileImportDialog'
import { FileExportDialog } from './files/FileExportDialog'
import { DescribedMetadataPills, MetadataSummary } from './MetadataBadges'

const bookColumnsStorageKey = 'novelki.books.columns.v1'
const bookCardFieldsStorageKey = 'novelki.books.card-fields.v1'
const bookLayoutStorageKey = 'novelki.books.layout.v1'
const cardsPerRowStorageKey = 'novelki.books.cards-per-row.v1'
const cardSizeStorageKey = 'novelki.books.card-size.v1'
const pageSizeStorageKey = 'novelki.books.page-size.v1'
const bookSearchDelayMs = 220

const bookColumns: ColumnDefinition<BookListItemDto>[] = [
  {
    id: 'title',
    label: 'Title',
    defaultVisible: true,
    sortBy: 'title',
    widthClass: 'w-60',
    grow: true,
    render: (book) => <TitleCell book={book} />,
  },
  {
    id: 'author',
    label: 'Author',
    defaultVisible: false,
    sortBy: 'author',
    widthClass: 'w-40',
    render: (book) => <AuthorCell book={book} />,
  },
  {
    id: 'status',
    label: 'Status',
    defaultVisible: true,
    sortBy: 'status',
    widthClass: 'w-[8.5rem]',
    render: (book) => <StatusCell status={book.status} />,
  },
  {
    id: 'type',
    label: 'Type',
    defaultVisible: true,
    sortBy: 'type',
    widthClass: 'w-[5.25rem]',
    render: (book) => book.contentType,
  },
  {
    id: 'progress',
    label: 'Progress',
    defaultVisible: true,
    sortBy: 'progress',
    widthClass: 'w-[14.5rem]',
    render: (book) => <ProgressCell book={book} />,
  },
  {
    id: 'totalChapters',
    label: <TotalChaptersColumnLabel />,
    defaultVisible: false,
    sortBy: 'chapters',
    widthClass: 'w-28',
    render: (book) => book.totalChapters ?? '-',
  },
  {
    id: 'rating',
    label: 'Rating',
    defaultVisible: true,
    sortBy: 'rating',
    widthClass: 'w-[4.5rem]',
    render: (book) => <RatingCell rating={book.rating} />,
  },
  {
    id: 'priority',
    label: 'Priority',
    defaultVisible: false,
    sortBy: 'priority',
    widthClass: 'w-20',
    render: (book) => book.priority ?? '-',
  },
  {
    id: 'created',
    label: 'Created',
    defaultVisible: false,
    sortBy: 'created',
    widthClass: 'w-40',
    render: (book) => formatDate(book.created),
  },
  {
    id: 'lastModified',
    label: 'Updated',
    defaultVisible: true,
    sortBy: 'lastModified',
    widthClass: 'w-[7.75rem]',
    render: (book) => formatShortDate(book.lastModified || book.created),
  },
  {
    id: 'genres',
    label: 'Genres',
    defaultVisible: false,
    widthClass: 'w-48',
    render: (book) => (
      <DescribedMetadataPills
        descriptions={book.genreDescriptions}
        maxVisible={2}
        totalCount={book.genresCount}
        values={book.genres}
      />
    ),
  },
  {
    id: 'tags',
    label: 'Tags',
    defaultVisible: false,
    widthClass: 'w-52',
    render: (book) => (
      <DescribedMetadataPills
        descriptions={book.tagDescriptions}
        maxVisible={2}
        totalCount={book.tagsCount}
        values={book.tags}
      />
    ),
  },
  {
    id: 'links',
    label: 'Links',
    defaultVisible: false,
    widthClass: 'w-16',
    render: (book) => book.linksCount,
  },
  {
    id: 'notes',
    label: 'Notes',
    defaultVisible: false,
    widthClass: 'w-56',
    render: (book) => <TruncatedCellText value={book.notes} />,
  },
  {
    id: 'description',
    label: 'Description',
    defaultVisible: false,
    widthClass: 'w-56',
    render: (book) => <TruncatedCellText value={book.description} />,
  },
]

const bookCardFields: ColumnDefinition<BookListItemDto>[] = [
  {
    id: 'title',
    label: 'Title',
    defaultVisible: true,
    render: (book) => <span>{book.primaryTitle}</span>,
  },
  {
    id: 'alternativeTitles',
    label: 'Alternative titles',
    defaultVisible: false,
    render: (book) => <span>{formatList(book.alternativeTitles)}</span>,
  },
  {
    id: 'author',
    label: 'Author',
    defaultVisible: true,
    render: (book) => <span>{book.author ?? 'Unknown author'}</span>,
  },
  {
    id: 'status',
    label: 'Status',
    defaultVisible: true,
    render: (book) => <span>{book.status}</span>,
  },
  {
    id: 'type',
    label: 'Type',
    defaultVisible: false,
    render: (book) => <span>{book.contentType}</span>,
  },
  {
    id: 'progress',
    label: 'Progress',
    defaultVisible: true,
    render: (book) => <span>{formatProgress(book)}</span>,
  },
  {
    id: 'rating',
    label: 'Rating',
    defaultVisible: true,
    render: (book) => <span>{book.rating ?? '-'}</span>,
  },
]

export function BooksPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const location = useLocation()
  const restoredScrollPosition = useRef(false)
  const queryClient = useQueryClient()
  const [columnPreferences, setColumnPreferences] = useColumnPreferences(
    bookColumnsStorageKey,
    bookColumns,
  )
  const [cardFieldPreferences, setCardFieldPreferences] = useColumnPreferences(
    bookCardFieldsStorageKey,
    bookCardFields,
  )
  const [viewMode, setViewMode] = useViewMode(bookLayoutStorageKey)
  const isPhone = useMediaQuery('(max-width: 639px)')
  const [cardSize, setCardSize] = useCardSize(cardSizeStorageKey, cardsPerRowStorageKey)
  const [listWidth, setListElement] = useElementWidth()
  const cardColumns = getCardColumnCount(cardSize, listWidth, isPhone)
  const [lastImportResult, setLastImportResult] = useState<BookImportFinalizeResult | null>(null)
  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const [epubExportOpen, setEpubExportOpen] = useState(false)
  const [epubImportOpen, setEpubImportOpen] = useState(false)
  const [importMode, setImportMode] = useState<'csv' | 'full'>('csv')
  const pageSizeOptions =
    viewMode === 'cards' ? getCardPageSizeOptions(cardColumns) : bookListPageSizeOptions
  const {
    pageSize: requestedPageSize,
    query,
    requestQuery,
    setPageSize,
    setSkip,
    setSort: setSortParams,
    skip,
    sortBy,
    sortDirection,
    updateQuery,
  } = useBookListUrlState(searchParams, setSearchParams, { pageSizeStorageKey })
  const pageSize = getClosestPageSize(requestedPageSize, pageSizeOptions)
  const debouncedRequestQuery = useDebouncedValue(requestQuery, bookSearchDelayMs)
  const isWaitingForSearch = debouncedRequestQuery !== requestQuery

  useEffect(() => {
    if (pageSize !== requestedPageSize) {
      setPageSize(String(pageSize))
    }
  }, [pageSize, requestedPageSize, setPageSize])

  const visibleColumns = getVisibleColumns(bookColumns, columnPreferences)
  const visibleCardFields = getVisibleColumns(bookCardFields, cardFieldPreferences)
  const booksQuery = useQuery({
    queryKey: ['books', skip, pageSize, debouncedRequestQuery, sortBy, sortDirection],
    queryFn: ({ signal }) =>
      api.getBooks({
        skip,
        take: pageSize,
        query: debouncedRequestQuery,
        sortBy,
        sortDirection,
        signal,
      }),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  })
  const libraryStatsQuery = useQuery({
    queryKey: ['books-summary', ''],
    queryFn: () => api.getBooksSummary({ query: '' }),
    staleTime: 60_000,
  })
  const statusScopeQuery = setStatusFilter(debouncedRequestQuery, null)
  const statusSummaryQuery = useQuery({
    queryKey: ['books-summary', statusScopeQuery],
    queryFn: () => api.getBooksSummary({ query: statusScopeQuery }),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  })
  const typeScopeQuery = setFieldFilter(debouncedRequestQuery, 'type', null)
  const typeSummaryQuery = useQuery({
    queryKey: ['books-summary', typeScopeQuery],
    queryFn: () => api.getBooksSummary({ query: typeScopeQuery }),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  })
  const typesQuery = useQuery({ queryKey: ['types'], queryFn: api.getTypes, staleTime: 300_000 })
  const cycleSortMutation = useMutation({
    mutationFn: ({
      nextSortBy,
      currentSortDirection,
    }: {
      nextSortBy: string
      currentSortDirection: string | null
    }) =>
      api.getBooks({
        skip,
        take: pageSize,
        query: requestQuery,
        sortBy: nextSortBy,
        ...(currentSortDirection != null ? { sortDirection: currentSortDirection } : {}),
        advanceCycle: true,
      }),
    onSuccess: (result, variables) => {
      const resolvedSortDirection =
        getCyclicSortDirectionFromResult(result.data, variables.nextSortBy) ??
        variables.currentSortDirection ??
        sortDirection
      queryClient.setQueryData(
        ['books', skip, pageSize, requestQuery, variables.nextSortBy, resolvedSortDirection],
        result,
      )

      setSortParams(variables.nextSortBy, resolvedSortDirection)
    },
  })
  const exportMutation = useMutation({
    mutationFn: () => api.downloadBooksExport({ query: requestQuery, sortBy, sortDirection }),
    onSuccess: (blob) => {
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = 'books-export.csv'
      document.body.append(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
      toast.success('Export ready.')
    },
    onError: (error) => {
      toast.error(error instanceof HttpError ? error.apiError.detail : 'Could not export books.')
    },
  })

  useEffect(() => {
    if (restoredScrollPosition.current || !booksQuery.data) {
      return
    }

    restoredScrollPosition.current = true
    const scrollY = takeBookListScrollPosition(`${location.pathname}${location.search}`)
    if (scrollY !== null) {
      window.scrollTo({ top: scrollY, behavior: 'auto' })
    }
  }, [booksQuery.data, location.pathname, location.search])
  const fullExportMutation = useMutation({
    mutationFn: () => api.downloadBooksFullExport({ query: requestQuery, sortBy, sortDirection }),
    onSuccess: (blob) => {
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = 'books-full-export.zip'
      document.body.append(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
      toast.success('Full backup ready.')
    },
    onError: (error) => {
      toast.error(
        error instanceof HttpError ? error.apiError.detail : 'Could not export the full backup.',
      )
    },
  })
  function setSort(nextSortBy: string) {
    if (isCyclicSort(nextSortBy)) {
      cycleSortMutation.mutate({
        nextSortBy,
        currentSortDirection: sortBy === nextSortBy ? sortDirection : null,
      })
      return
    }

    const nextDirection = getNextSortDirection(nextSortBy, sortBy, sortDirection)
    setSortParams(nextSortBy, nextDirection)
  }

  const total = booksQuery.data?.total ?? 0
  const pagination = useBookListPagination({
    pageSize,
    scrollTargetId: 'book-list-results',
    setSkip,
    skip,
    total,
  })
  const scrollShortcuts = useBookListScrollShortcuts()
  const settingsColumns = viewMode === 'cards' ? bookCardFields : bookColumns
  const settingsPreferences = viewMode === 'cards' ? cardFieldPreferences : columnPreferences
  const setSettingsPreferences =
    viewMode === 'cards' ? setCardFieldPreferences : setColumnPreferences
  const settingsTitle = viewMode === 'cards' ? 'Visible card fields' : 'Visible columns'
  const settingsDescription =
    viewMode === 'cards'
      ? 'Choose which book fields appear on cards.'
      : 'Change table order and visibility.'
  const allowSettingsReorder = viewMode === 'table'

  function handleImportComplete(result: BookImportFinalizeResult) {
    setLastImportResult(result)
    void booksQuery.refetch()
    toast.success(`Imported ${result.importedCount} books. Skipped ${result.skippedCount}.`)
  }

  const statusCounts = getStatusCounts(statusSummaryQuery.data)
  const typeCounts = getTypeCounts(typeSummaryQuery.data)
  const typeNames = typesQuery.data?.data.map((type) => type.name) ?? []
  const libraryStats = libraryStatsQuery.data
  const analyticsHref = buildAnalyticsHref(requestQuery)
  const books = booksQuery.data?.data ?? []
  const searching =
    (isWaitingForSearch || booksQuery.isFetching || cycleSortMutation.isPending) &&
    !booksQuery.isLoading

  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="m-0 font-display text-[40px] leading-tight font-bold tracking-tight">
            Library
          </h1>
          <p className="m-0 mt-2 text-[15px] text-ink-2 tabular-nums">
            {libraryStats ? formatLibraryStats(libraryStats) : ' '}
          </p>
        </div>
        <Menu
          label="Import / Export"
          triggerClassName={cn(buttonStyles({ variant: 'secondary' }), 'gap-2')}
          triggerContent={
            <>
              <Download aria-hidden="true" className="size-4" />
              Import / Export
              <ChevronDown aria-hidden="true" className="size-3.5" />
            </>
          }
          widthClassName="w-72"
          sections={[
            {
              title: 'Export',
              items: [
                {
                  label: exportMutation.isPending ? 'Exporting CSV…' : 'CSV',
                  description: 'Books matching the current filters and sort',
                  disabled: exportMutation.isPending,
                  onSelect: () => exportMutation.mutate(),
                },
                {
                  label: fullExportMutation.isPending
                    ? 'Creating full backup…'
                    : 'Full backup (ZIP)',
                  description: 'CSV plus stored cover files; EPUBs exported separately',
                  disabled: fullExportMutation.isPending,
                  onSelect: () => fullExportMutation.mutate(),
                },
                {
                  label: 'EPUB files (ZIP)',
                  description: 'Choose books and files; includes a restore manifest',
                  onSelect: () => setEpubExportOpen(true),
                },
              ],
            },
            {
              title: 'Import',
              items: [
                {
                  label: 'CSV',
                  description: 'Import book data from a CSV file',
                  onSelect: () => {
                    setImportMode('csv')
                    setImportDialogOpen(true)
                  },
                },
                {
                  label: 'Full backup (ZIP)',
                  description: 'Restore book data and stored covers',
                  onSelect: () => {
                    setImportMode('full')
                    setImportDialogOpen(true)
                  },
                },
                {
                  label: 'EPUB archive',
                  description: 'Restore EPUBs to existing books',
                  onSelect: () => setEpubImportOpen(true),
                },
              ],
            },
          ]}
        />
      </div>

      {lastImportResult ? (
        <section className="grid gap-2 rounded-panel border border-line bg-surface p-4">
          <h2 className="m-0 text-sm font-semibold">Last import</h2>
          <p className="m-0 text-sm text-ink-2">
            Imported: {lastImportResult.importedCount}. Skipped: {lastImportResult.skippedCount}.
          </p>
          {lastImportResult.errors.length ? (
            <div className="grid gap-1 rounded-control border border-status-hold bg-status-hold-soft p-3 text-sm text-status-hold-ink">
              {lastImportResult.errors.slice(0, 10).map((error) => (
                <p className="m-0" key={error}>
                  {error}
                </p>
              ))}
              {lastImportResult.errors.length > 10 ? (
                <p className="m-0">More errors: {lastImportResult.errors.length - 10}</p>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3">
        <StatusTabs counts={statusCounts} query={query} onQueryChange={updateQuery} />
        <TypeChips
          counts={typeCounts}
          query={query}
          types={typeNames}
          onQueryChange={updateQuery}
        />
      </div>

      <div className="grid gap-2.5">
        <QueryBar query={query} onQueryChange={updateQuery} />
        <QuickFilters query={query} onQueryChange={updateQuery} />
      </div>

      <section
        aria-label="Books"
        className="flex min-w-0 flex-col gap-4"
        id="book-list-results"
        ref={setListElement}
      >
        <div className="flex flex-wrap items-center justify-end gap-2">
          <div className="mr-auto flex items-baseline gap-3">
            <span className="text-ink-2 tabular-nums" role="status">
              {searching
                ? 'Searching...'
                : booksQuery.data
                  ? `${formatBookCount(total)} ${total === 1 ? 'book matches' : 'books match'}`
                  : ''}
            </span>
            <Link
              className="hidden text-[13px] text-ink-3 underline decoration-line-focus underline-offset-4 hover:text-ink sm:inline"
              to={analyticsHref}
            >
              Open in Stats
            </Link>
          </div>
          <SortMenu
            sortBy={sortBy}
            onSortChange={(option) => {
              if (option.direction === null) {
                setSort(option.sortBy)
                return
              }
              setSortParams(option.sortBy, option.direction)
            }}
          />
          {viewMode === 'cards' ? (
            <CardSizeControl value={cardSize} onChange={setCardSize} />
          ) : null}
          <ViewModeToggle value={viewMode} onChange={setViewMode} />
          <div className="hidden sm:block">
            <ColumnSettingsPopup
              allowReorder={allowSettingsReorder}
              columns={settingsColumns}
              description={settingsDescription}
              preferences={settingsPreferences}
              title={settingsTitle}
              onChange={setSettingsPreferences}
            />
          </div>
        </div>
        {viewMode === 'table' ? (
          <div className="min-w-0 overflow-hidden rounded-xl border border-line bg-sunk">
            {isPhone ? (
              <BookCompactList books={books} isLoading={booksQuery.isLoading} />
            ) : (
              <BookDataTable
                actionsWidthRem={10}
                columns={visibleColumns}
                emptyMessage="No books match the current filters."
                isCyclicSort={isCyclicSort}
                isLoading={booksQuery.isLoading}
                items={books}
                renderActions={(book) => (
                  <>
                    <ProgressDialog book={book} triggerSize="row" triggerVariant="secondary" />
                    <BookRowMenu book={book} />
                  </>
                )}
                sortBy={sortBy}
                sortDirection={sortDirection}
                wrapperClassName="w-full overflow-x-auto"
                onSort={setSort}
              />
            )}
          </div>
        ) : (
          <BookCardGrid
            books={books}
            cardScale={isPhone ? 4 : getCardSizeScale(cardSize)}
            cardSize={cardSize}
            fields={visibleCardFields}
            isLoading={booksQuery.isLoading}
          />
        )}
        <BookListFooter
          bare
          activePageGapId={pagination.activePageGapId}
          canGoBack={pagination.canGoBack}
          canGoForward={pagination.canGoForward}
          currentPage={pagination.currentPage}
          pageSize={pageSize}
          pageSizeOptions={pageSizeOptions}
          setActivePageGapId={pagination.setActivePageGapId}
          setPageSize={setPageSize}
          skip={skip}
          total={total}
          totalPages={pagination.totalPages}
          visiblePages={pagination.visiblePages}
          onGoToPage={pagination.onGoToPage}
        />
      </section>
      {epubExportOpen && (
        <FileExportDialog query={requestQuery} onClose={() => setEpubExportOpen(false)} />
      )}
      {epubImportOpen && (
        <FileImportDialog
          onClose={() => setEpubImportOpen(false)}
          onImported={() => {
            void queryClient.invalidateQueries({ queryKey: ['book-files'] })
          }}
        />
      )}
      <ImportBooksDialog
        mode={importMode}
        open={importDialogOpen}
        onClose={() => setImportDialogOpen(false)}
        onImported={handleImportComplete}
        onChooseEpubArchive={() => {
          setImportDialogOpen(false)
          setEpubImportOpen(true)
        }}
      />
      <ScrollShortcutButtons
        showBackToTop={scrollShortcuts.showBackToTop}
        showGoDown={scrollShortcuts.showGoDown}
        onBackToTop={scrollShortcuts.scrollBackToTop}
        onGoDown={scrollShortcuts.scrollToPageBottom}
      />
    </div>
  )
}

function getStatusCounts(summary: BookSummaryDto | undefined) {
  if (!summary) return undefined
  const counts: Record<string, number> = { all: summary.totalBooks }
  for (const item of summary.statusCounts) {
    counts[item.status.trim().toLowerCase()] = item.count
  }
  for (const status of ['reading', 'completed', 'plan to read', 'on hold', 'dropped', 'unknown']) {
    counts[status] ??= 0
  }
  return counts
}

function getTypeCounts(summary: BookSummaryDto | undefined) {
  if (!summary) return undefined
  const counts: Record<string, number> = { all: summary.totalBooks }
  for (const item of summary.typeCounts) {
    counts[item.type.trim().toLowerCase()] = item.bookCount
  }
  return counts
}

function formatLibraryStats(stats: BookSummaryDto) {
  const finished =
    stats.statusCounts.find((item) => item.status.trim().toLowerCase() === 'completed')?.count ?? 0
  return [
    `${formatBookCount(stats.totalBooks)} ${stats.totalBooks === 1 ? 'book' : 'books'}`,
    `${formatBookCount(finished)} finished`,
    `${formatChapterCount(stats.currentChapters)} chapters read`,
    stats.averageRating != null ? `avg rating ${formatAverageRating(stats.averageRating)}` : null,
  ]
    .filter(Boolean)
    .join(' · ')
}

/** Row "⋯" menu: the actions that don't need their own button. */
function BookRowMenu({ book }: { book: BookListItemDto }) {
  const navigate = useNavigate()
  const location = useLocation()
  const returnTo = `${location.pathname}${location.search}`

  function open(path: string) {
    saveBookListScrollPosition(returnTo, window.scrollY)
    void navigate(path, { state: { bookListReturnTo: returnTo } })
  }

  return (
    <Menu
      label={`More actions for ${book.primaryTitle}`}
      triggerClassName={buttonStyles({ variant: 'ghost', size: 'iconRow' })}
      triggerContent={<MoreHorizontal aria-hidden="true" className="size-4" />}
      widthClassName="w-48"
      sections={[
        {
          items: [
            { label: 'Open details', onSelect: () => open(`/books/${book.id}`) },
            { label: 'Edit book', onSelect: () => open(`/books/${book.id}/edit`) },
          ],
        },
      ]}
    />
  )
}

/** Phone layout of the table view: compact rows as in the mock. */
function BookCompactList({ books, isLoading }: { books: BookListItemDto[]; isLoading: boolean }) {
  if (isLoading) {
    return <div className="px-4 py-8 text-center text-ink-3">Loading...</div>
  }
  if (!books.length) {
    return (
      <div className="px-4 py-8 text-center text-ink-3">No books match the current filters.</div>
    )
  }
  return (
    <ul className="m-0 list-none px-4 py-1" aria-label="Books (compact)">
      {books.map((book) => {
        const tone = getStatusTone(book.status)
        const percent = getProgressPercent(book)
        return (
          <li
            className="flex items-center gap-3 border-b border-line-soft py-2.5 last:border-b-0"
            key={book.id}
          >
            <CoverThumb book={book} className="h-[72px] w-12" />
            <div className="min-w-0 flex-1">
              <BookDetailsLink
                bookId={book.id}
                className="line-clamp-2 text-[15px] leading-snug font-semibold text-ink hover:text-ink"
              >
                {book.primaryTitle}
              </BookDetailsLink>
              <div className="mt-1 flex items-center gap-1.5 text-[13px] tabular-nums">
                <span
                  aria-label={`Book status: ${book.status}`}
                  className={cn('size-1.5 shrink-0 rounded-full', statusToneClasses[tone].bar)}
                  role="img"
                />
                <span className="font-semibold text-ink">
                  {isCompletedStatus(book.status) ? 'Finished' : getCardProgressLabel(book)}
                </span>
                <span className="truncate text-ink-3">{getCardProgressCount(book)}</span>
              </div>
              <div
                aria-hidden="true"
                className={cn(
                  'mt-1.5 h-[3px] overflow-hidden rounded-full',
                  percent == null
                    ? 'bg-[repeating-linear-gradient(90deg,var(--color-line)_0_6px,transparent_6px_10px)]'
                    : 'bg-line',
                )}
              >
                {percent != null ? (
                  <div
                    className={cn('h-full', statusToneClasses[tone].bar)}
                    style={{ width: `${percent}%` }}
                  />
                ) : null}
              </div>
            </div>
            {isCompletedStatus(book.status) ? null : (
              <ProgressDialog
                book={book}
                triggerLabel="Log"
                triggerSize="sm"
                triggerVariant="secondary"
              />
            )}
          </li>
        )
      })}
    </ul>
  )
}

const cardSizeLabels: Record<CardSize, { short: string; long: string }> = {
  small: { short: 'S', long: 'Small cards' },
  medium: { short: 'M', long: 'Medium cards' },
  large: { short: 'L', long: 'Large cards' },
}

/** Card size: the grid fits as many cards of this size as the width allows. */
function CardSizeControl({
  value,
  onChange,
}: {
  value: CardSize
  onChange: (value: CardSize) => void
}) {
  return (
    <div className="hidden items-center gap-2 text-ink-3 sm:flex">
      <span>Size</span>
      <div
        aria-label="Card size"
        className="flex gap-0.5 rounded-field border border-line bg-surface p-[3px]"
        role="group"
      >
        {cardSizeOptions.map((size) => (
          <button
            aria-label={cardSizeLabels[size].long}
            aria-pressed={value === size}
            className={cn(
              'flex h-[30px] min-w-8 items-center justify-center rounded-[7px] border-0 px-2.5 text-sm',
              value === size
                ? 'bg-selected font-semibold text-ink'
                : 'bg-transparent font-medium text-ink-2 hover:text-ink',
            )}
            key={size}
            title={cardSizeLabels[size].long}
            type="button"
            onClick={() => onChange(size)}
          >
            {cardSizeLabels[size].short}
          </button>
        ))}
      </div>
    </div>
  )
}

/** Width of an element, kept up to date with a ResizeObserver. */
function useElementWidth() {
  const [element, setElement] = useState<HTMLElement | null>(null)
  const [width, setWidth] = useState(() =>
    typeof window === 'undefined' ? 1376 : Math.max(0, window.innerWidth - 64),
  )

  useEffect(() => {
    if (!element) return undefined
    if (typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [element])

  return [width, setElement] as const
}

export function ViewModeToggle({
  value,
  onChange,
}: {
  value: BookViewMode
  onChange: (value: BookViewMode) => void
}) {
  return (
    <div className="flex gap-0.5 rounded-field border border-line bg-surface p-[3px]">
      {(
        [
          ['table', 'Table', List],
          ['cards', 'Cards', LayoutGrid],
        ] as const
      ).map(([mode, label, Icon]) => (
        <button
          aria-pressed={value === mode}
          className={cn(
            'flex h-[30px] items-center gap-1.5 rounded-[7px] border-0 px-3 text-sm',
            value === mode
              ? 'bg-selected font-semibold text-ink'
              : 'bg-transparent font-medium text-ink-2 hover:text-ink',
          )}
          key={mode}
          type="button"
          onClick={() => onChange(mode)}
        >
          <Icon aria-hidden="true" className="size-4" />
          {label}
        </button>
      ))}
    </div>
  )
}

function BookCardGrid({
  books,
  cardScale: cardsPerRow,
  cardSize,
  fields,
  isLoading,
}: {
  books: BookListItemDto[]
  /** Cards-per-row equivalent for text and row heights. */
  cardScale: number
  cardSize: CardSize
  fields: ColumnDefinition<BookListItemDto>[]
  isLoading: boolean
}) {
  if (isLoading) {
    return (
      <div className="rounded-xl border border-line bg-sunk px-4 py-8 text-center text-ink-3">
        Loading...
      </div>
    )
  }

  if (!books.length) {
    return (
      <div className="rounded-xl border border-line bg-sunk px-4 py-8 text-center text-ink-3">
        No books match the current filters.
      </div>
    )
  }

  const cardText = getCardTextSizeClasses(cardsPerRow)
  const cardRowMinHeights = getCardRowMinHeightClasses(cardsPerRow)
  const showTitle = hasCardField(fields, 'title')
  const showAlternativeTitles = hasCardField(fields, 'alternativeTitles')
  const showAuthor = hasCardField(fields, 'author')
  const showProgress = hasCardField(fields, 'progress')
  const showType = hasCardField(fields, 'type')
  const showStatus = hasCardField(fields, 'status')
  const showRating = hasCardField(fields, 'rating')
  const cardDetailsClass = getCardDetailRowClass({
    cardsPerRow,
    showAlternativeTitles,
    showAuthor: showAuthor || showType,
    // Progress and the Log button sit in their own row below the details grid.
    showProgress: false,
    showTitle,
    showType: false,
  })

  return (
    <div
      className="book-card-grid grid min-w-0 grid-cols-2 gap-x-5 gap-y-7 sm:[grid-template-columns:var(--card-columns)]"
      style={{ '--card-columns': getCardGridColumns(cardSize) } as CSSProperties}
    >
      {books.map((book) => {
        const finished = isCompletedStatus(book.status)
        const tone = getStatusTone(book.status)
        const rated = showRating && book.rating != null
        const low = book.rating != null && isLowRating(book.rating)
        return (
          <article
            className={cn(
              'book-card flex min-w-0 w-full max-w-full flex-col gap-2.5',
              finished && 'book-card--completed',
            )}
            data-status-tone={tone}
            key={book.id}
          >
            <BookDetailsLink
              ariaLabel={book.primaryTitle}
              bookId={book.id}
              className="group relative block w-full max-w-full min-w-0 overflow-hidden rounded-lg"
            >
              <CardCover book={book} />
              {finished ? (
                <span className="pointer-events-none absolute top-4 -right-1 rotate-[8deg] rounded border-2 border-status-finished bg-ground/85 px-2.5 py-1 text-xs font-bold tracking-[0.12em] text-status-finished-ink">
                  FINISHED
                </span>
              ) : null}
              {showStatus || rated ? (
                <span className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-ground/80 px-2.5 py-2 text-xs backdrop-blur">
                  {showStatus ? (
                    <span className="flex min-w-0 items-center gap-1.5 font-semibold text-ink">
                      <span
                        aria-hidden="true"
                        className={cn(
                          'size-1.5 shrink-0 rounded-full',
                          statusToneClasses[tone].bar,
                        )}
                      />
                      <span aria-label={`Book status: ${book.status}`} className="truncate">
                        {book.status}
                      </span>
                    </span>
                  ) : (
                    <span />
                  )}
                  {rated ? (
                    <span
                      aria-label={`Rating ${book.rating} out of 10`}
                      className={cn(
                        'book-card-rating inline-flex shrink-0 items-center gap-1 font-semibold tabular-nums',
                        low ? 'book-card-rating--low text-danger-ink' : 'text-star',
                      )}
                    >
                      <Star
                        aria-hidden="true"
                        className={cn(
                          'book-card-rating__star size-3',
                          low ? 'fill-danger text-danger' : 'fill-star text-star',
                        )}
                      />
                      {book.rating}
                    </span>
                  ) : null}
                </span>
              ) : null}
              <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-[3px] bg-white/10">
                <span
                  className={cn('block h-full', statusToneClasses[tone].bar)}
                  style={{ width: `${getProgressPercent(book) ?? 0}%` }}
                />
              </span>
            </BookDetailsLink>
            <div className={`grid min-w-0 max-w-full gap-0.5 overflow-hidden ${cardDetailsClass}`}>
              {showTitle ? (
                <div className="min-h-10 min-w-0 max-w-full overflow-hidden">
                  <h2
                    className={`m-0 line-clamp-2 min-w-0 max-w-full font-sans leading-snug font-semibold break-words text-ink ${cardText.title}`}
                    title={book.primaryTitle}
                  >
                    <BookDetailsLink
                      bookId={book.id}
                      className="text-ink hover:text-ink hover:underline hover:underline-offset-4"
                    >
                      {book.primaryTitle}
                    </BookDetailsLink>
                  </h2>
                </div>
              ) : null}
              {showAlternativeTitles ? (
                <div className="min-h-10 min-w-0 max-w-full overflow-hidden">
                  <p
                    className={`m-0 line-clamp-2 min-w-0 max-w-full break-words text-ink-3 ${cardText.meta}`}
                    title={formatListTooltip(book.alternativeTitles, book.alternativeTitlesCount)}
                  >
                    {formatList(book.alternativeTitles)}
                  </p>
                </div>
              ) : null}
              {showAuthor || showType ? (
                <div
                  className={`flex min-w-0 max-w-full gap-1.5 overflow-hidden ${cardRowMinHeights.author}`}
                >
                  {showAuthor ? (
                    <p
                      className={`m-0 min-w-0 truncate text-ink-2 ${cardText.meta}`}
                      title={book.author ?? 'Unknown author'}
                    >
                      {book.author ?? 'Unknown author'}
                    </p>
                  ) : null}
                  {showType ? (
                    <p
                      className={`m-0 shrink-0 truncate text-ink-3 ${cardText.meta}`}
                      title={book.contentType}
                    >
                      {showAuthor ? '· ' : ''}
                      {book.contentType}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
            {showProgress ? (
              <div
                className={`mt-auto flex min-w-0 items-center justify-between gap-2 ${cardRowMinHeights.progress}`}
              >
                <div className="min-w-0 tabular-nums">
                  <div
                    className={cn(
                      `truncate font-semibold ${cardText.meta}`,
                      finished ? 'text-status-finished-ink' : 'text-ink',
                    )}
                    title={formatProgress(book)}
                  >
                    {finished ? 'Finished' : getCardProgressLabel(book)}
                  </div>
                  <div className="truncate text-xs text-ink-3">{getCardProgressCount(book)}</div>
                </div>
                {finished ? null : (
                  <ProgressDialog
                    book={book}
                    triggerLabel="Log"
                    triggerSize="sm"
                    triggerVariant="secondary"
                  />
                )}
              </div>
            ) : null}
          </article>
        )
      })}
    </div>
  )
}

function getCardProgressLabel(book: BookListItemDto) {
  const label =
    book.currentChapterLabel ??
    (book.currentChapterNumber != null ? String(book.currentChapterNumber) : null)
  return label ? `Ch. ${label}` : 'Not started'
}

function getCardProgressCount(book: BookListItemDto) {
  const format = new Intl.NumberFormat('en-US')
  const current = book.currentChapterNumber
  const total = book.totalChapters
  if (typeof current !== 'number')
    return typeof total === 'number' ? `${format.format(total)} chapters` : ''
  if (typeof total === 'number') return `${format.format(current)} / ${format.format(total)}`
  return `${format.format(current)} read`
}

function getProgressPercent(book: BookListItemDto) {
  if (isCompletedStatus(book.status)) return 100
  const current = book.currentChapterNumber
  const total = book.totalChapters
  if (typeof current !== 'number' || typeof total !== 'number' || total <= 0) return null
  return Math.min(100, (current / total) * 100)
}

function hasCardField(fields: ColumnDefinition<BookListItemDto>[], id: string) {
  return fields.some((field) => field.id === id)
}

function TitleCell({ book }: { book: BookListItemDto }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <CoverThumb book={book} />
      <div className="min-w-0 flex-1">
        <BookDetailsLink
          bookId={book.id}
          className="block min-w-0 truncate text-[15px] font-semibold text-ink hover:text-ink hover:underline hover:decoration-line-focus hover:underline-offset-4"
        >
          {book.primaryTitle}
        </BookDetailsLink>
        <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[13px] text-ink-2">
          <MetadataSummary
            alternatives={book.authorOtherNames}
            countNoun="alternative name"
            primary={book.author ?? 'Unknown author'}
            primaryClassName="block min-w-0 truncate"
          />
          {book.alternativeTitlesCount > 0 ? (
            <MetadataSummary
              alternatives={book.alternativeTitles}
              countNoun="alternative title"
              countStyle="text"
              primary=""
              primaryClassName="hidden"
              shortNoun="alt title"
              totalCount={book.alternativeTitlesCount}
            />
          ) : null}
        </div>
      </div>
    </div>
  )
}

function BookDetailsLink({
  ariaLabel,
  bookId,
  children,
  className,
}: {
  ariaLabel?: string
  bookId: string
  children: ReactNode
  className: string
}) {
  const location = useLocation()
  const returnTo = `${location.pathname}${location.search}`

  function rememberScrollPosition(event: MouseEvent<HTMLAnchorElement>) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return
    }

    saveBookListScrollPosition(returnTo, window.scrollY)
  }

  return (
    <Link
      aria-label={ariaLabel}
      className={className}
      state={{ bookListReturnTo: returnTo }}
      to={`/books/${bookId}`}
      onClick={rememberScrollPosition}
    >
      {children}
    </Link>
  )
}

function AuthorCell({ book }: { book: BookListItemDto }) {
  return (
    <MetadataSummary
      alternatives={book.authorOtherNames}
      countNoun="alternative name"
      primary={book.author ?? '-'}
    />
  )
}

function isCyclicSort(sortBy: string) {
  return sortBy === 'status' || sortBy === 'type'
}

function getCyclicSortDirectionFromResult(books: BookListItemDto[], sortBy: string) {
  const firstBook = books[0]
  if (!firstBook) {
    return null
  }

  return sortBy === 'status' ? firstBook.status : sortBy === 'type' ? firstBook.contentType : null
}

function formatList(values: string[]) {
  return values.length ? values.slice(0, 3).join(', ') : '-'
}

function isCompletedStatus(status: string) {
  return status.trim().toLowerCase() === 'completed'
}

function formatListTooltip(values: string[], totalCount = values.length) {
  if (!values.length) {
    return '-'
  }

  const unlistedCount = Math.max(0, totalCount - values.length)
  return [...values, unlistedCount ? `+${unlistedCount} more` : null]
    .filter((line): line is string => Boolean(line))
    .join('\n')
}

function TruncatedCellText({ value }: { value?: string | null | undefined }) {
  const text = (value ?? '') || '-'
  return (
    <span className="block truncate" title={value ?? undefined}>
      {text}
    </span>
  )
}

function buildAnalyticsHref(query: string) {
  const params = new URLSearchParams()
  const analyticsFilters = extractAnalyticsDateFilters(query)
  if (analyticsFilters.query) {
    params.set('query', analyticsFilters.query)
  }
  if (analyticsFilters.from) {
    params.set('from', analyticsFilters.from)
  }
  if (analyticsFilters.to) {
    params.set('to', analyticsFilters.to)
  }

  const search = params.toString()
  return search ? `/analytics?${search}` : '/analytics'
}
