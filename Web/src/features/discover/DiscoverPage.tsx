import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { BookPlus, FileText } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { api } from '@/api/client'
import { HttpError } from '@/api/http'
import type { BookCoverDto, PublicBookMetadataDto, PublicBookSnapshotDto } from '@/api/types'
import { Button } from '@/components/ui/Button'
import { BookCoverArtwork } from '@/features/books/BookCoverSection'
import { BookFilesDialog } from '@/features/books/BookFilesPanel'
import { TypeCoverPlaceholder } from '@/features/books/BookListCells'
import { BookSearchInput } from '@/features/books/BookSearchInput'
import { DescribedMetadataPills, MetadataSummary } from '@/features/books/MetadataBadges'
import { useDebouncedValue } from '@/lib/useDebouncedValue'

export function DiscoverPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebouncedValue(search.trim(), 220)
  const [copyingId, setCopyingId] = useState<string | null>(null)

  const books = useQuery({
    queryKey: ['public-books', debouncedSearch],
    queryFn: () =>
      api.searchPublicBooks({
        ...(debouncedSearch ? { search: debouncedSearch } : {}),
        skip: 0,
        take: 40,
      }),
    placeholderData: keepPreviousData,
  })

  async function copyBook(snapshot: PublicBookSnapshotDto) {
    setCopyingId(snapshot.id)
    try {
      const result = await api.copyPublicBook(snapshot.id)
      await queryClient.invalidateQueries({ queryKey: ['books'] })
      toast.success(`“${snapshot.primaryTitle}” was added to your library.`)
      void navigate(`/books/${result.bookId}`)
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setCopyingId(null)
    }
  }

  const total = books.data?.total ?? 0

  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-5">
      <div>
        <h1 className="m-0 font-display text-[40px] leading-tight font-bold tracking-tight">
          Discover
        </h1>
        <p className="m-0 mt-2 max-w-prose text-[15px] text-ink-2">
          Books other readers share. Adding one makes your own copy, which you can edit freely.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <BookSearchInput
          allowedFields={['title', 'author', 'description', 'genre', 'tag', 'type', 'chapters']}
          appearance="compact"
          ariaLabel="Search shared books"
          placeholder="Search title, author, genre, tag, type, or exclude with -tag:…"
          remoteSuggestionsEnabled={false}
          showHelp={false}
          value={search}
          onChange={setSearch}
        />
        <p className="m-0 text-[13px] text-ink-3 tabular-nums" role="status">
          {books.isFetching
            ? 'Searching…'
            : `${total.toLocaleString()} shared ${total === 1 ? 'book' : 'books'}`}
        </p>
      </div>

      {books.isError ? (
        <div
          className="rounded-panel border border-danger-line bg-danger-soft p-4 text-danger-ink"
          role="alert"
        >
          Could not load shared books. Try again.
        </div>
      ) : books.isPending ? (
        <div className="rounded-panel border border-dashed border-line p-6 text-center text-ink-3">
          Loading shared books…
        </div>
      ) : books.data.data.length === 0 ? (
        <div className="flex flex-col items-center gap-1 rounded-panel border border-dashed border-line px-6 py-12 text-center">
          <strong>No shared books found</strong>
          <span className="text-ink-2">
            {search.trim()
              ? 'Try a broader search.'
              : 'Shared books will appear here when readers list them.'}
          </span>
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(26rem,100%),1fr))] gap-4">
          {books.data.data.map((snapshot) => (
            <PublicBookCard
              copying={copyingId === snapshot.id}
              key={snapshot.id}
              snapshot={snapshot}
              onCopy={() => void copyBook(snapshot)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function PublicBookCard({
  snapshot,
  copying,
  onCopy,
}: {
  snapshot: PublicBookSnapshotDto
  copying: boolean
  onCopy: () => void
}) {
  const [filesOpen, setFilesOpen] = useState(false)
  const cover: BookCoverDto | null = snapshot.coverUrl
    ? {
        id: snapshot.id,
        status: 'Found',
        imageUrl: snapshot.coverUrl,
        thumbnailImageUrl: snapshot.coverUrl,
        lastAttemptAt: snapshot.snapshotAt,
      }
    : null
  const filesCount = snapshot.filesCount ?? 0

  return (
    <>
      <article className="flex min-w-0 gap-4 rounded-panel border border-line bg-surface p-4">
        <div className="w-28 flex-none">
          <BookCoverArtwork
            className="w-full"
            cover={cover}
            emptyLabel="No cover"
            loading="lazy"
            placeholder={
              <TypeCoverPlaceholder
                compact
                contentType={snapshot.contentType}
                title={snapshot.primaryTitle}
                titleClassName="bottom-2.5 text-[15px]"
              />
            }
            preferredVariant="thumbnail"
            title={`Cover of ${snapshot.primaryTitle}`}
          />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="min-w-0">
            <h2 className="m-0 text-base font-normal">
              <MetadataSummary
                alternatives={snapshot.alternativeTitles}
                countNoun="alternative title"
                primary={snapshot.primaryTitle}
                primaryClassName="font-display text-lg leading-snug font-bold"
              />
            </h2>
            <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 text-[13px] text-ink-2">
              {snapshot.author ? (
                <MetadataSummary
                  alternatives={snapshot.authorOtherNames}
                  countNoun="alternative name"
                  primary={snapshot.author}
                />
              ) : (
                <span>Unknown author</span>
              )}
              <span aria-hidden="true">·</span>
              <span>{snapshot.contentType}</span>
              {snapshot.totalChapters != null ? (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="tabular-nums">
                    {snapshot.totalChapters.toLocaleString()} chapters
                  </span>
                </>
              ) : null}
            </div>
          </div>

          {snapshot.description?.length ? (
            <p className="m-0 line-clamp-3 text-[13px] leading-relaxed text-ink-2">
              {snapshot.description}
            </p>
          ) : null}

          <MetadataGroup label="Genres" values={snapshot.genres} />
          <MetadataGroup label="Tags" values={snapshot.tags} />

          <div className="mt-auto flex flex-wrap items-center gap-2 pt-2">
            <span className="mr-auto text-xs text-ink-3">
              Shared {new Date(snapshot.snapshotAt).toLocaleDateString()}
            </span>
            {filesCount > 0 ? (
              <Button size="sm" variant="outline" onClick={() => setFilesOpen(true)}>
                <FileText aria-hidden="true" className="size-4" />
                Files ({filesCount})
              </Button>
            ) : null}
            <Button
              disabled={copying || snapshot.isOwner}
              size="sm"
              variant="primary"
              onClick={onCopy}
            >
              <BookPlus aria-hidden="true" className="size-4" />
              {snapshot.isOwner ? 'Your listing' : copying ? 'Adding…' : 'Add to library'}
            </Button>
          </div>
        </div>
      </article>
      {filesOpen ? (
        <BookFilesDialog snapshotId={snapshot.id} onClose={() => setFilesOpen(false)} />
      ) : null}
    </>
  )
}

function MetadataGroup({ label, values }: { label: string; values: PublicBookMetadataDto[] }) {
  if (values.length === 0) return null
  return (
    <div aria-label={label} className="min-w-0" role="group">
      <DescribedMetadataPills
        descriptions={Object.fromEntries(values.map((item) => [item.name, item.description]))}
        maxVisible={4}
        values={values.map((item) => item.name)}
        variant={label === 'Genres' ? 'genre' : 'tag'}
      />
    </div>
  )
}

function getErrorMessage(error: unknown) {
  if (error instanceof HttpError) return error.apiError.detail
  return error instanceof Error ? error.message : 'The book could not be added.'
}
