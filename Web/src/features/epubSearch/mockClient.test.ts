import { describe, expect, it } from 'vitest'
import { createMockEpubSearchClient } from './mockClient'
import type { EpubDownloadRequest } from './types'

function setup() {
  let now = 1_000_000
  const client = createMockEpubSearchClient({
    now: () => now,
    wait: () => Promise.resolve(),
    msPerChapter: 10,
  })
  return {
    client,
    advance: (ms: number) => {
      now += ms
    },
  }
}

const request: EpubDownloadRequest = {
  bookId: 'book-1',
  sourceId: 'source-a',
  range: { kind: 'fromProgress', from: 167 },
  splitEvery: 100,
  titleTemplate: 'Volume {n}',
  firstFileNumber: 4,
  regenerateAffectedVolumes: true,
}

describe('mock EPUB search client', () => {
  it('returns candidates titled after the query', async () => {
    const { client } = setup()
    const result = await client.search({
      bookId: 'book-1',
      query: 'Super Soldier',
      scope: 'english',
    })
    expect(result.candidates[0]?.title).toBe('Super Soldier')
    expect(result.candidates[0]?.sources.length).toBeGreaterThan(0)
  })

  it('returns nothing for an empty query', async () => {
    const { client } = setup()
    const result = await client.search({ bookId: 'book-1', query: '  ', scope: 'all' })
    expect(result.candidates).toEqual([])
  })

  it('advances a download over time until every file is added', async () => {
    const { client, advance } = setup()
    const started = await client.startDownload(request)
    expect(started.status).toBe('queued')
    expect(started.chaptersTotal).toBe(145)
    expect(started.files.map((file) => file.title)).toEqual(['Volume 4', 'Volume 5'])

    advance(400 + 50 * 10)
    const crawling = await client.getDownload(started.id)
    expect(crawling.status).toBe('crawling')
    expect(crawling.chaptersDone).toBe(50)
    expect(crawling.files[0]?.status).toBe('crawling')
    expect(crawling.files[1]?.status).toBe('waiting')

    advance(10_000)
    const done = await client.getDownload(started.id)
    expect(done.status).toBe('completed')
    expect(done.files.every((file) => file.status === 'added')).toBe(true)
  })

  it('stops progress when cancelled', async () => {
    const { client, advance } = setup()
    const started = await client.startDownload(request)
    advance(400 + 20 * 10)
    const cancelled = await client.cancelDownload(started.id)
    advance(10_000)
    const later = await client.getDownload(started.id)
    expect(cancelled.status).toBe('cancelled')
    expect(later.chaptersDone).toBe(20)
  })

  it('rejects unknown sources', async () => {
    const { client } = setup()
    await expect(client.startDownload({ ...request, sourceId: 'nope' })).rejects.toThrow(
      'Unknown source',
    )
  })
})
