import { apiRequest } from '@/api/http'
import type {
  EpubDownloadJob,
  EpubSearchClient,
  EpubSearchRequest,
  EpubSearchResult,
} from './types'
import { isDownloadFinished, isSearchFinished } from './types'

type SearchJob = {
  id: string
  status: string
  result: EpubSearchResult | null
  error: string | null
}

export function createApiEpubSearchClient(): EpubSearchClient {
  const searches = new Map<string, string>()
  const downloads = new Map<string, { key: string; jobId?: string }>()
  async function search(
    request: EpubSearchRequest,
    signal?: AbortSignal,
  ): Promise<EpubSearchResult> {
    const key = JSON.stringify(request)
    let id = searches.get(key)
    let job: SearchJob
    if (!id) {
      job = await apiRequest<SearchJob>(`/book/${request.bookId}/epub-searches`, {
        method: 'POST',
        body: {
          query: request.query,
          scope: request.scope,
          forceRefresh: request.forceRefresh ?? false,
          ...(request.sourceId ? { sourceId: request.sourceId } : {}),
        },
        ...(signal ? { signal } : {}),
      })
      id = job.id
      const oldest = searches.keys().next().value
      if (searches.size >= 100 && oldest) searches.delete(oldest)
      searches.set(key, id)
    } else job = await apiRequest<SearchJob>(`/book/epub-searches/${id}`, signal ? { signal } : {})
    if (job.status === 'failed' && !job.result?.candidates.length) {
      searches.delete(key)
      throw new Error(job.error ?? 'The crawler could not search the sources.')
    }
    if (isSearchFinished(job.status)) searches.delete(key)
    const result = job.result ?? { candidates: [], searchedSourceCount: 0, durationMs: 0 }
    return {
      ...result,
      candidates:
        request.scope === 'english'
          ? result.candidates
              .map((candidate) => ({
                ...candidate,
                sources: candidate.sources.filter((source) => source.language === 'en'),
              }))
              .filter((candidate) => candidate.sources.length > 0)
          : result.candidates,
      status: job.status,
    }
  }
  return {
    search,
    startDownload: async (request) => {
      const fingerprint = JSON.stringify(request)
      let operation = downloads.get(fingerprint)
      if (!operation) {
        operation = { key: crypto.randomUUID() }
        downloads.set(fingerprint, operation)
      }
      const job = await apiRequest<EpubDownloadJob>(`/book/${request.bookId}/epub-downloads`, {
        method: 'POST',
        body: { ...request, requestKey: operation.key },
      })
      operation.jobId = job.id
      return job
    },
    getDownload: async (id) => {
      const job = await apiRequest<EpubDownloadJob>(`/book/epub-downloads/${id}`)
      if (isDownloadFinished(job.status)) {
        for (const [fingerprint, operation] of downloads) {
          if (operation.jobId === id) downloads.delete(fingerprint)
        }
      }
      return job
    },
    cancelDownload: (id) =>
      apiRequest<EpubDownloadJob>(`/book/epub-downloads/${id}/cancel`, { method: 'POST' }),
    listDownloads: (bookId) => apiRequest<EpubDownloadJob[]>(`/book/${bookId}/epub-downloads`),
    listOwnerDownloads: () => apiRequest<EpubDownloadJob[]>('/book/epub-downloads'),
  }
}
