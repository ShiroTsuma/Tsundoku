import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import { api } from '@/api/client'
import { apiRequest } from '@/api/http'
import { ChipBox } from '@/components/ui/ChipBox'
import { Button } from '@/components/ui/Button'
import { fieldClass } from '@/components/ui/fieldStyles'
import { ListBox, listRowClass, StateBox } from '@/components/ui/ListParts'
import { SegmentButton } from '@/features/books/BookListControls'
import { useDebouncedValue } from '@/lib/useDebouncedValue'

type Target = { tagId: string | null; genreId: string | null }
type Alias = Target & { id: string; name: string; sourceKind: 'tag' | 'genre'; targetName: string }
type Rule = {
  id: string
  sourceName: string
  targetName: string
  sourceTagId: string | null
  sourceGenreId: string | null
  targetTagId: string | null
  targetGenreId: string | null
}
type Review = { id: string; name: string; booksCount: number; aliases: string[] }
const root = '/admin/metadata'

export function MetadataPolicyPanel() {
  const client = useQueryClient()
  const [tab, setTab] = useState<'aliases' | 'implications' | 'review'>('aliases')
  const [name, setName] = useState('')
  const [savedAliases, setSavedAliases] = useState(0)
  const [sourceKind, setSourceKind] = useState<'tag' | 'genre'>('tag')
  const [source, setSource] = useState<Target>({ tagId: null, genreId: null })
  const [target, setTarget] = useState<Target>({ tagId: null, genreId: null })
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState('')
  const [previewResult, setPreviewResult] = useState<string | null>(null)
  const aliases = useInfiniteQuery({
    queryKey: ['metadata-policy', 'aliases'],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => apiRequest<Alias[]>(`${root}/aliases?skip=${pageParam}&take=50`),
    getNextPageParam: (last, pages) => (last.length === 50 ? pages.length * 50 : undefined),
    enabled: tab === 'aliases',
  })
  const rules = useInfiniteQuery({
    queryKey: ['metadata-policy', 'implications'],
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      apiRequest<Rule[]>(`${root}/implications?skip=${pageParam}&take=50`),
    getNextPageParam: (last, pages) => (last.length === 50 ? pages.length * 50 : undefined),
    enabled: tab === 'implications',
  })
  const review = useInfiniteQuery({
    queryKey: ['metadata-policy', 'review'],
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      apiRequest<{ data: Review[]; total: number }>(`${root}/review?skip=${pageParam}&take=50`),
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((sum, page) => sum + page.data.length, 0)
      return loaded < last.total ? loaded : undefined
    },
    enabled: tab === 'review',
  })
  const genres = useQuery({ queryKey: ['metadata-policy', 'genres'], queryFn: api.getGenres })
  function label(tagId: string | null, genreId: string | null) {
    return genreId ? (genres.data?.data.find((g) => g.id === genreId)?.name ?? genreId) : tagId
  }
  async function mutate(action: () => Promise<unknown>) {
    setBusy(true)
    try {
      await action()
      await client.invalidateQueries({ queryKey: ['metadata-policy'] })
      toast.success('Metadata rules saved.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save rules.')
    } finally {
      setBusy(false)
    }
  }
  const query = tab === 'aliases' ? aliases : tab === 'implications' ? rules : review
  return (
    <section aria-label="Metadata rules" className="flex min-w-0 flex-col gap-3">
      <h2 className="m-0 text-lg font-semibold">Aliases and automatic metadata</h2>
      <p className="m-0 text-sm text-ink-3">
        Rules apply to HTML imports and future book saves. Existing books are reviewed separately.
      </p>
      <div className="flex flex-wrap gap-2">
        {(['aliases', 'implications', 'review'] as const).map((value) => (
          <Button
            key={value}
            aria-pressed={tab === value}
            onClick={() => {
              setTab(value)
              setName('')
              setSource({ tagId: null, genreId: null })
              setTarget({ tagId: null, genreId: null })
            }}
          >
            {value === 'aliases'
              ? 'Redirects'
              : value === 'implications'
                ? 'Required metadata'
                : 'Tags without descriptions'}
          </Button>
        ))}
      </div>
      {tab !== 'review' ? (
        <form
          className="grid gap-3 rounded-field border border-line p-4"
          onSubmit={(event) => {
            event.preventDefault()
            void mutate(async () => {
              if (tab === 'aliases') {
                await apiRequest(`${root}/aliases`, {
                  method: 'PUT',
                  body: { sourceKind, name: name.trim(), ...target },
                })
                setName('')
                setSavedAliases((count) => count + 1)
              } else
                await apiRequest(`${root}/implications`, {
                  method: 'POST',
                  body: {
                    sourceTagId: source.tagId,
                    sourceGenreId: source.genreId,
                    targetTagId: target.tagId,
                    targetGenreId: target.genreId,
                  },
                })
            })
          }}
        >
          {tab === 'aliases' ? (
            <MetadataRuleRow
              key={`incoming-${savedAliases}`}
              label="Incoming name"
              typeLabel="Incoming type"
              kind={sourceKind}
              onKindChange={setSourceKind}
              onNameChange={setName}
              allowCustom
            />
          ) : (
            <MetadataRuleRow key="when-present" label="When present" onChange={setSource} />
          )}
          <MetadataRuleRow
            key={tab === 'aliases' ? 'redirect-target' : 'implication-target'}
            label={tab === 'aliases' ? 'Redirect to' : 'Also add'}
            onChange={setTarget}
          />
          <Button
            type="submit"
            variant="primary"
            disabled={
              busy ||
              (!target.tagId && !target.genreId) ||
              (tab === 'aliases' ? !name.trim() : !source.tagId && !source.genreId)
            }
          >
            Save rule
          </Button>
        </form>
      ) : (
        <p className="m-0 text-sm text-ink-3">
          {review.data?.pages[0]?.total ?? 0} tags await review. No tags are removed or reclassified
          automatically.
        </p>
      )}
      {query.isPending ? (
        <StateBox>Loading…</StateBox>
      ) : query.isError && !query.data ? (
        <StateBox tone="error">Could not load rules.</StateBox>
      ) : (
        <ListBox
          label="Metadata policy entries"
          busy={query.isFetchingNextPage}
          onScroll={(event) => {
            const list = event.currentTarget
            if (
              list.scrollHeight - list.scrollTop - list.clientHeight < 150 &&
              query.hasNextPage &&
              !query.isFetching &&
              !query.isFetchNextPageError
            ) {
              void query.fetchNextPage()
            }
          }}
        >
          {tab === 'aliases'
            ? aliases.data?.pages.flat().map((alias) => (
                <div className={listRowClass} key={alias.id}>
                  <span className="min-w-0 flex-1 break-words">
                    {alias.sourceKind}: {alias.name} → {alias.targetName}
                  </span>
                  <Button
                    disabled={busy}
                    aria-label={`Delete redirect ${alias.name}`}
                    onClick={() =>
                      void mutate(() =>
                        apiRequest(`${root}/aliases/${alias.id}`, { method: 'DELETE' }),
                      )
                    }
                  >
                    Delete
                  </Button>
                </div>
              ))
            : tab === 'implications'
              ? rules.data?.pages.flat().map((rule) => (
                  <div className={listRowClass} key={rule.id}>
                    <span className="min-w-0 flex-1 break-words">
                      {rule.sourceName} → {rule.targetName}
                    </span>
                    <Button
                      disabled={busy}
                      aria-label="Delete required metadata rule"
                      onClick={() =>
                        void mutate(() =>
                          apiRequest(`${root}/implications/${rule.id}`, { method: 'DELETE' }),
                        )
                      }
                    >
                      Delete
                    </Button>
                  </div>
                ))
              : review.data?.pages
                  .flatMap((page) => page.data)
                  .map((tag) => (
                    <div className={listRowClass} key={tag.id}>
                      <span className="min-w-0 flex-1">
                        {tag.name}
                        <small className="block text-ink-3">
                          {tag.booksCount} books · {tag.aliases.join(', ') || 'No redirects'}
                        </small>
                      </span>
                    </div>
                  ))}
          {query.isFetchingNextPage ? (
            <p role="status" className="m-0 px-4 py-3 text-sm text-ink-3">
              Loading more…
            </p>
          ) : null}
          {query.isFetchNextPageError ? (
            <Button onClick={() => void query.fetchNextPage()}>Retry loading more</Button>
          ) : null}
        </ListBox>
      )}
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          void mutate(async () => {
            const result = await apiRequest<{ tags: string[]; genreIds: string[] }>(
              `${root}/preview`,
              {
                method: 'POST',
                body: {
                  tags: preview
                    .split(',')
                    .map((t) => t.trim())
                    .filter(Boolean),
                  genreIds: [],
                },
              },
            )
            setPreviewResult(
              [...result.tags, ...result.genreIds.map((id) => label(null, id))].join(', ') ||
                'No metadata',
            )
          })
        }}
      >
        <label className="flex flex-1 flex-col gap-1 text-sm">
          Preview tags (comma separated)
          <input
            className={fieldClass}
            value={preview}
            onChange={(e) => {
              setPreview(e.target.value)
              setPreviewResult(null)
            }}
          />
        </label>
        <Button type="submit" disabled={busy}>
          Preview
        </Button>
        {previewResult !== null ? (
          <output className="w-full text-sm">{previewResult}</output>
        ) : null}
      </form>
    </section>
  )
}

function MetadataRuleRow({
  label,
  typeLabel,
  kind: controlledKind,
  onKindChange,
  onNameChange,
  onChange,
  allowCustom = false,
}: {
  label: string
  typeLabel?: string
  kind?: 'tag' | 'genre'
  onKindChange?: (kind: 'tag' | 'genre') => void
  onNameChange?: (name: string) => void
  onChange?: (target: Target) => void
  allowCustom?: boolean
}) {
  const [localKind, setLocalKind] = useState<'tag' | 'genre'>('tag')
  const kind = controlledKind ?? localKind
  const [input, setInput] = useState('')
  const [selected, setSelected] = useState<{ key: string; label: string } | null>(null)
  const term = useDebouncedValue(input.trim(), 200)
  const tags = useQuery({
    queryKey: ['metadata-policy', allowCustom ? 'incoming-tags' : 'tags', term],
    queryFn: () => (allowCustom ? api.searchTags(term, 8) : api.searchAdminGlobalTags(term, 8)),
    enabled: kind === 'tag' && term.length > 0,
  })
  const genres = useQuery({ queryKey: ['metadata-policy', 'genres'], queryFn: api.getGenres })
  const options =
    kind === 'tag'
      ? (tags.data ?? [])
      : (genres.data?.data ?? [])
          .filter((g) => g.name.toLowerCase().includes(term.toLowerCase()))
          .slice(0, 8)
  const pending = input.trim() !== term || (kind === 'tag' ? tags.isFetching : genres.isFetching)
  function clearSelection() {
    setSelected(null)
    onChange?.({ tagId: null, genreId: null })
  }
  function select(key: string, name: string) {
    setSelected({ key, label: name })
    setInput('')
    onNameChange?.(name)
    onChange?.({ tagId: kind === 'tag' ? key : null, genreId: kind === 'genre' ? key : null })
  }
  return (
    <fieldset className="m-0 grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-3 border-0 p-0">
      <legend className="sr-only">{label}</legend>
      <MetadataKindSwitch
        label={typeLabel ?? `${label} type`}
        value={kind}
        onChange={(next) => {
          setLocalKind(next)
          onKindChange?.(next)
          setInput('')
          clearSelection()
          onNameChange?.('')
        }}
      />
      <ChipBox
        ariaLabel={label}
        placeholder={`${label}…`}
        variant={kind}
        input={input}
        selected={selected ? [selected] : []}
        suggestions={options.map((option) => ({
          key: option.id,
          label: option.name,
          description: option.description,
        }))}
        suggestionsPending={pending}
        onInputChange={(text) => {
          setInput(text)
          clearSelection()
          onNameChange?.(text)
        }}
        onPick={(key) => {
          const option = options.find((item) => item.id === key)
          if (option) select(key, option.name)
        }}
        onRemove={() => {
          clearSelection()
          onNameChange?.('')
        }}
        onCreate={allowCustom ? (text) => select(`custom:${text}`, text) : undefined}
      />
    </fieldset>
  )
}

function MetadataKindSwitch({
  label,
  value,
  onChange,
}: {
  label: string
  value: 'tag' | 'genre'
  onChange: (value: 'tag' | 'genre') => void
}) {
  return (
    <div
      aria-label={label}
      role="group"
      className="flex h-11 w-fit items-center gap-0.5 rounded-field border border-line bg-surface p-[3px]"
    >
      <SegmentButton pressed={value === 'tag'} onClick={() => onChange('tag')}>
        Tag
      </SegmentButton>
      <SegmentButton pressed={value === 'genre'} onClick={() => onChange('genre')}>
        Genre
      </SegmentButton>
    </div>
  )
}
