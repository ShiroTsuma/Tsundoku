/**
 * Contract between the EPUB search UI and whatever finds and downloads EPUBs.
 *
 * Today the implementation is a mock (mockClient.ts + mockData.ts). The real
 * implementation will talk to the Tsundoku API, which proxies a
 * lightnovel-crawler (lncrawl) service. Keep these types stable: the UI only
 * depends on them, never on the mock.
 */

export type EpubSourceScope = 'english' | 'all'

export type EpubSearchRequest = {
  bookId: string
  query: string
  scope: EpubSourceScope
}

/** One site that hosts a novel, as returned by the crawler's search. */
export type EpubCandidateSource = {
  id: string
  sourceName: string
  url: string
  chapterCount: number
  latestChapterLabel: string
  /** ISO 8601 timestamp of the source's latest chapter. */
  updatedAt: string
  language: string
}

export type EpubCandidateMatch = 'title' | 'similar'

/** Search results are grouped by novel; each novel can be on several sources. */
export type EpubCandidateNovel = {
  id: string
  title: string
  match: EpubCandidateMatch
  sources: EpubCandidateSource[]
}

export type EpubSearchResult = {
  candidates: EpubCandidateNovel[]
  searchedSourceCount: number
  durationMs: number
}

export type EpubChapterRange =
  | { kind: 'all' }
  | { kind: 'fromProgress'; from: number }
  | { kind: 'custom'; from: number; to: number }

export type EpubDownloadRequest = {
  bookId: string
  sourceId: string
  range: EpubChapterRange
  /** Chapters per EPUB file. */
  splitEvery: number
  /** File title template; `{n}` is replaced by the file number. */
  titleTemplate: string
  /** Number to give the first new file (continues after existing files). */
  firstFileNumber: number
  addToBookAutomatically: boolean
}

export type EpubDownloadStatus =
  'queued' | 'crawling' | 'building' | 'adding' | 'completed' | 'failed' | 'cancelled'

export type EpubDownloadFileStatus = 'waiting' | 'crawling' | 'building' | 'added'

export type EpubDownloadFile = {
  title: string
  firstChapter: number
  lastChapter: number
  chaptersDone: number
  status: EpubDownloadFileStatus
}

export type EpubDownloadJob = {
  id: string
  bookId: string
  sourceName: string
  status: EpubDownloadStatus
  chaptersDone: number
  chaptersTotal: number
  files: EpubDownloadFile[]
  startedAt: string
  error: string | null
}

export type EpubSearchClient = {
  search: (request: EpubSearchRequest, signal?: AbortSignal) => Promise<EpubSearchResult>
  startDownload: (request: EpubDownloadRequest) => Promise<EpubDownloadJob>
  getDownload: (jobId: string) => Promise<EpubDownloadJob>
  cancelDownload: (jobId: string) => Promise<EpubDownloadJob>
}

export const terminalDownloadStatuses: readonly EpubDownloadStatus[] = [
  'completed',
  'failed',
  'cancelled',
]

export function isDownloadFinished(status: EpubDownloadStatus): boolean {
  return terminalDownloadStatuses.includes(status)
}
