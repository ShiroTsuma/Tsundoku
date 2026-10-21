import { skipToken, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEpubSearchClient } from './clientContext'
import type { EpubDownloadJob, EpubDownloadRequest, EpubSearchRequest } from './types'
import { isDownloadFinished, isSearchFinished } from './types'
import { getStoredSessionUserId } from '@/api/http'

export const epubSearchKeys = {
  all: ['epub-search'] as const,
  search: (request: EpubSearchRequest) => ['epub-search', 'search', request] as const,
  download: (jobId: string) => ['epub-search', 'download', jobId] as const,
  ownerDownloads: (ownerId: string) => ['epub-search', 'owner-downloads', ownerId] as const,
}

/** Polling interval for a running download. */
export const downloadPollMs = 1000

export function useEpubSearch(request: EpubSearchRequest | null) {
  const client = useEpubSearchClient()
  return useQuery({
    queryKey: request ? epubSearchKeys.search(request) : epubSearchKeys.all,
    queryFn: request ? ({ signal }) => client.search(request, signal) : skipToken,
    // Reopening reads current saved metadata from our API; the server decides
    // whether any crawler work is needed. Completed job IDs can expire.
    staleTime: 0,
    refetchOnWindowFocus: false,
    refetchInterval: (query) => {
      const status = query.state.data?.status
      return status && !isSearchFinished(status) ? 2000 : false
    },
  })
}

export function useStartEpubDownload() {
  const client = useEpubSearchClient()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (request: EpubDownloadRequest) => client.startDownload(request),
    onSuccess: (job) => {
      queryClient.setQueryData(epubSearchKeys.download(job.id), job)
      const ownerId = getStoredSessionUserId()
      if (ownerId) {
        const key = epubSearchKeys.ownerDownloads(ownerId)
        queryClient.setQueryData<EpubDownloadJob[]>(key, (jobs = []) => [
          ...jobs.filter((item) => item.id !== job.id),
          job,
        ])
        void queryClient.invalidateQueries({ queryKey: key })
      }
    },
  })
}

export function useEpubDownload(jobId: string | null) {
  const client = useEpubSearchClient()
  return useQuery({
    queryKey: jobId ? epubSearchKeys.download(jobId) : epubSearchKeys.all,
    queryFn: jobId ? () => client.getDownload(jobId) : skipToken,
    refetchInterval: (query) => {
      const job: EpubDownloadJob | undefined = query.state.data
      return job && isDownloadFinished(job.status) ? false : downloadPollMs
    },
  })
}

export function useCancelEpubDownload() {
  const client = useEpubSearchClient()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (jobId: string) => client.cancelDownload(jobId),
    onSuccess: (job) => {
      queryClient.setQueryData(epubSearchKeys.download(job.id), job)
    },
  })
}

export function useEpubDownloads(bookId: string) {
  const client = useEpubSearchClient()
  const list = client.listDownloads
  return useQuery({
    queryKey: ['epub-downloads', bookId],
    queryFn: list ? () => list(bookId) : skipToken,
    refetchInterval: 5000,
    retry: false,
  })
}
