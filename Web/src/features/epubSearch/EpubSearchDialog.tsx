import { formatDistanceToNowStrict } from 'date-fns'
import { Check } from 'lucide-react'
import { useState, type SyntheticEvent } from 'react'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { cn } from '@/lib/utils'
import { chapterCount, planFiles, resolveRange } from './downloadPlan'
import {
  useCancelEpubDownload,
  useEpubDownload,
  useEpubSearch,
  useStartEpubDownload,
} from './queries'
import type {
  EpubCandidateSource,
  EpubChapterRange,
  EpubDownloadFile,
  EpubDownloadJob,
  EpubSearchRequest,
  EpubSourceScope,
} from './types'
import { isDownloadFinished } from './types'

export type EpubSearchBook = {
  id: string
  title: string
  alternativeTitles: string[]
  /** Chapters read (count), or null when unknown. */
  chaptersRead: number | null
  chapterLabel: string | null
  existingFileCount: number
}

type Step = 'search' | 'source' | 'options' | 'download'
type RangeKind = EpubChapterRange['kind']

const steps: { id: Step; label: string }[] = [
  { id: 'search', label: 'Search' },
  { id: 'source', label: 'Choose source' },
  { id: 'options', label: 'Options' },
  { id: 'download', label: 'Download' },
]

const numberFormat = new Intl.NumberFormat('en-US')

export function EpubSearchDialog({
  book,
  open,
  onClose,
  onDownloadStarted,
  onDownloadFinished,
}: {
  book: EpubSearchBook
  open: boolean
  onClose: () => void
  /** Called with the job id when a download starts (the panel shows its progress). */
  onDownloadStarted?: ((jobId: string) => void) | undefined
  onDownloadFinished?: ((job: EpubDownloadJob) => void) | undefined
}) {
  const read = book.chaptersRead ?? 0
  const [step, setStep] = useState<Step>('search')
  const [query, setQuery] = useState(book.title)
  const [scope, setScope] = useState<EpubSourceScope>('english')
  const [request, setRequest] = useState<EpubSearchRequest | null>(null)
  const [source, setSource] = useState<EpubCandidateSource | null>(null)
  const [rangeKind, setRangeKind] = useState<RangeKind>(read > 0 ? 'fromProgress' : 'all')
  const [customFrom, setCustomFrom] = useState(String(read + 1))
  const [customTo, setCustomTo] = useState('')
  const [splitEvery, setSplitEvery] = useState('100')
  const [titleTemplate, setTitleTemplate] = useState('Volume {n}')
  const [addAutomatically, setAddAutomatically] = useState(true)
  const [jobId, setJobId] = useState<string | null>(null)
  const [reportedJobId, setReportedJobId] = useState<string | null>(null)

  const search = useEpubSearch(request)
  const start = useStartEpubDownload()
  const cancel = useCancelEpubDownload()
  const download = useEpubDownload(jobId)
  const job = download.data ?? null

  if (job && isDownloadFinished(job.status) && reportedJobId !== job.id) {
    setReportedJobId(job.id)
    if (job.status === 'completed') onDownloadFinished?.(job)
  }

  const range = buildRange(rangeKind, read, customFrom, customTo)
  const resolved = source ? resolveRange(range, source.chapterCount) : null
  const planned =
    resolved && source
      ? planFiles(resolved, Number(splitEvery), titleTemplate, book.existingFileCount + 1)
      : []

  function submitSearch(event?: SyntheticEvent) {
    event?.preventDefault()
    const trimmed = query.trim()
    if (trimmed.length === 0) return
    setRequest({ bookId: book.id, query: trimmed, scope })
    setSource(null)
    setStep('source')
  }

  function startDownload() {
    if (!source) return
    start.mutate(
      {
        bookId: book.id,
        sourceId: source.id,
        range,
        splitEvery: Math.max(1, Number(splitEvery) || 100),
        titleTemplate,
        firstFileNumber: book.existingFileCount + 1,
        addToBookAutomatically: addAutomatically,
      },
      {
        onSuccess: (started) => {
          setJobId(started.id)
          setStep('download')
          onDownloadStarted?.(started.id)
        },
      },
    )
  }

  const running = job !== null && !isDownloadFinished(job.status)

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Find EPUB"
      description={
        <span className="block truncate">
          for <strong className="font-semibold text-ink">{book.title}</strong>
          {book.chapterLabel ? ` · you're at Ch. ${book.chapterLabel}` : null}
        </span>
      }
      footer={
        <>
          <span className="text-[13px] text-ink-3">{footerHint(step, job)}</span>
          <span className="flex-1" />
          {step === 'source' || step === 'options' ? (
            <Button
              variant="outline"
              onClick={() => setStep(step === 'options' ? 'source' : 'search')}
            >
              Back
            </Button>
          ) : null}
          {step === 'search' ? (
            <Button
              variant="primary"
              onClick={() => submitSearch()}
              disabled={query.trim().length === 0}
            >
              Search
            </Button>
          ) : null}
          {step === 'source' ? (
            <Button variant="primary" onClick={() => setStep('options')} disabled={!source}>
              Use this source
            </Button>
          ) : null}
          {step === 'options' ? (
            <Button
              variant="primary"
              onClick={startDownload}
              disabled={planned.length === 0 || start.isPending}
            >
              {start.isPending ? 'Starting…' : 'Start download'}
            </Button>
          ) : null}
          {step === 'download' && running && jobId ? (
            <Button
              variant="danger"
              onClick={() => cancel.mutate(jobId)}
              disabled={cancel.isPending}
            >
              Cancel download
            </Button>
          ) : null}
          {step === 'download' ? (
            <Button variant="primary" onClick={onClose}>
              {running ? 'Run in background' : 'Done'}
            </Button>
          ) : null}
        </>
      }
    >
      <StepIndicator current={step} />

      {step === 'search' ? (
        <form onSubmit={submitSearch} className="flex flex-col gap-4 px-6 py-6">
          <label className="flex flex-col gap-1.5">
            <span className="font-medium">Search sources for</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="h-11 rounded-control border border-line-strong bg-ground px-3 text-[15px] outline-none focus:border-accent"
            />
          </label>
          {book.alternativeTitles.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-[13px] text-ink-3">Try another title</span>
              {book.alternativeTitles.map((title) => (
                <Button
                  key={title}
                  variant="outline"
                  size="sm"
                  className="rounded-full"
                  onClick={() => setQuery(title)}
                >
                  {title}
                </Button>
              ))}
            </div>
          ) : null}
          <fieldset className="m-0 flex flex-wrap items-center gap-3 rounded-field border border-line bg-sunk px-4 py-3.5">
            <legend className="sr-only">Sources</legend>
            <div className="min-w-[240px] flex-1">
              <div className="font-medium">Sources</div>
              <div className="text-[13px] text-ink-3">
                Searched by the crawler service. Fewer sources return results faster.
              </div>
            </div>
            <ChoicePill selected={scope === 'english'} onSelect={() => setScope('english')}>
              English sources
            </ChoicePill>
            <ChoicePill selected={scope === 'all'} onSelect={() => setScope('all')}>
              All sources
            </ChoicePill>
          </fieldset>
          <p className="m-0 text-[13px] text-ink-3">
            Tsundoku only lists what the crawler finds. Nothing is downloaded until you choose a
            source and confirm.
          </p>
        </form>
      ) : null}

      {step === 'source' ? (
        <div className="flex flex-col gap-3.5 px-6 py-5">
          {search.isPending ? <p className="m-0 text-ink-2">Searching sources…</p> : null}
          {search.isError ? (
            <p role="alert" className="m-0 text-danger-ink">
              Search failed. Try again or change the title.
            </p>
          ) : null}
          {search.data ? (
            <>
              <div className="flex flex-wrap items-center gap-2 text-ink-2">
                {search.data.candidates.length} novels · {countSources(search.data.candidates)}{' '}
                sources · searched {search.data.searchedSourceCount} sources
              </div>
              {search.data.candidates.length === 0 ? (
                <p className="m-0 text-ink-2">No matches. Try one of the alternative titles.</p>
              ) : null}
              {search.data.candidates.map((novel) => (
                <section
                  key={novel.id}
                  className="overflow-hidden rounded-field border border-line"
                >
                  <div className="flex flex-wrap items-center gap-2.5 bg-sunk px-4 py-3">
                    <h3 className="m-0 flex-1 font-display text-[17px] font-bold">{novel.title}</h3>
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 text-xs font-semibold',
                        novel.match === 'title'
                          ? 'bg-selected text-ink'
                          : 'border border-line-strong text-ink-2',
                      )}
                    >
                      {novel.match === 'title' ? 'Title match' : 'Similar title'}
                    </span>
                  </div>
                  <div role="radiogroup" aria-label={`Sources for ${novel.title}`}>
                    {novel.sources.map((candidate) => (
                      <SourceRow
                        key={candidate.id}
                        source={candidate}
                        chaptersRead={read}
                        selected={source?.id === candidate.id}
                        onSelect={() => setSource(candidate)}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </>
          ) : null}
        </div>
      ) : null}

      {step === 'options' && source && resolved ? (
        <div className="flex flex-col gap-5 px-6 py-5">
          <div className="flex items-center gap-3 rounded-field border border-line bg-sunk px-3.5 py-3">
            <span className="min-w-0 flex-1">
              <span className="block text-xs font-semibold tracking-wider text-ink-3 uppercase">
                Source
              </span>
              <strong>{source.sourceName}</strong>{' '}
              <span className="text-ink-3 tabular-nums">
                · {numberFormat.format(source.chapterCount)} chapters · latest{' '}
                {source.latestChapterLabel}
              </span>
            </span>
            <Button variant="outline" size="sm" onClick={() => setStep('source')}>
              Change
            </Button>
          </div>

          <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
            <legend className="mb-2 p-0 font-semibold">Chapters</legend>
            <RangeOption
              selected={rangeKind === 'all'}
              onSelect={() => setRangeKind('all')}
              label="Everything"
              hint={`Chapters 1–${source.chapterCount} · ${numberFormat.format(source.chapterCount)} chapters`}
            />
            {read > 0 ? (
              <RangeOption
                selected={rangeKind === 'fromProgress'}
                onSelect={() => setRangeKind('fromProgress')}
                label="Continue from my progress"
                hint={rangeHint(
                  resolveRange({ kind: 'fromProgress', from: read + 1 }, source.chapterCount),
                  book.chapterLabel,
                )}
                suggested
              />
            ) : null}
            <RangeOption
              selected={rangeKind === 'custom'}
              onSelect={() => setRangeKind('custom')}
              label="Custom range"
              hint="Pick the first and last chapter"
            />
            {rangeKind === 'custom' ? (
              <div className="flex flex-wrap items-center gap-2 pl-9">
                <label className="flex items-center gap-2">
                  <span className="text-ink-2">From</span>
                  <input
                    type="number"
                    min={1}
                    value={customFrom}
                    onChange={(event) => setCustomFrom(event.target.value)}
                    className="h-10 w-24 rounded-control border border-line-strong bg-ground px-3 tabular-nums"
                  />
                </label>
                <label className="flex items-center gap-2">
                  <span className="text-ink-2">to</span>
                  <input
                    type="number"
                    min={1}
                    placeholder={String(source.chapterCount)}
                    value={customTo}
                    onChange={(event) => setCustomTo(event.target.value)}
                    className="h-10 w-24 rounded-control border border-line-strong bg-ground px-3 tabular-nums"
                  />
                </label>
              </div>
            ) : null}
          </fieldset>

          <div className="flex flex-wrap gap-4">
            <label className="flex min-w-[240px] flex-1 flex-col gap-1.5">
              <span className="font-semibold">Chapters per file</span>
              <input
                type="number"
                min={1}
                value={splitEvery}
                onChange={(event) => setSplitEvery(event.target.value)}
                className="h-11 w-32 rounded-control border border-line-strong bg-ground px-3 tabular-nums"
              />
            </label>
            <label className="flex min-w-[240px] flex-1 flex-col gap-1.5">
              <span className="font-semibold">File titles</span>
              <input
                type="text"
                value={titleTemplate}
                onChange={(event) => setTitleTemplate(event.target.value)}
                className="h-11 rounded-control border border-line-strong bg-ground px-3 font-mono text-[13px]"
              />
              <span className="text-xs text-ink-3">
                {'{n}'} is the file number. Numbering continues after the {book.existingFileCount}{' '}
                existing file
                {book.existingFileCount === 1 ? '' : 's'}.
              </span>
            </label>
          </div>

          <label className="flex items-start gap-2.5">
            <input
              type="checkbox"
              checked={addAutomatically}
              onChange={(event) => setAddAutomatically(event.target.checked)}
              className="mt-0.5"
            />
            <span>
              <strong className="font-semibold">
                Add finished files to this book automatically
              </strong>
              <br />
              <span className="text-[13px] text-ink-3">
                Each EPUB appears in the book's file list as soon as it is built, with no review
                step.
              </span>
            </span>
          </label>

          <p className="m-0 rounded-field border border-dashed border-line-strong px-3.5 py-3 text-ink-2 tabular-nums">
            You'll get{' '}
            <strong className="text-ink">
              {numberFormat.format(chapterCount(resolved))} chapters
            </strong>{' '}
            ({resolved.from}–{resolved.to}) in{' '}
            <strong className="text-ink">
              {planned.length} EPUB file{planned.length === 1 ? '' : 's'}
            </strong>
            {planned.length > 0 ? `: ${planned.map((file) => file.title).join(', ')}` : ''}.
          </p>
          {start.isError ? (
            <p role="alert" className="m-0 text-danger-ink">
              Could not start the download. Try again.
            </p>
          ) : null}
        </div>
      ) : null}

      {step === 'download' && job ? <DownloadProgress job={job} /> : null}
    </Dialog>
  )
}

function StepIndicator({ current }: { current: Step }) {
  const currentIndex = steps.findIndex((step) => step.id === current)
  return (
    <ol aria-label="Steps" className="m-0 mx-6 mt-4 grid list-none grid-cols-4 gap-2 p-0">
      {steps.map((step, index) => {
        const isCurrent = index === currentIndex
        const isDone = index < currentIndex
        return (
          <li
            key={step.id}
            aria-current={isCurrent ? 'step' : undefined}
            className={cn(
              'flex items-center gap-2 border-b-2 py-2.5',
              isCurrent && 'border-accent font-semibold text-ink',
              isDone && 'border-line-focus text-ink-2',
              !isCurrent && !isDone && 'border-line text-ink-disabled',
            )}
          >
            <span
              className={cn(
                'inline-flex size-[22px] items-center justify-center rounded-full border text-xs font-bold',
                isCurrent ? 'border-accent bg-accent text-accent-ink' : 'border-line-strong',
                isDone && 'bg-selected',
              )}
            >
              {isDone ? <Check aria-hidden="true" className="size-3" /> : index + 1}
            </span>
            {step.label}
          </li>
        )
      })}
    </ol>
  )
}

function ChoicePill({
  selected,
  onSelect,
  children,
}: {
  selected: boolean
  onSelect: () => void
  children: string
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        'h-8 rounded-full border px-3 text-[13px]',
        selected
          ? 'border-line-focus bg-selected font-semibold text-ink'
          : 'border-line text-ink-2 hover:text-ink',
      )}
    >
      {children}
    </button>
  )
}

function RadioMark({ selected }: { selected: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex size-[18px] shrink-0 items-center justify-center rounded-full border-[1.5px]',
        selected ? 'border-accent' : 'border-line-focus',
      )}
    >
      <span className={cn('size-2 rounded-full', selected ? 'bg-accent' : 'bg-transparent')} />
    </span>
  )
}

function SourceRow({
  source,
  chaptersRead,
  selected,
  onSelect,
}: {
  source: EpubCandidateSource
  chaptersRead: number
  selected: boolean
  onSelect: () => void
}) {
  const ahead = source.chapterCount > chaptersRead
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        'flex w-full flex-wrap items-center gap-3.5 border-0 border-t border-line px-4 py-3 text-left',
        selected
          ? 'bg-selected shadow-[inset_0_0_0_1px_var(--color-line-focus)]'
          : 'bg-transparent hover:bg-hover',
      )}
    >
      <RadioMark selected={selected} />
      <span className="min-w-[200px] flex-1">
        <span className="block font-semibold">{source.sourceName}</span>
        <span className="block truncate font-mono text-xs text-ink-3">{source.url}</span>
      </span>
      <span className="w-[150px] tabular-nums">
        <span className="block font-semibold">
          {numberFormat.format(source.chapterCount)} chapters
        </span>
        <span className="block text-xs text-ink-3">latest {source.latestChapterLabel}</span>
      </span>
      <span className="w-[130px] text-[13px] text-ink-2">
        updated {formatDistanceToNowStrict(new Date(source.updatedAt), { addSuffix: true })}
      </span>
      <span
        className={cn(
          'rounded-full px-2 py-0.5 text-xs font-semibold',
          ahead
            ? 'bg-status-finished-soft text-status-finished-ink'
            : 'bg-status-hold-soft text-status-hold-ink',
        )}
      >
        {ahead ? `Covers Ch. ${chaptersRead + 1}+` : 'Behind you'}
      </span>
    </button>
  )
}

function RangeOption({
  selected,
  onSelect,
  label,
  hint,
  suggested = false,
}: {
  selected: boolean
  onSelect: () => void
  label: string
  hint: string
  suggested?: boolean
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        'flex items-center gap-3 rounded-field border px-3.5 py-3 text-left',
        selected ? 'border-line-focus bg-selected' : 'border-line bg-transparent hover:bg-hover',
      )}
    >
      <RadioMark selected={selected} />
      <span className="flex-1">
        <span className="block font-semibold">{label}</span>
        <span className="block text-[13px] text-ink-3 tabular-nums">{hint}</span>
      </span>
      {suggested ? (
        <span className="rounded-full bg-raised px-2 py-0.5 text-xs font-semibold">Suggested</span>
      ) : null}
    </button>
  )
}

const stageLabels = [
  ['queued', 'Queued'],
  ['crawling', 'Crawling chapters'],
  ['building', 'Building EPUB files'],
  ['adding', 'Added to book'],
] as const

const fileStatusLabels: Record<EpubDownloadFile['status'], string> = {
  waiting: 'Waiting',
  crawling: 'Crawling',
  building: 'Building',
  added: 'Added',
}

function DownloadProgress({ job }: { job: EpubDownloadJob }) {
  const percent =
    job.chaptersTotal > 0 ? Math.round((job.chaptersDone / job.chaptersTotal) * 100) : 0
  const stageIndex = stageOrder(job.status)
  return (
    <div className="flex flex-col gap-4 px-6 py-5">
      <div className="flex flex-col gap-2">
        <div className="flex justify-between gap-3 tabular-nums">
          <strong>{headline(job)}</strong>
          <span className="text-ink-2">
            {job.chaptersDone} of {job.chaptersTotal} chapters
          </span>
        </div>
        <div
          role="progressbar"
          aria-label="Download progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          className="h-2 overflow-hidden rounded-full bg-line"
        >
          <div
            className={cn(
              'h-full rounded-full',
              job.status === 'completed' ? 'bg-status-finished' : 'bg-accent',
            )}
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>
      <ol className="m-0 grid list-none grid-cols-2 gap-2 p-0 sm:grid-cols-4">
        {stageLabels.map(([id, label], index) => (
          <li
            key={id}
            className={cn(
              'rounded-control px-3 py-2.5 text-[13px]',
              index < stageIndex &&
                'bg-status-finished-soft font-semibold text-status-finished-ink',
              index === stageIndex && 'border border-line-focus bg-selected font-semibold',
              index > stageIndex && 'border border-line text-ink-3',
            )}
          >
            {index < stageIndex ? '✓ ' : ''}
            {label}
          </li>
        ))}
      </ol>
      <div className="overflow-hidden rounded-field border border-line">
        <div className="bg-sunk px-3.5 py-2.5 text-xs font-semibold tracking-wider text-ink-3 uppercase">
          Files
        </div>
        <ul className="m-0 list-none p-0">
          {job.files.map((file) => (
            <li
              key={file.title}
              className="flex items-center gap-3 border-t border-line px-3.5 py-3"
            >
              <span className="flex-1">
                <strong>{file.title}</strong>{' '}
                <span className="font-mono text-xs text-ink-3 tabular-nums">
                  C{file.firstChapter} → C{file.lastChapter}
                </span>
              </span>
              <span className="text-[13px] text-ink-2 tabular-nums">
                {file.chaptersDone} / {file.lastChapter - file.firstChapter + 1}
              </span>
              <span
                className={cn(
                  'rounded-full px-2 py-0.5 text-xs font-semibold',
                  file.status === 'added'
                    ? 'bg-status-finished-soft text-status-finished-ink'
                    : 'bg-selected',
                )}
              >
                {fileStatusLabels[file.status]}
              </span>
            </li>
          ))}
        </ul>
      </div>
      {job.error ? (
        <p role="alert" className="m-0 text-danger-ink">
          {job.error}
        </p>
      ) : null}
      <p className="m-0 text-[13px] text-ink-3">
        You can close this window. The download keeps running and its progress shows in the book's
        EPUB panel.
      </p>
    </div>
  )
}

function stageOrder(status: EpubDownloadJob['status']): number {
  switch (status) {
    case 'queued':
      return 0
    case 'crawling':
      return 1
    case 'building':
      return 2
    case 'adding':
      return 3
    case 'completed':
      return 4
    case 'failed':
    case 'cancelled':
      return -1
  }
}

function headline(job: EpubDownloadJob): string {
  switch (job.status) {
    case 'queued':
      return 'Waiting for the crawler'
    case 'crawling':
      return `Downloading chapters from ${job.sourceName}`
    case 'building':
      return 'Building EPUB files'
    case 'adding':
      return 'Adding files to the book'
    case 'completed':
      return 'All files added to the book'
    case 'failed':
      return 'Download failed'
    case 'cancelled':
      return 'Download cancelled'
  }
}

function footerHint(step: Step, job: EpubDownloadJob | null): string {
  switch (step) {
    case 'search':
      return 'Runs through the crawler service.'
    case 'source':
      return 'Pick the source with the most chapters and recent updates.'
    case 'options':
      return 'Downloads run on the server; you can close this window.'
    case 'download':
      return job ? `Started ${new Date(job.startedAt).toLocaleTimeString()}` : ''
  }
}

function buildRange(kind: RangeKind, read: number, from: string, to: string): EpubChapterRange {
  switch (kind) {
    case 'all':
      return { kind: 'all' }
    case 'fromProgress':
      return { kind: 'fromProgress', from: read + 1 }
    case 'custom':
      return {
        kind: 'custom',
        from: Number(from) || 1,
        to: to.trim() === '' ? Number.MAX_SAFE_INTEGER : Number(to) || 1,
      }
  }
}

function rangeHint(range: { from: number; to: number }, label: string | null): string {
  const count = Math.max(0, range.to - range.from + 1)
  const position = label ? ` · you are at Ch. ${label}` : ''
  return `Chapters ${range.from}–${range.to} · ${numberFormat.format(count)} chapters${position}`
}

function countSources(candidates: { sources: unknown[] }[]): number {
  return candidates.reduce((total, novel) => total + novel.sources.length, 0)
}
