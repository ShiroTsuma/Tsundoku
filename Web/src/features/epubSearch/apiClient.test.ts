import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiRequest } from '@/api/http'
import { createApiEpubSearchClient } from './apiClient'
import type { EpubDownloadRequest } from './types'

vi.mock('@/api/http', () => ({ apiRequest: vi.fn() }))
const http = vi.mocked(apiRequest)
const result = { candidates: [], searchedSourceCount: 3, durationMs: 20, warnings: [] }

describe('crawler API client', () => {
  beforeEach(() => http.mockReset())

  it('refreshes the requested source and polls only its inspection job', async () => {
    const client = createApiEpubSearchClient()
    const request = {
      bookId: 'book-1',
      query: 'Test',
      scope: 'all' as const,
      sourceId: 'source-1',
      forceRefresh: true,
      refreshId: 'refresh-1',
    }
    http.mockResolvedValueOnce({ id: 'refresh-job', status: 'queued', result: null, error: null })
    await client.search(request)
    expect(http).toHaveBeenLastCalledWith('/book/book-1/epub-searches', {
      method: 'POST',
      body: { query: 'Test', scope: 'all', forceRefresh: true, sourceId: 'source-1' },
    })
    http.mockResolvedValueOnce({ id: 'refresh-job', status: 'completed', result, error: null })
    await client.search(request)
    expect(http).toHaveBeenLastCalledWith('/book/epub-searches/refresh-job', {})
  })

  it('returns queued progress immediately, before any match, then polls the same job', async () => {
    const client = createApiEpubSearchClient()
    http.mockResolvedValueOnce({ id: 'queued-search', status: 'queued', result: null, error: null })
    const request = { bookId: 'book-1', query: 'Test', scope: 'english' as const }
    expect(await client.search(request)).toMatchObject({ status: 'queued', candidates: [] })
    expect(http).toHaveBeenCalledTimes(1)
    http.mockResolvedValueOnce({
      id: 'queued-search',
      status: 'crawling',
      result: {
        ...result,
        currentSource: 'dobytranslations.com',
        totalSourceCount: 20,
        checkedLinkCount: 0,
        totalLinkCount: 1,
      },
      error: null,
    })
    expect(await client.search(request)).toMatchObject({
      status: 'crawling',
      currentSource: 'dobytranslations.com',
      totalLinkCount: 1,
    })
    expect(http.mock.calls[1]?.[0]).toBe('/book/epub-searches/queued-search')
  })

  it('rechecks saved results on reopening instead of retaining an expiring completed job id', async () => {
    const client = createApiEpubSearchClient()
    http.mockResolvedValueOnce({ id: 'search-1', status: 'completed', result, error: null })
    expect(await client.search({ bookId: 'book-1', query: 'Test', scope: 'english' })).toEqual({
      ...result,
      status: 'completed',
    })
    http.mockResolvedValueOnce({ id: 'search-1', status: 'completed', result, error: null })
    await client.search({ bookId: 'book-1', query: 'Test', scope: 'english' })
    expect(http.mock.calls[0]?.[0]).toBe('/book/book-1/epub-searches')
    expect(http.mock.calls[1]?.[0]).toBe('/book/book-1/epub-searches')
  })

  it('filters a shared all-language discovery to the requested English sources', async () => {
    const client = createApiEpubSearchClient()
    http.mockResolvedValue({
      id: 'shared-discovery',
      status: 'crawling',
      error: null,
      result: {
        ...result,
        candidates: [
          {
            id: 'novel',
            title: 'Test',
            match: 'title',
            sources: [
              { id: 'english', language: 'en' },
              { id: 'other', language: 'pt' },
            ],
          },
        ],
      },
    })
    const request = { bookId: 'book-1', query: 'Test', scope: 'english' as const }
    expect(
      (await client.search(request)).candidates[0]?.sources.map((source) => source.id),
    ).toEqual(['english'])
    await client.search(request)
    expect(http.mock.calls[1]?.[0]).toBe('/book/epub-searches/shared-discovery')
  })

  it('preserves partial results and source warnings', async () => {
    const client = createApiEpubSearchClient()
    const partial = {
      ...result,
      candidates: [{ id: 'novel', title: 'Test', match: 'title', sources: [] }],
      warnings: ['One source failed'],
    }
    http.mockResolvedValue({ id: 'search-1', status: 'crawling', result: partial, error: null })
    expect(await client.search({ bookId: 'book-1', query: 'Test', scope: 'all' })).toEqual({
      ...partial,
      status: 'crawling',
    })
  })

  it('reports failed searches without manufacturing empty successful results', async () => {
    http.mockResolvedValue({
      id: 'search-1',
      status: 'failed',
      result: null,
      error: 'Crawler unavailable',
    })
    await expect(
      createApiEpubSearchClient().search({ bookId: 'book-1', query: 'Test', scope: 'english' }),
    ).rejects.toThrow('Crawler unavailable')
  })

  it('passes download options and an idempotency key to the authenticated API', async () => {
    const request: EpubDownloadRequest = {
      bookId: 'book-1',
      sourceId: 'source-1',
      range: { kind: 'custom', from: 2, to: 5 },
      splitEvery: 2,
      titleTemplate: 'Part {n}',
      firstFileNumber: 3,
      regenerateAffectedVolumes: false,
    }
    http.mockResolvedValue({ id: 'download-1' })
    await createApiEpubSearchClient().startDownload(request)
    expect(http.mock.calls[0]?.[0]).toBe('/book/book-1/epub-downloads')
    expect(http.mock.calls[0]?.[1]?.method).toBe('POST')
    const body = http.mock.calls[0]?.[1]?.body as EpubDownloadRequest & { requestKey: string }
    expect(body.requestKey).toBeTypeOf('string')
    expect(body).toMatchObject(request)
  })

  it('can restore and cancel server jobs after a page reload', async () => {
    http.mockResolvedValue([])
    const client = createApiEpubSearchClient()
    await client.listDownloads?.('book-1')
    await client.cancelDownload('download-1')
    expect(http.mock.calls.map((call) => call[0])).toEqual([
      '/book/book-1/epub-downloads',
      '/book/epub-downloads/download-1/cancel',
    ])
  })
})
