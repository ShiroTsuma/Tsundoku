import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { ListBox, Pill, StateBox, listRowClass } from '@/components/ui/ListParts'
import {
  jobKindLabels,
  jobProgress,
  useAdminCrawlerActivity,
} from '@/features/epubSearch/crawlerMonitor'
import { CrawlerSourcesPanel } from './CrawlerSourcesPanel'
import { CrawlerProcessingControl } from './CrawlerProcessingControl'
import { SegmentButton } from '@/features/books/BookListControls'

export function AdminCrawlerPanel() {
  const [section, setSection] = useState('activity')
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <CrawlerProcessingControl />
      <div
        aria-label="Crawler view"
        role="group"
        className="flex w-fit gap-0.5 rounded-field border border-line bg-surface p-[3px]"
      >
        {(['activity', 'sources'] as const).map((value) => (
          <SegmentButton key={value} pressed={section === value} onClick={() => setSection(value)}>
            {value === 'activity' ? 'Activity' : 'Sources'}
          </SegmentButton>
        ))}
      </div>
      {section === 'sources' ? <CrawlerSourcesPanel /> : <CrawlerActivityPanel />}
    </div>
  )
}

function CrawlerActivityPanel() {
  const [filter, setFilter] = useState('active')
  const query = useAdminCrawlerActivity(filter)
  const data = query.data?.pages[0]
  const jobs = [
    ...new Map(
      query.data?.pages.flatMap((page) => page.jobs).map((job) => [job.id, job]) ?? [],
    ).values(),
  ]
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {(['active', 'recent', 'failed'] as const).map((value) => (
          <Button
            key={value}
            variant={filter === value ? 'primary' : 'outline'}
            size="sm"
            aria-pressed={filter === value}
            onClick={() => {
              setFilter(value)
            }}
          >
            {value === 'active'
              ? 'Active queue'
              : value === 'recent'
                ? 'Recent jobs'
                : 'Failed jobs'}
          </Button>
        ))}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            void query.refetch()
          }}
        >
          Refresh
        </Button>
        <span className="text-xs text-ink-3">All accounts · refreshes every 5 seconds</span>
      </div>
      {query.isPending ? (
        <StateBox>Loading crawler activity…</StateBox>
      ) : query.isError && !data ? (
        <StateBox tone="error">Could not load crawler activity.</StateBox>
      ) : data ? (
        <>
          <div className="flex flex-wrap gap-2" aria-label="Crawler summary">
            <Pill tone="good">
              {data.checkedBooks}/{data.totalBooks} books checked
            </Pill>
            <Pill>{data.pendingBooks} books awaiting metadata</Pill>
            <Pill>{data.runningJobs} running</Pill>
            <Pill>{data.waitingJobs} waiting</Pill>
            <Pill>{data.trackedSources} tracked sources</Pill>
          </div>
          <p className="m-0 text-[13px] text-ink-3">
            Initial metadata discovery checks the newest books first. Manual searches and downloads
            take priority. A source cooldown preserves results already found.
          </p>
          {jobs.length ? (
            <ListBox
              label="Crawler jobs"
              busy={query.isFetchingNextPage}
              onScroll={(event) => {
                const element = event.currentTarget
                if (
                  element.scrollHeight - element.scrollTop - element.clientHeight < 300 &&
                  query.hasNextPage &&
                  !query.isFetchingNextPage &&
                  !query.isFetchNextPageError
                )
                  void query.fetchNextPage()
              }}
            >
              {jobs.map((job) => (
                <article key={job.id} className={listRowClass}>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        className="font-semibold text-ink underline decoration-line-strong underline-offset-4"
                        to={`/admin/books/${job.bookId}/edit`}
                      >
                        {job.bookTitle}
                      </Link>
                      <Pill>{jobKindLabels[job.kind] ?? job.kind}</Pill>
                      <Pill>
                        {job.nextRetryAt
                          ? 'Waiting to retry'
                          : job.status === 'completed' && job.warnings.length
                            ? 'Success with warnings'
                            : job.status}
                      </Pill>
                    </div>
                    <p className="m-0 mt-1 text-[13px] text-ink-2">
                      {job.username ?? 'Unknown account'} · {jobProgress(job)}
                    </p>
                    {job.currentSource ? (
                      <p className="m-0 mt-1 break-words text-[13px] text-ink-3">
                        {job.currentSource}
                      </p>
                    ) : null}
                    {job.error ? (
                      <p role="alert" className="m-0 mt-1 text-[13px] text-danger-ink">
                        {job.error}
                      </p>
                    ) : null}
                    <details className="mt-2 text-xs text-ink-3">
                      <summary className="cursor-pointer">
                        Job details
                        {job.warnings.length ? ` · ${job.warnings.length} source issues` : ''}
                      </summary>
                      <dl className="my-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                        <dt>Job</dt>
                        <dd className="m-0 break-all font-mono">{job.id}</dd>
                        <dt>Created</dt>
                        <dd className="m-0">{new Date(job.createdAtUtc).toLocaleString()}</dd>
                        <dt>Next check</dt>
                        <dd className="m-0">
                          {new Date(job.nextRetryAt ?? job.nextAttemptAtUtc).toLocaleString()}
                        </dd>
                      </dl>
                      <ul className="m-0 flex flex-col gap-1 pl-5">
                        {job.warnings.map((warning, i) => (
                          <li key={`${i}-${warning}`} className="break-words">
                            {warning}
                          </li>
                        ))}
                      </ul>
                    </details>
                  </div>
                </article>
              ))}
              {query.isFetchingNextPage ? (
                <p role="status" className="m-0 px-4 py-3 text-sm text-ink-3">
                  Loading more jobs…
                </p>
              ) : null}
              {query.isFetchNextPageError ? (
                <div className="flex items-center gap-3 px-4 py-3 text-sm text-danger-ink">
                  Could not load more jobs.
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      void query.fetchNextPage()
                    }}
                  >
                    Retry
                  </Button>
                </div>
              ) : null}
            </ListBox>
          ) : (
            <StateBox>
              No {filter === 'active' ? 'active' : filter === 'failed' ? 'failed' : 'recent'}{' '}
              crawler jobs.
            </StateBox>
          )}
          <span className="text-xs text-ink-3">
            {jobs.length} of {data.totalJobs} jobs
          </span>
        </>
      ) : null}
    </div>
  )
}
