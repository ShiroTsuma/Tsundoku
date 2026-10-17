import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Check, ChevronDown, CircleOff, Pin } from 'lucide-react'
import { apiRequest } from '@/api/http'
import { Button } from '@/components/ui/Button'
import { StateBox, SearchField } from '@/components/ui/ListParts'
import { Menu } from '@/components/ui/Menu'
import { BookDataTable } from '@/features/books/BookDataTable'
import type { ColumnDefinition } from '@/features/books/columnPreferences'
import { cn } from '@/lib/utils'

export type CrawlerSourceHealth = {
  domain: string
  url: string
  language: string
  canSearch: boolean
  enabled: boolean
  alwaysInclude: boolean
  sampleCount: number
  successCount: number
  timeoutCount: number
  warningCount: number
  rateLimitedCount: number
  successRate: number | null
  timeoutRate: number | null
  warningRate: number | null
  lastObservedAt: number | null
  autoSkipped: boolean
  nextProbeAt: number
}
type Snapshot = { processingEnabled: boolean; sources: CrawlerSourceHealth[] }
const key = ['crawler-source-health']
const percent = (value: number | null) => (value == null ? '—' : `${Math.round(value * 100)}%`)
const languageNames = new Intl.DisplayNames(['en'], { type: 'language' })
const languageCode = (language: string) => language.trim().toLowerCase() || 'unknown'
function languageLabel(code: string) {
  if (code === 'multi') return 'Multilingual'
  if (code === 'unknown') return 'Unknown'
  try {
    return languageNames.of(code) ?? code
  } catch {
    return code
  }
}
type SortKey =
  | 'domain'
  | 'language'
  | 'status'
  | 'sampleCount'
  | 'successRate'
  | 'timeoutRate'
  | 'warningRate'
  | 'rateLimitedCount'
  | 'lastObservedAt'
const columns: { key: SortKey; label: string }[] = [
  { key: 'domain', label: 'Source' },
  { key: 'language', label: 'Language' },
  { key: 'status', label: 'Search status' },
  { key: 'sampleCount', label: 'Samples' },
  { key: 'successRate', label: 'Success' },
  { key: 'timeoutRate', label: 'Timeout' },
  { key: 'warningRate', label: 'Warning' },
  { key: 'rateLimitedCount', label: 'Rate limited' },
  { key: 'lastObservedAt', label: 'Last checked' },
]
const automaticallySkipped = (source: CrawlerSourceHealth) =>
  source.enabled && !source.alwaysInclude && source.autoSkipped
const statusLabel = (source: CrawlerSourceHealth) =>
  !source.enabled ? 'Disabled' : automaticallySkipped(source) ? 'Automatically skipped' : 'Enabled'
function sortValue(source: CrawlerSourceHealth, column: SortKey): string | number | null {
  if (column === 'language') return languageLabel(languageCode(source.language))
  if (column === 'status') return statusLabel(source)
  return source[column]
}

export function CrawlerSourcesPanel() {
  const [filter, setFilter] = useState('')
  const [language, setLanguage] = useState('all')
  const [includeMultilingual, setIncludeMultilingual] = useState(true)
  const [status, setStatus] = useState('all')
  const [sort, setSort] = useState<{ key: SortKey; descending: boolean }>({
    key: 'domain',
    descending: false,
  })
  const cache = useQueryClient()
  const query = useQuery({
    queryKey: key,
    queryFn: () => apiRequest<Snapshot>('/admin/crawler/sources'),
    refetchInterval: 30000,
    retry: false,
  })
  const update = useMutation({
    mutationFn: ({
      domain,
      enabled,
      alwaysInclude,
    }: Pick<CrawlerSourceHealth, 'domain' | 'enabled' | 'alwaysInclude'>) =>
      apiRequest(`/admin/crawler/sources/${encodeURIComponent(domain)}`, {
        method: 'PUT',
        body: { enabled, alwaysInclude },
      }),
    onSuccess: async () => {
      await cache.invalidateQueries({ queryKey: key })
      toast.success('Source settings saved.')
    },
    onError: () => toast.error('Could not update source settings.'),
  })
  const catalog = query.data?.sources ?? []
  const languages = [...new Set(catalog.map((source) => languageCode(source.language)))].sort(
    (a, b) => languageLabel(a).localeCompare(languageLabel(b)),
  )
  const sources = catalog
    .filter((source) => {
      const code = languageCode(source.language)
      return (
        `${source.domain} ${code} ${languageLabel(code)}`
          .toLowerCase()
          .includes(filter.trim().toLowerCase()) &&
        (language === 'all' ||
          code === language ||
          (includeMultilingual && language !== 'multi' && code === 'multi')) &&
        (status === 'all' ||
          (status === 'enabled' && source.enabled) ||
          (status === 'disabled' && !source.enabled) ||
          (status === 'skipped' && automaticallySkipped(source)) ||
          (status === 'pinned' && source.enabled && source.alwaysInclude))
      )
    })
    .sort((a, b) => {
      const left = sortValue(a, sort.key),
        right = sortValue(b, sort.key)
      // Missing measurements remain at the end in either direction.
      if (left == null || right == null)
        return left == null && right == null
          ? a.domain.localeCompare(b.domain)
          : left == null
            ? 1
            : -1
      let compared =
        typeof left === 'string' && typeof right === 'string'
          ? left.localeCompare(right)
          : Number(left) - Number(right)
      if (!compared && sort.key.endsWith('Rate')) compared = a.sampleCount - b.sampleCount
      return (sort.descending ? -compared : compared) || a.domain.localeCompare(b.domain)
    })
  function changeSort(column: SortKey) {
    setSort({
      key: column,
      descending:
        column === sort.key ? !sort.descending : !['domain', 'language', 'status'].includes(column),
    })
  }
  const cellRenderers = [
    (source: CrawlerSourceHealth) => (
      <>
        <a
          className="block truncate font-semibold text-ink hover:underline hover:underline-offset-4"
          href={source.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          {source.domain}
        </a>
        <span className="mt-1 block text-xs text-ink-3">
          {source.canSearch ? 'Title search' : 'Saved links only'}
        </span>
      </>
    ),
    (source: CrawlerSourceHealth) => <>{languageLabel(languageCode(source.language))}</>,
    (source: CrawlerSourceHealth) => (
      <>
        <div className="flex flex-col items-start gap-1.5">
          <span
            className={cn(
              'inline-flex items-center gap-1.5 whitespace-nowrap rounded-pill border px-2 py-1 text-xs font-semibold',
              !source.enabled
                ? 'border-danger-line bg-danger-soft text-danger-ink'
                : automaticallySkipped(source)
                  ? 'border-status-hold bg-status-hold-soft text-status-hold-ink'
                  : 'border-transparent bg-status-finished-soft text-status-finished-ink',
            )}
          >
            {source.enabled && !automaticallySkipped(source) ? (
              <Check className="size-3.5" aria-hidden="true" />
            ) : (
              <CircleOff className="size-3.5" aria-hidden="true" />
            )}
            {statusLabel(source)}
          </span>
          {source.alwaysInclude ? (
            <span className="inline-flex items-center gap-1 text-xs text-ink-2">
              <Pin className="size-3" aria-hidden="true" />
              Always include{!source.enabled ? ' (inactive)' : ''}
            </span>
          ) : null}
        </div>
      </>
    ),
    (source: CrawlerSourceHealth) => <>{source.sampleCount}</>,
    (source: CrawlerSourceHealth) => (
      <>
        {percent(source.successRate)} <span className="text-ink-3">({source.successCount})</span>
      </>
    ),
    (source: CrawlerSourceHealth) => (
      <>
        {percent(source.timeoutRate)} <span className="text-ink-3">({source.timeoutCount})</span>
      </>
    ),
    (source: CrawlerSourceHealth) => (
      <>
        {percent(source.warningRate)} <span className="text-ink-3">({source.warningCount})</span>
      </>
    ),
    (source: CrawlerSourceHealth) => <>{source.rateLimitedCount}</>,
    (source: CrawlerSourceHealth) => (
      <>{source.lastObservedAt ? new Date(source.lastObservedAt * 1000).toLocaleString() : '—'}</>
    ),
  ]
  const widths = [
    'w-[15rem]',
    'w-[8rem]',
    'w-[11rem]',
    'w-[5rem]',
    'w-[6rem]',
    'w-[6rem]',
    'w-[6rem]',
    'w-[7rem]',
    'w-[9rem]',
  ]
  const tableColumns: ColumnDefinition<CrawlerSourceHealth & { id: string }>[] = columns.map(
    (column, index) => ({
      id: column.key,
      label: column.label,
      sortBy: column.key,
      defaultVisible: true,
      widthClass: widths[index]!,
      render: cellRenderers[index]!,
    }),
  )
  return (
    <section className="flex min-w-0 flex-col gap-3" aria-label="Crawler sources">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-0 flex-[1_1_260px]">
          <SearchField
            label="Filter crawler sources"
            placeholder="Search source or language…"
            value={filter}
            onChange={(value) => {
              setFilter(value)
            }}
          />
        </div>
        <Menu
          label="Filter by language"
          triggerClassName="flex h-9 items-center gap-1.5 rounded-control border border-line bg-transparent px-3 text-sm text-ink hover:border-line-strong"
          triggerContent={
            <>
              <span className="text-ink-3">Language</span>
              {language === 'all' ? 'All' : languageLabel(language)}
              <ChevronDown aria-hidden="true" className="size-3.5 text-ink-2" />
            </>
          }
          sections={[
            {
              items: ['all', ...languages].map((code) => ({
                label: code === 'all' ? 'All languages' : languageLabel(code),
                checked: language === code,
                onSelect: () => {
                  setLanguage(code)
                },
              })),
            },
          ]}
        />
        <Menu
          label="Filter by search status"
          triggerClassName="flex h-9 items-center gap-1.5 rounded-control border border-line bg-transparent px-3 text-sm text-ink hover:border-line-strong"
          triggerContent={
            <>
              <span className="text-ink-3">Status</span>
              {
                (
                  {
                    all: 'All',
                    enabled: 'Enabled',
                    disabled: 'Disabled',
                    skipped: 'Automatically skipped',
                    pinned: 'Always include',
                  } as Record<string, string>
                )[status]
              }
              <ChevronDown aria-hidden="true" className="size-3.5 text-ink-2" />
            </>
          }
          sections={[
            {
              items: [
                { value: 'all', label: 'All statuses' },
                { value: 'enabled', label: 'Enabled' },
                { value: 'disabled', label: 'Disabled' },
                { value: 'skipped', label: 'Automatically skipped' },
                { value: 'pinned', label: 'Always include' },
              ].map((item) => ({
                label: item.label,
                checked: status === item.value,
                onSelect: () => {
                  setStatus(item.value)
                },
              })),
            },
          ]}
        />
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            void query.refetch()
          }}
        >
          Refresh sources
        </Button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-3">
        <span role="status">
          {sources.length} of {catalog.length} sources · Statistics: last 365 days
        </span>
        {language !== 'all' && language !== 'multi' && language !== 'unknown' ? (
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              className="size-4 accent-accent"
              checked={includeMultilingual}
              onChange={(event) => {
                setIncludeMultilingual(event.target.checked)
              }}
            />
            Include multilingual sources
          </label>
        ) : null}
      </div>
      {query.isPending ? (
        <StateBox>Loading sources…</StateBox>
      ) : query.isError ? (
        <StateBox tone="error">
          Source settings are unavailable. The crawler service may be offline.
        </StateBox>
      ) : (
        <>
          <div className="overflow-hidden rounded-xl border border-line bg-sunk">
            <BookDataTable
              items={sources.map((source) => ({ ...source, id: source.domain }))}
              wrapperClassName="w-full max-h-[65vh] overflow-y-auto [&_thead]:sticky [&_thead]:top-0 [&_thead]:z-20 [&_thead]:bg-sunk"
              columns={tableColumns}
              isLoading={false}
              emptyMessage="No sources match these filters."
              actionHeader="Controls"
              actionsWidthRem={17}
              sortBy={sort.key}
              sortDirection={sort.descending ? 'desc' : 'asc'}
              onSort={(value) => changeSort(value as SortKey)}
              renderActions={(source) => (
                <>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={update.isPending}
                      onClick={() =>
                        update.mutate({
                          domain: source.domain,
                          enabled: !source.enabled,
                          alwaysInclude: source.alwaysInclude,
                        })
                      }
                    >
                      {source.enabled ? 'Disable search' : 'Enable search'}
                    </Button>
                    <Button
                      size="sm"
                      variant={source.alwaysInclude ? 'primary' : 'outline'}
                      aria-pressed={source.alwaysInclude}
                      disabled={update.isPending}
                      onClick={() =>
                        update.mutate({
                          domain: source.domain,
                          enabled: source.enabled,
                          alwaysInclude: !source.alwaysInclude,
                        })
                      }
                    >
                      Always include
                    </Button>
                  </div>
                </>
              )}
            />
          </div>
        </>
      )}
    </section>
  )
}
