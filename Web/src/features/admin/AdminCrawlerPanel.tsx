import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { ListBox, Pill, StateBox, listRowClass } from '@/components/ui/ListParts'
import { SegmentButton } from '@/features/books/BookListControls'
import {
  jobKindLabels,
  jobProgress,
  jobStatusLabel,
  useAdminCrawlerActivity,
} from '@/features/epubSearch/crawlerMonitor'
import { CrawlerProcessingControl } from './CrawlerProcessingControl'
import { CrawlerSourcesPanel } from './CrawlerSourcesPanel'

const segmentGroupClass = 'flex w-fit gap-0.5 rounded-field border border-line bg-surface p-[3px]'
const activityFilters = [
  { id: 'active', label: 'Active queue' },
  { id: 'recent', label: 'Recent jobs' },
  { id: 'failed', label: 'Failed jobs' },
] as const
type ActivityFilter = (typeof activityFilters)[number]['id']

export function AdminCrawlerPanel() {
  const [section, setSection] = useState<'activity' | 'sources'>('activity')
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <CrawlerProcessingControl />
      <div aria-label="Crawler view" role="group" className={segmentGroupClass}>
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
  const [filter, setFilter] = useState<ActivityFilter>('active')
  const query = useAdminCrawlerActivity(filter)
  const data = query.data?.pages[0]
  const jobs = [
    ...new Map(
      query.data?.pages.flatMap((page) => page.jobs).map((job) => [job.id, job]) ?? [],
    ).values(),
  ]
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div aria-label="Crawler jobs filter" role="group" className={segmentGroupClass}>
          {activityFilters.map((item) => (
            <SegmentButton
              key={item.id}
              pressed={filter === item.id}
              onClick={() => setFilter(item.id)}
            >
              {item.label}
            </SegmentButton>
          ))}
        </div>
        <Button size="sm" variant="ghost" onClick={() => void query.refetch()}>
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
            <ListBox label="Crawler jobs" pages={query}>
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
                      <Pill tone={job.status === 'completed' ? 'good' : 'neutral'}>
                        {jobStatusLabel(job)}
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
            </ListBox>
          ) : (
            <StateBox>No {filter} crawler jobs.</StateBox>
          )}
          <span className="text-xs text-ink-3">
            {jobs.length} of {data.totalJobs} jobs
          </span>
        </>
      ) : null}
    </div>
  )
}
