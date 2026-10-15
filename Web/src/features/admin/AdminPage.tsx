import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Pencil } from 'lucide-react'
import { Link, useSearchParams } from 'react-router-dom'
import { api } from '@/api/client'
import type { AdminBookListItemDto } from '@/api/types'
import { buttonStyles } from '@/components/ui/buttonStyles'
import { ProgressCell, RatingCell, StatusCell } from '@/features/books/BookListCells'
import { cn } from '@/lib/utils'
import { AdminMetadataManager } from './AdminMetadataManager'
import { AdminAccountsManager } from './AdminAccountsManager'
import { BookDataTable } from '@/features/books/BookDataTable'
import { DescribedMetadataPills } from '@/features/books/MetadataBadges'
import { ColumnSettingsPopup, TotalChaptersColumnLabel } from '@/features/books/bookListColumns'
import {
  getVisibleColumns,
  useColumnPreferences,
  type ColumnDefinition,
} from '@/features/books/columnPreferences'
import { formatDate, formatShortDate } from '@/features/books/bookFormatters'
import { BookSearchInput } from '@/features/books/BookSearchInput'
import { BookListFooter, ScrollShortcutButtons } from '@/features/books/BookListShared'
import {
  getNextSortDirection,
  useBookListPagination,
  useBookListScrollShortcuts,
  useBookListUrlState,
} from '@/features/books/bookListState'

const adminColumnsStorageKey = 'tsundoku.adminBooks.columns.v1'

const adminBookColumns: ColumnDefinition<AdminBookListItemDto>[] = [
  {
    id: 'id',
    label: 'Id',
    defaultVisible: false,
    widthClass: 'w-36',
    render: (book) => (
      <span className="block truncate font-mono text-xs" title={book.id}>
        {book.id}
      </span>
    ),
  },
  {
    id: 'title',
    label: 'Title',
    defaultVisible: true,
    sortBy: 'title',
    widthClass: 'w-[24%]',
    render: (book) => (
      <span className="block truncate font-semibold" title={book.primaryTitle}>
        {book.primaryTitle}
      </span>
    ),
  },
  {
    id: 'ownerId',
    label: 'Owner id',
    defaultVisible: true,
    sortBy: 'owner',
    widthClass: 'w-[15%]',
    render: (book) => (
      <span className="block truncate font-mono text-xs" title={book.ownerId}>
        {book.ownerId}
      </span>
    ),
  },
  {
    id: 'ownerUsername',
    label: 'Username',
    defaultVisible: false,
    widthClass: 'w-[12%]',
    render: (book) => <TruncatedCellText value={book.ownerUsername} />,
  },
  {
    id: 'ownerEmail',
    label: 'Email',
    defaultVisible: false,
    widthClass: 'w-[16%]',
    render: (book) => <TruncatedCellText value={book.ownerEmail} />,
  },
  {
    id: 'author',
    label: 'Author',
    defaultVisible: true,
    sortBy: 'author',
    widthClass: 'w-[11%]',
    render: (book) => <TruncatedCellText value={book.author} />,
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
    widthClass: 'w-20',
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
    widthClass: 'w-36',
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
    widthClass: 'w-[10%]',
    render: (book) => (
      <DescribedMetadataPills
        descriptions={book.genreDescriptions}
        totalCount={book.genresCount}
        values={book.genres}
      />
    ),
  },
  {
    id: 'tags',
    label: 'Tags',
    defaultVisible: false,
    widthClass: 'w-[10%]',
    render: (book) => (
      <DescribedMetadataPills
        descriptions={book.tagDescriptions}
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
    widthClass: 'w-[16%]',
    render: (book) => <TruncatedCellText value={book.notes} />,
  },
  {
    id: 'description',
    label: 'Description',
    defaultVisible: false,
    widthClass: 'w-[16%]',
    render: (book) => <TruncatedCellText value={book.description} />,
  },
]

export function AdminPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [columnPreferences, setColumnPreferences] = useColumnPreferences(
    adminColumnsStorageKey,
    adminBookColumns,
  )
  const {
    pageSize,
    query,
    requestQuery,
    setPageSize,
    setSkip,
    setSort: setSortParams,
    skip,
    sortBy,
    sortDirection,
    updateQuery,
  } = useBookListUrlState(searchParams, setSearchParams)
  const visibleColumns = getVisibleColumns(adminBookColumns, columnPreferences)
  const adminBooksQuery = useQuery({
    queryKey: ['adminBooks', skip, pageSize, requestQuery, sortBy, sortDirection],
    queryFn: () =>
      api.getAdminBooks({ skip, take: pageSize, query: requestQuery, sortBy, sortDirection }),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  })
  const total = adminBooksQuery.data?.total ?? 0
  const pagination = useBookListPagination({
    pageSize,
    scrollTargetId: 'admin-book-list-results',
    setSkip,
    skip,
    total,
  })
  const scrollShortcuts = useBookListScrollShortcuts()
  function setSort(nextSortBy: string) {
    setSortParams(nextSortBy, getNextSortDirection(nextSortBy, sortBy, sortDirection))
  }

  const tab = normalizeTab(searchParams.get('tab'))
  function changeTab(next: AdminTab) {
    const params = new URLSearchParams(searchParams)
    if (next === 'books') params.delete('tab')
    else params.set('tab', next)
    setSearchParams(params)
  }

  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-5">
      <div>
        <h1 className="m-0 font-display text-[40px] leading-tight font-bold tracking-tight">
          Admin
        </h1>
        <p className="m-0 mt-2 max-w-prose text-[15px] text-ink-2">
          Books from every account, user accounts, and the shared dictionaries.
        </p>
      </div>

      <div aria-label="Admin section" className="flex gap-0.5 border-b border-line" role="tablist">
        {adminTabs.map((item) => {
          const active = tab === item.id
          return (
            <button
              aria-controls="admin-panel"
              aria-selected={active}
              className={cn(
                '-mb-px h-11 border-0 border-b-2 bg-transparent px-3.5 text-sm',
                active
                  ? 'border-accent font-semibold text-ink'
                  : 'border-transparent font-medium text-ink-2 hover:text-ink',
              )}
              key={item.id}
              role="tab"
              type="button"
              onClick={() => changeTab(item.id)}
            >
              {item.label}
            </button>
          )
        })}
      </div>

      <section className="flex min-w-0 flex-col gap-4" id="admin-panel" role="tabpanel">
        {tab === 'accounts' ? <AdminAccountsManager /> : null}
        {tab === 'dictionaries' ? <AdminMetadataManager /> : null}
        {tab === 'books' ? (
          <>
            <BookSearchInput
              appearance="compact"
              ariaLabel="Search books in all accounts"
              placeholder="Search: author:Toika genre:fantasy rating:>=8 -tag:dropped"
              remoteSuggestionsEnabled={false}
              showHelp={false}
              value={query}
              onChange={updateQuery}
            />
            <div className="flex flex-wrap items-center gap-3" id="admin-book-list-results">
              <span className="mr-auto text-[13px] text-ink-3 tabular-nums" role="status">
                {adminBooksQuery.isFetching && !adminBooksQuery.isLoading
                  ? 'Searching…'
                  : `${total.toLocaleString()} ${total === 1 ? 'book' : 'books'} in all accounts`}
              </span>
              <ColumnSettingsPopup
                columns={adminBookColumns}
                preferences={columnPreferences}
                onChange={setColumnPreferences}
              />
            </div>
            <div className="overflow-hidden rounded-xl border border-line bg-sunk">
              <BookDataTable
                actionsWidthRem={4.5}
                columns={visibleColumns}
                emptyMessage="No books match the search."
                isLoading={adminBooksQuery.isLoading}
                items={adminBooksQuery.data?.data ?? []}
                renderActions={(book) => (
                  <Link
                    aria-label={`Edit ${book.primaryTitle}`}
                    className={buttonStyles({ size: 'iconRow' })}
                    to={`/admin/books/${book.id}/edit`}
                  >
                    <Pencil aria-hidden="true" className="size-4" />
                  </Link>
                )}
                sortBy={sortBy}
                sortDirection={sortDirection}
                onSort={setSort}
              />
            </div>
            <BookListFooter
              activePageGapId={pagination.activePageGapId}
              bare
              canGoBack={pagination.canGoBack}
              canGoForward={pagination.canGoForward}
              currentPage={pagination.currentPage}
              pageSize={pageSize}
              setActivePageGapId={pagination.setActivePageGapId}
              setPageSize={setPageSize}
              skip={skip}
              total={total}
              totalPages={pagination.totalPages}
              visiblePages={pagination.visiblePages}
              onGoToPage={pagination.onGoToPage}
            />
            <ScrollShortcutButtons
              showBackToTop={scrollShortcuts.showBackToTop}
              showGoDown={scrollShortcuts.showGoDown}
              onBackToTop={scrollShortcuts.scrollBackToTop}
              onGoDown={scrollShortcuts.scrollToPageBottom}
            />
          </>
        ) : null}
      </section>
    </div>
  )
}

type AdminTab = 'books' | 'accounts' | 'dictionaries'
const adminTabs: { id: AdminTab; label: string }[] = [
  { id: 'books', label: 'Books' },
  { id: 'accounts', label: 'Accounts' },
  { id: 'dictionaries', label: 'Dictionaries' },
]

function normalizeTab(value: string | null): AdminTab {
  return value === 'accounts' || value === 'dictionaries' ? value : 'books'
}

function TruncatedCellText({ value }: { value?: string | null | undefined }) {
  const text = value?.length ? value : '-'
  return (
    <span className="block truncate" title={value ?? undefined}>
      {text}
    </span>
  )
}
