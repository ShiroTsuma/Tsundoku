import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { apiRequest, getStoredSessionUserId } from '@/api/http'

export type CrawlerMonitorJob = {
  id: string
  bookId: string
  bookTitle: string
  username: string | null
  kind: string
  status: string
  createdAtUtc: string
  nextAttemptAtUtc: string
  retryAttempt: number
  nextRetryAt: string | null
  currentSource: string | null
  searchedSourceCount: number
  totalSourceCount: number
  checkedLinkCount: number
  totalLinkCount: number
  chaptersDone: number
  chaptersTotal: number
  readyFiles: number
  totalFiles: number
  warnings: string[]
  error: string | null
}
export type CrawlerMonitorSnapshot = {
  processingEnabled?: boolean
  enabled: boolean
  observedAtUtc: string
  totalBooks: number
  checkedBooks: number
  pendingBooks: number
  runningJobs: number
  waitingJobs: number
  trackedSources: number
  totalJobs: number
  skip: number
  take: number
  jobs: CrawlerMonitorJob[]
}

export function useCrawlerMonitor() {
  return useQuery({
    queryKey: ['crawler-monitor', getStoredSessionUserId()],
    queryFn: ({ signal }) => apiRequest<CrawlerMonitorSnapshot>('/book/crawler-status', { signal }),
    refetchInterval: 5000,
    staleTime: 3000,
    retry: false,
  })
}

export function useAdminCrawlerActivity(filter: string) {
  return useInfiniteQuery({
    queryKey: ['crawler-monitor', getStoredSessionUserId(), 'admin-activity', filter],
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) =>
      apiRequest<CrawlerMonitorSnapshot>(
        `/admin/crawler?filter=${filter}&skip=${pageParam}&take=50`,
        { signal },
      ),
    getNextPageParam: (last) =>
      last.jobs.length && last.skip + last.take < last.totalJobs
        ? last.skip + last.take
        : undefined,
    refetchInterval: 5000,
    staleTime: 3000,
    retry: false,
  })
}

export function retryLabel(nextRetryAt: string, attempt = 1) {
  const seconds = Math.max(0, Math.ceil((Date.parse(nextRetryAt) - Date.now()) / 1000))
  return `Retry ${attempt}/5 ${seconds > 0 ? `in ${seconds >= 60 ? `${Math.ceil(seconds / 60)} min` : `${seconds} sec`}` : 'starting shortly'}`
}

export function jobProgress(job: CrawlerMonitorJob) {
  const progress =
    job.kind === 'download'
      ? `${job.chaptersDone}/${job.chaptersTotal} chapters · ${job.readyFiles}/${job.totalFiles} files`
      : job.kind === 'scan'
        ? `${job.currentSource ? `${job.currentSource} · ` : ''}Chapter index refresh`
        : `${job.searchedSourceCount}/${job.totalSourceCount || '?'} sources checked${job.totalLinkCount ? ` · saved links ${job.checkedLinkCount}/${job.totalLinkCount}` : ''}`
  return job.nextRetryAt
    ? `${progress} · ${retryLabel(job.nextRetryAt, job.retryAttempt)}`
    : progress
}

const jobStatusLabels: Record<string, string> = {
  queued: 'Queued',
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
}

export function jobStatusLabel(job: CrawlerMonitorJob) {
  if (job.nextRetryAt) return 'Waiting to retry'
  if (job.status === 'completed' && job.warnings.length) return 'Completed with warnings'
  return jobStatusLabels[job.status] ?? job.status
}

export const jobKindLabels: Record<string, string> = {
  search: 'Manual search',
  discovery: 'Find sources',
  scan: 'Chapter update',
  download: 'EPUB download',
}
