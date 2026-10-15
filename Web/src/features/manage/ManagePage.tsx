import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { EyeOff, Globe2, Plus, RefreshCw, Search, Trash2 } from 'lucide-react'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { api } from '@/api/client'
import { HttpError } from '@/api/http'
import type {
  AuthorDto,
  BookListItemDto,
  ManagedBookListItemDto,
  ManagedBookListingDto,
  TagDto,
} from '@/api/types'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { fieldClass, textareaClass } from '@/components/ui/fieldStyles'
import { CoverThumb } from '@/features/books/BookListCells'
import { cn } from '@/lib/utils'

type ManageSection = 'tags' | 'authors' | 'books'
type ManagedItem =
  { kind: 'tag'; value: TagDto | null } | { kind: 'author'; value: AuthorDto | null }

const sections: { id: ManageSection; label: string }[] = [
  { id: 'tags', label: 'Tags' },
  { id: 'authors', label: 'Authors' },
  { id: 'books', label: 'Books' },
]

const searchPlaceholders: Record<ManageSection, string> = {
  tags: 'Search tags…',
  authors: 'Search authors or aliases…',
  books: 'Search your books, e.g. -tag:dropped…',
}

const hints: Record<ManageSection, string> = {
  tags: 'Your own tags and their descriptions. Global tags are managed by the admin.',
  authors: 'Author identities and their other names. Global identities are shared by everyone.',
  books:
    'Listing publishes a snapshot to Discover. Refresh it after editing your copy; books others already added never change.',
}

export function ManagePage() {
  const [section, setSection] = useState<ManageSection>('tags')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [selected, setSelected] = useState<ManagedItem | null>(null)
  const [bookActionId, setBookActionId] = useState<string | null>(null)
  const queryClient = useQueryClient()

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedSearch(search.trim()), 180)
    return () => window.clearTimeout(timeout)
  }, [search])

  const results = useQuery<TagDto[] | AuthorDto[]>({
    queryKey: ['manage-metadata', section, debouncedSearch],
    queryFn: () =>
      section === 'tags'
        ? api.searchTags(debouncedSearch, 50)
        : api.searchAuthors(debouncedSearch, 50),
    enabled: section !== 'books',
  })

  const libraryBooks = useInfiniteQuery({
    queryKey: ['manage-books', debouncedSearch],
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      api.getManagedBooks({
        skip: pageParam,
        take: 50,
        ...(debouncedSearch ? { query: debouncedSearch } : {}),
      }),
    getNextPageParam: (lastPage) => {
      const nextSkip = lastPage.skip + lastPage.data.length
      return nextSkip < lastPage.total ? nextSkip : undefined
    },
    enabled: section === 'books',
  })

  function changeSection(next: ManageSection) {
    setSection(next)
    setSearch('')
    setDebouncedSearch('')
  }

  const libraryBookPages = libraryBooks.data?.pages ?? []
  const libraryBookItems = Array.from(
    new Map(
      libraryBookPages.flatMap((page) => page.data).map((item) => [item.book.id, item] as const),
    ).values(),
  )
  const itemCount =
    section === 'books' ? (libraryBookPages[0]?.total ?? 0) : (results.data?.length ?? 0)
  const fetching = section === 'books' ? libraryBooks.isFetching : results.isFetching
  const noun = section === 'tags' ? 'tag' : section === 'authors' ? 'author' : 'book'

  async function runBookAction(bookId: string, action: () => Promise<unknown>, success: string) {
    setBookActionId(bookId)
    try {
      await action()
      toast.success(success)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['manage-books'] }),
        queryClient.invalidateQueries({ queryKey: ['public-books'] }),
      ])
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setBookActionId(null)
    }
  }

  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-5">
      <div>
        <h1 className="m-0 font-display text-[40px] leading-tight font-bold tracking-tight">
          Manage
        </h1>
        <p className="m-0 mt-2 max-w-prose text-[15px] text-ink-2">
          Keep your tags and authors tidy, and choose which books are shared in Discover.
        </p>
      </div>

      <div aria-label="Manage section" className="flex gap-0.5 border-b border-line" role="tablist">
        {sections.map((item) => {
          const active = section === item.id
          return (
            <button
              aria-controls="manage-panel"
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
              onClick={() => changeSection(item.id)}
            >
              {item.label}
            </button>
          )
        })}
      </div>

      <section className="flex min-w-0 flex-col gap-3" id="manage-panel" role="tabpanel">
        <div className="flex flex-wrap items-center gap-3">
          <label className="relative min-w-0 flex-[1_1_320px]">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3"
            />
            <span className="sr-only">Search {section}</span>
            <input
              autoComplete="off"
              className={cn(fieldClass, 'pl-9 text-sm')}
              placeholder={searchPlaceholders[section]}
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <span className="text-[13px] text-ink-3 tabular-nums" role="status">
            {fetching
              ? 'Searching…'
              : `${itemCount.toLocaleString()} ${itemCount === 1 ? noun : `${noun}s`}`}
          </span>
          {section !== 'books' ? (
            <Button
              variant="primary"
              onClick={() =>
                setSelected({ kind: section === 'tags' ? 'tag' : 'author', value: null })
              }
            >
              <Plus aria-hidden="true" className="size-4" />
              Add {noun}
            </Button>
          ) : null}
        </div>
        <p className="m-0 text-[13px] text-ink-3">{hints[section]}</p>

        {section === 'books' ? (
          <ManagedBooks
            actionId={bookActionId}
            error={libraryBooks.isError}
            hasMore={libraryBooks.hasNextPage}
            items={libraryBookItems}
            loading={libraryBooks.isPending}
            loadingMore={libraryBooks.isFetchingNextPage}
            search={search}
            onLoadMore={() => void libraryBooks.fetchNextPage({ cancelRefetch: false })}
            onPublish={(book) =>
              void runBookAction(
                book.id,
                () => api.publishBook(book.id),
                `“${book.primaryTitle}” is now listed.`,
              )
            }
            onRefresh={(listing, book) =>
              void runBookAction(
                book.id,
                () => api.refreshPublishedBook(listing.id),
                `“${book.primaryTitle}” snapshot refreshed.`,
              )
            }
            onUnlist={(listing, book) =>
              void runBookAction(
                book.id,
                () => api.unlistPublishedBook(listing.id),
                `“${book.primaryTitle}” was unlisted.`,
              )
            }
          />
        ) : results.isError ? (
          <StateBox tone="error">Could not load {section}. Try again.</StateBox>
        ) : results.isPending ? (
          <StateBox>Loading {section}…</StateBox>
        ) : itemCount === 0 ? (
          <StateBox>
            <span className="font-semibold text-ink">No {section} found.</span>
            <span>
              {search.trim() ? 'Try a broader search.' : `Use Add ${noun} to create one.`}
            </span>
          </StateBox>
        ) : section === 'tags' ? (
          <TagList
            tags={results.data as TagDto[]}
            onEdit={(tag) => setSelected({ kind: 'tag', value: tag })}
          />
        ) : (
          <AuthorList
            authors={results.data as AuthorDto[]}
            onEdit={(author) => setSelected({ kind: 'author', value: author })}
          />
        )}
      </section>

      {selected ? (
        <ManageDialog
          key={`${selected.kind}:${selected.value?.id ?? 'new'}`}
          item={selected}
          onClose={() => setSelected(null)}
        />
      ) : null}
    </div>
  )
}

function StateBox({ children, tone }: { children: ReactNode; tone?: 'error' }) {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-1 rounded-xl border px-6 py-10 text-center',
        tone === 'error'
          ? 'border-danger-line bg-danger-soft text-danger-ink'
          : 'border-dashed border-line text-ink-2',
      )}
      role={tone === 'error' ? 'alert' : undefined}
    >
      {children}
    </div>
  )
}

function Pill({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'good' }) {
  return (
    <span
      className={cn(
        'inline-flex h-6 shrink-0 items-center rounded-pill border px-2 text-xs font-medium',
        tone === 'good'
          ? 'border-transparent bg-status-finished-soft text-status-finished-ink'
          : 'border-line bg-raised text-ink-2',
      )}
    >
      {children}
    </span>
  )
}

function ListBox({
  children,
  label,
  onScroll,
  busy,
}: {
  children: ReactNode
  label: string
  onScroll?: (event: React.UIEvent<HTMLDivElement>) => void
  busy?: boolean
}) {
  return (
    <div
      aria-busy={busy}
      aria-label={label}
      className="max-h-[min(70vh,48rem)] overflow-y-auto rounded-xl border border-line bg-sunk"
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- scrollable list must stay keyboard-focusable so it can be scrolled without a mouse (axe scrollable-region-focusable)
      tabIndex={0}
      onScroll={onScroll}
    >
      {children}
    </div>
  )
}

const rowClass =
  'flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line-soft px-4 py-3 last:border-b-0'

function ManagedBooks({
  items,
  actionId,
  loading,
  loadingMore,
  hasMore,
  error,
  search,
  onLoadMore,
  onPublish,
  onRefresh,
  onUnlist,
}: {
  items: ManagedBookListItemDto[]
  actionId: string | null
  loading: boolean
  loadingMore: boolean
  hasMore: boolean
  error: boolean
  search: string
  onLoadMore: () => void
  onPublish: (book: BookListItemDto) => void
  onRefresh: (listing: ManagedBookListingDto, book: BookListItemDto) => void
  onUnlist: (listing: ManagedBookListingDto, book: BookListItemDto) => void
}) {
  if (error) return <StateBox tone="error">Could not load your books. Try again.</StateBox>
  if (loading) return <StateBox>Loading your books…</StateBox>
  if (items.length === 0) {
    return (
      <StateBox>
        <span className="font-semibold text-ink">No books found.</span>
        <span>
          {search.trim()
            ? 'Try a broader search.'
            : 'Add a book to your library before sharing it.'}
        </span>
      </StateBox>
    )
  }

  return (
    <ListBox
      busy={loadingMore}
      label="Books"
      onScroll={(event) => {
        const list = event.currentTarget
        if (
          hasMore &&
          !loadingMore &&
          list.scrollHeight - list.scrollTop - list.clientHeight < 96
        ) {
          onLoadMore()
        }
      }}
    >
      {items.map(({ book, listing }) => {
        const busy = actionId === book.id
        const missing = getMissingListingRequirements(book)
        const canPublish = missing.length === 0
        const blockedTitle = canPublish
          ? undefined
          : `Required before ${listing ? 'refreshing' : 'listing'}: ${missing.join(', ')}`
        return (
          <div className={rowClass} key={book.id}>
            <CoverThumb book={book} />
            <div className="min-w-0 flex-[1_1_16rem]">
              <Link
                className="block truncate font-semibold text-ink hover:underline"
                data-manage-title=""
                to={`/books/${book.id}`}
              >
                {book.primaryTitle}
              </Link>
              <div className="truncate text-[13px] text-ink-3">
                {book.author?.length ? book.author : 'Unknown author'} · {book.contentType}
                {listing ? ` · shared ${new Date(listing.snapshotAt).toLocaleDateString()}` : ''}
              </div>
              {!canPublish ? (
                <div className="text-[13px] text-status-hold-ink">
                  Needs {missing.join(', ')} to be shared ·{' '}
                  <Link className="underline underline-offset-2" to={`/books/${book.id}/edit`}>
                    Edit book
                  </Link>
                </div>
              ) : null}
            </div>
            <Pill tone={listing ? 'good' : 'neutral'}>{listing ? 'Listed' : 'Private'}</Pill>
            <div className="flex shrink-0 gap-1.5">
              {listing ? (
                <>
                  <Button
                    aria-label={`Refresh listing ${book.primaryTitle}`}
                    disabled={busy || !canPublish}
                    size="row"
                    title={blockedTitle}
                    onClick={() => onRefresh(listing, book)}
                  >
                    <RefreshCw aria-hidden="true" className="size-4" />
                    Refresh
                  </Button>
                  <Button
                    aria-label={`Unlist ${book.primaryTitle}`}
                    disabled={busy}
                    size="row"
                    variant="ghost"
                    onClick={() => onUnlist(listing, book)}
                  >
                    <EyeOff aria-hidden="true" className="size-4" />
                    Unlist
                  </Button>
                </>
              ) : (
                <Button
                  aria-label={`List ${book.primaryTitle}`}
                  disabled={busy || !canPublish}
                  size="row"
                  title={blockedTitle}
                  variant="primary"
                  onClick={() => onPublish(book)}
                >
                  <Globe2 aria-hidden="true" className="size-4" />
                  {busy ? 'Listing…' : 'List publicly'}
                </Button>
              )}
            </div>
          </div>
        )
      })}
      {loadingMore ? (
        <div className="px-4 py-3 text-center text-[13px] text-ink-3">Loading more books…</div>
      ) : null}
    </ListBox>
  )
}

function TagList({ tags, onEdit }: { tags: TagDto[]; onEdit: (tag: TagDto) => void }) {
  const sortedTags = [...tags].sort((left, right) =>
    left.name.localeCompare(right.name, undefined, { sensitivity: 'base', numeric: true }),
  )
  return (
    <ListBox label="Tags">
      {sortedTags.map((tag) => (
        <ManageRow
          editable={!tag.isGlobal}
          key={tag.id}
          label={`Edit tag ${tag.name}`}
          onEdit={() => onEdit(tag)}
        >
          <div className="min-w-0 flex-[1_1_16rem]">
            <div className="truncate font-semibold" data-manage-title="">
              {tag.name}
            </div>
            <div className="line-clamp-2 text-[13px] text-ink-3">
              {tag.description?.length ? tag.description : 'No description yet'}
            </div>
          </div>
          {tag.isGlobal ? <Pill>Global</Pill> : null}
        </ManageRow>
      ))}
    </ListBox>
  )
}

function AuthorList({
  authors,
  onEdit,
}: {
  authors: AuthorDto[]
  onEdit: (author: AuthorDto) => void
}) {
  const sortedAuthors = [...authors].sort((left, right) =>
    left.primaryName.localeCompare(right.primaryName, undefined, {
      sensitivity: 'base',
      numeric: true,
    }),
  )
  return (
    <ListBox label="Authors">
      {sortedAuthors.map((author) => (
        <ManageRow
          editable={author.isOwned}
          key={author.id}
          label={`Edit author ${author.primaryName}`}
          readOnlyLabel="Global identity"
          onEdit={() => onEdit(author)}
        >
          <div className="min-w-0 flex-[1_1_16rem]">
            <div className="truncate font-semibold" data-manage-title="">
              {author.primaryName}
            </div>
            <div className="truncate text-[13px] text-ink-3">
              {author.otherNames.length > 0
                ? author.otherNames.join(' · ')
                : 'No alternative names'}
            </div>
          </div>
          <Pill>{author.isOwned ? 'Yours' : 'Global'}</Pill>
          {author.isOwned && author.isPublic ? <Pill>Public</Pill> : null}
          <Pill>
            {author.otherNames.length} {author.otherNames.length === 1 ? 'alias' : 'aliases'}
          </Pill>
        </ManageRow>
      ))}
    </ListBox>
  )
}

function getMissingListingRequirements(book: BookListItemDto) {
  const missing: string[] = []
  if (!book.description?.trim()) missing.push('description')
  if (!book.author?.trim()) missing.push('author')
  if (book.genresCount === 0) missing.push('genre')
  if (book.tagsCount === 0) missing.push('tag')
  if (!book.cover?.imageUrl) missing.push('stored cover')
  return missing
}

function ManageRow({
  children,
  editable = true,
  label,
  readOnlyLabel = 'Managed by admin',
  onEdit,
}: {
  children: ReactNode
  editable?: boolean
  label: string
  readOnlyLabel?: string
  onEdit: () => void
}) {
  // Double-click is a pointer shortcut; keyboard users edit through the row's Edit button.
  return (
    <div className={rowClass} role="group" onDoubleClick={editable ? onEdit : undefined}>
      {children}
      {editable ? (
        <Button aria-label={label} size="row" variant="ghost" onClick={onEdit}>
          Edit
        </Button>
      ) : (
        <span className="shrink-0 text-xs text-ink-3">{readOnlyLabel}</span>
      )}
    </div>
  )
}

function ManageDialog({ item, onClose }: { item: ManagedItem; onClose: () => void }) {
  const queryClient = useQueryClient()
  const formId = useId()
  const nameFieldRef = useRef<HTMLInputElement>(null)
  const firstFieldRef = useRef<HTMLTextAreaElement>(null)
  // The dialog is mounted per edited item (keyed by the parent), so initial state comes from props.
  const [nameValue, setNameValue] = useState(() =>
    item.value ? (item.kind === 'tag' ? item.value.name : item.value.primaryName) : '',
  )
  const [value, setValue] = useState(() =>
    item.value
      ? item.kind === 'tag'
        ? (item.value.description ?? '')
        : item.value.otherNames.join('\n')
      : '',
  )
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const hasExistingValue = item.value !== null
  useEffect(() => {
    window.setTimeout(
      () => (hasExistingValue ? firstFieldRef.current : nameFieldRef.current)?.focus(),
      0,
    )
  }, [hasExistingValue])

  const isCreate = item.value === null
  const name = item.value
    ? item.kind === 'tag'
      ? item.value.name
      : item.value.primaryName
    : nameValue
  const section = item.kind === 'tag' ? 'tags' : 'authors'

  async function handleSave(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    try {
      if (item.kind === 'tag' && item.value) {
        await api.updateTag(item.value.id, { description: value.trim() || null })
        toast.success(`Tag “${item.value.name}” updated.`)
      } else if (item.kind === 'tag') {
        await api.createTag({ name: nameValue.trim(), description: value.trim() || null })
        toast.success(`Tag “${nameValue.trim()}” created.`)
      } else {
        const otherNames = value
          .split('\n')
          .map((alias) => alias.trim())
          .filter(Boolean)
        if (item.value) {
          await api.updateAuthor(item.value.id, { otherNames })
          toast.success(`Author “${item.value.primaryName}” updated.`)
        } else {
          await api.createAuthor({ primaryName: nameValue.trim(), otherNames })
          toast.success(`Author “${nameValue.trim()}” created.`)
        }
      }
      await queryClient.invalidateQueries({ queryKey: ['manage-metadata', section] })
      onClose()
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }

    setSaving(true)
    try {
      if (item.kind === 'tag' && item.value) {
        await api.deleteTag(item.value.id)
      } else if (item.kind === 'author' && item.value) {
        await api.deleteAuthor(item.value.id)
      }
      toast.success(`${item.kind === 'tag' ? 'Tag' : 'Author'} “${name}” deleted.`)
      await queryClient.invalidateQueries({ queryKey: ['manage-metadata', section] })
      onClose()
    } catch (error) {
      toast.error(getErrorMessage(error))
      setConfirmDelete(false)
    } finally {
      setSaving(false)
    }
  }

  async function handleVisibilityChange() {
    if (item.kind !== 'author' || !item.value) return

    const isPublic = !item.value.isPublic
    setSaving(true)
    try {
      await api.updateAuthorVisibility(item.value.id, isPublic)
      toast.success(`Author “${item.value.primaryName}” is now ${isPublic ? 'public' : 'private'}.`)
      await queryClient.invalidateQueries({ queryKey: ['manage-metadata', 'authors'] })
      onClose()
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      open
      description={isCreate ? undefined : `Edit ${item.kind}`}
      dismissible={!saving}
      footer={
        <>
          {!isCreate ? (
            <Button disabled={saving} variant="danger" onClick={() => void handleDelete()}>
              <Trash2 aria-hidden="true" className="size-4" />
              {confirmDelete ? 'Confirm delete' : `Delete ${item.kind}`}
            </Button>
          ) : null}
          <span className="flex-1" />
          <Button disabled={saving} variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={saving || (isCreate && !nameValue.trim())}
            form={formId}
            type="submit"
            variant="primary"
          >
            {saving ? 'Saving…' : isCreate ? `Create ${item.kind}` : 'Save changes'}
          </Button>
        </>
      }
      title={isCreate ? `New ${item.kind}` : name}
      widthClassName="max-w-[560px]"
      onClose={onClose}
    >
      <form
        className="flex flex-col gap-4 px-6 pt-4 pb-6"
        id={formId}
        onSubmit={(event) => void handleSave(event)}
      >
        {isCreate ? (
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-ink-2">
              {item.kind === 'tag' ? 'Tag name' : 'Primary name'}
            </span>
            <input
              ref={nameFieldRef}
              aria-label={item.kind === 'tag' ? 'Tag name' : 'Primary name'}
              className={fieldClass}
              maxLength={item.kind === 'tag' ? 100 : 300}
              required
              value={nameValue}
              onChange={(event) => setNameValue(event.target.value)}
            />
          </label>
        ) : null}
        {item.kind === 'tag' ? (
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-ink-2">Description</span>
            <textarea
              aria-label="Description"
              ref={firstFieldRef}
              className={textareaClass}
              maxLength={500}
              placeholder="What does this tag mean in your library?"
              rows={6}
              value={value}
              onChange={(event) => setValue(event.target.value)}
            />
            <small className="text-xs text-ink-3 tabular-nums">{value.length}/500 characters</small>
          </label>
        ) : (
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-ink-2">Alternative names</span>
            <textarea
              aria-label="Alternative names"
              ref={firstFieldRef}
              className={textareaClass}
              placeholder={'One alternative name per line\nExample: Cuttlefish That Loves Diving'}
              rows={8}
              value={value}
              onChange={(event) => setValue(event.target.value)}
            />
            <small className="text-xs text-ink-3">
              One name per line. The primary name stays unchanged.
              {isCreate ? ' New authors start private.' : ''}
            </small>
          </label>
        )}

        {item.kind === 'author' && item.value ? (
          <div className="flex flex-wrap items-start justify-between gap-3 rounded-field border border-line bg-sunk p-4">
            <div className="max-w-md">
              <strong className="text-sm">
                {item.value.isPublic ? 'Public author' : 'Private author'}
              </strong>
              <p className="m-0 mt-1 text-[13px] leading-5 text-ink-2">
                {item.value.isPublic
                  ? 'Other readers can use this identity. Making it private creates private copies for libraries already using it.'
                  : 'Only you can find this identity. Publishing makes its primary and alternative names available to everyone.'}
              </p>
            </div>
            <Button disabled={saving} size="sm" onClick={() => void handleVisibilityChange()}>
              {item.value.isPublic ? 'Make private' : 'Make public'}
            </Button>
          </div>
        ) : null}

        {confirmDelete ? (
          <p className="m-0 text-[13px] text-danger-ink" role="alert">
            {item.kind === 'author' && item.value?.isPublic
              ? 'Your own books must stop using this author first. Other readers keep private copies.'
              : 'This cannot be undone. Items still used by books cannot be deleted.'}
          </p>
        ) : null}
      </form>
    </Dialog>
  )
}

function getErrorMessage(error: unknown) {
  if (error instanceof HttpError) {
    return error.apiError.detail
  }
  return error instanceof Error ? error.message : 'The operation could not be completed.'
}
