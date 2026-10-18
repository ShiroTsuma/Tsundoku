/**
 * In-memory stand-in for the EPUB crawler service. Nothing leaves the browser.
 * Download progress is derived from elapsed time, so it advances by itself.
 * The UI can poll it exactly as it will poll the real API.
 */
import { chapterCount, planFiles, resolveRange } from './downloadPlan'
import {
  mockCandidates,
  mockMsPerChapter,
  mockSearchDelayMs,
  mockSearchedSourceCount,
} from './mockData'
import type {
  EpubCandidateNovel,
  EpubCandidateSource,
  EpubDownloadFile,
  EpubDownloadJob,
  EpubDownloadRequest,
  EpubDownloadStatus,
  EpubSearchClient,
  EpubSearchRequest,
  EpubSearchResult,
} from './types'

const queueMs = 400
const buildMs = 500

type StoredJob = {
  id: string
  request: EpubDownloadRequest
  source: EpubCandidateSource
  startedAtMs: number
  cancelledAtMs: number | null
}

export type MockClientOptions = {
  now?: () => number
  wait?: (ms: number, signal?: AbortSignal) => Promise<void>
  msPerChapter?: number
}

export function createMockEpubSearchClient(options: MockClientOptions = {}): EpubSearchClient {
  const now = options.now ?? (() => Date.now())
  const wait = options.wait ?? defaultWait
  const msPerChapter = options.msPerChapter ?? mockMsPerChapter
  const jobs = new Map<string, StoredJob>()
  let nextJobNumber = 1

  function findSource(sourceId: string): EpubCandidateSource | undefined {
    for (const novel of mockCandidates) {
      const source = novel.sources.find((candidate) => candidate.id === sourceId)
      if (source) return source
    }
    return undefined
  }

  function snapshot(job: StoredJob): EpubDownloadJob {
    const range = resolveRange(job.request.range, job.source.chapterCount ?? 0)
    const planned = planFiles(
      range,
      job.request.splitEvery,
      job.request.titleTemplate,
      job.request.firstFileNumber,
    )
    const stopMs = job.cancelledAtMs ?? now()
    const elapsed = Math.max(0, stopMs - job.startedAtMs - queueMs)
    const crawled = Math.min(chapterCount(range), Math.floor(elapsed / msPerChapter))

    const files: EpubDownloadFile[] = planned.map((file) => {
      const offset = file.firstChapter - range.from
      const size = file.lastChapter - file.firstChapter + 1
      const done = Math.min(size, Math.max(0, crawled - offset))
      const crawlEndMs = (offset + size) * msPerChapter
      let status: EpubDownloadFile['status'] = 'waiting'
      if (done >= size) {
        status = elapsed >= crawlEndMs + buildMs ? 'added' : 'building'
      } else if (done > 0) {
        status = 'crawling'
      }
      return { ...file, chaptersDone: done, status }
    })

    return {
      id: job.id,
      bookId: job.request.bookId,
      sourceName: job.source.sourceName,
      status: overallStatus(job, files, now() - job.startedAtMs),
      chaptersDone: crawled,
      chaptersTotal: chapterCount(range),
      files,
      startedAt: new Date(job.startedAtMs).toISOString(),
      error: null,
    }
  }

  return {
    async search(request: EpubSearchRequest, signal?: AbortSignal): Promise<EpubSearchResult> {
      await wait(mockSearchDelayMs, signal)
      const query = request.query.trim()
      const candidates: EpubCandidateNovel[] = mockCandidates.map((novel) => ({
        ...novel,
        title: novel.title.replaceAll('{query}', query),
        sources: novel.sources.filter(
          (source) =>
            (!request.sourceId || source.id === request.sourceId) &&
            (request.scope === 'all' || source.language === 'en'),
        ),
      }))
      return {
        status: 'completed',
        candidates: query.length > 0 ? candidates : [],
        searchedSourceCount:
          request.scope === 'all' ? mockSearchedSourceCount * 3 : mockSearchedSourceCount,
        durationMs: mockSearchDelayMs,
      }
    },

    startDownload(request: EpubDownloadRequest): Promise<EpubDownloadJob> {
      const source = findSource(request.sourceId)
      if (!source) {
        return Promise.reject(new Error(`Unknown source "${request.sourceId}".`))
      }
      const job: StoredJob = {
        id: `mock-job-${nextJobNumber}`,
        request,
        source,
        startedAtMs: now(),
        cancelledAtMs: null,
      }
      nextJobNumber += 1
      jobs.set(job.id, job)
      return Promise.resolve(snapshot(job))
    },

    getDownload(jobId: string): Promise<EpubDownloadJob> {
      const job = jobs.get(jobId)
      return job ? Promise.resolve(snapshot(job)) : Promise.reject(new Error('Download not found.'))
    },

    cancelDownload(jobId: string): Promise<EpubDownloadJob> {
      const job = jobs.get(jobId)
      if (!job) return Promise.reject(new Error('Download not found.'))
      job.cancelledAtMs ??= now()
      return Promise.resolve(snapshot(job))
    },
  }
}

function overallStatus(
  job: StoredJob,
  files: EpubDownloadFile[],
  sinceStartMs: number,
): EpubDownloadStatus {
  if (job.cancelledAtMs !== null) return 'cancelled'
  if (sinceStartMs < queueMs) return 'queued'
  if (files.every((file) => file.status === 'added' || file.status === 'ready')) return 'completed'
  if (files.some((file) => file.status === 'crawling' || file.status === 'waiting'))
    return 'crawling'
  return 'adding'
}

function defaultWait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(new DOMException('Aborted', 'AbortError'))
      },
      { once: true },
    )
  })
}
