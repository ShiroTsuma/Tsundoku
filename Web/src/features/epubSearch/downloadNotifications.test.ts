import { describe, expect, it } from 'vitest'
import { observeDownloads } from './downloadNotifications'
import type { EpubDownloadJob } from './types'

const job: EpubDownloadJob = {
  id: 'job-1',
  bookId: 'book-1',
  bookTitle: 'Blood Servant',
  sourceName: 'Doby',
  status: 'crawling',
  chaptersDone: 0,
  chaptersTotal: 200,
  files: [1, 2].map((n) => ({
    title: `Volume ${n}`,
    firstChapter: n * 100 - 99,
    lastChapter: n * 100,
    chaptersDone: 0,
    status: 'waiting',
  })),
  startedAt: '2026-10-17T12:00:00Z',
  error: null,
}

describe('global EPUB download notifications', () => {
  it('announces each volume once and the complete download, including after reload', () => {
    const initial = observeDownloads([job], {}).state
    const first = {
      ...job,
      files: job.files.map((file, i) => (i === 0 ? { ...file, status: 'added' as const } : file)),
    }
    const volume = observeDownloads([first], initial)
    expect(volume.notices).toMatchObject([
      { title: 'Volume 1 added to the book', bookId: job.bookId },
    ])
    expect(observeDownloads([first], volume.state).notices).toEqual([])
    const restored = JSON.parse(JSON.stringify(volume.state)) as typeof volume.state
    const complete = {
      ...first,
      status: 'completed' as const,
      files: first.files.map((file) => ({ ...file, status: 'added' as const })),
    }
    const finished = observeDownloads([complete], restored)
    expect(finished.notices).toMatchObject([
      {
        title: 'EPUB download completed',
        description: 'Blood Servant · 2 files added to the book',
      },
    ])
    expect(observeDownloads([complete], finished.state).notices).toEqual([])
  })

  it('does not replay historical finished downloads on initial login', () => {
    expect(observeDownloads([{ ...job, status: 'completed' }], {}).notices).toEqual([])
  })

  it('waits for automatic attachment before announcing a generated file', () => {
    const initial = observeDownloads([job], {}).state
    const staged = {
      ...job,
      files: job.files.map((file, i) => (i === 0 ? { ...file, status: 'ready' as const } : file)),
    }
    const waiting = observeDownloads([staged], initial)
    expect(waiting.notices).toEqual([])
    const added = {
      ...staged,
      files: staged.files.map((file, i) =>
        i === 0 ? { ...file, status: 'added' as const } : file,
      ),
    }
    expect(observeDownloads([added], waiting.state).notices[0]?.title).toBe(
      'Volume 1 added to the book',
    )
  })

  it('does not notify for pauses or cancellation and reports failure once', () => {
    const initial = observeDownloads([job], {}).state
    expect(
      observeDownloads([{ ...job, status: 'queued', retryAttempt: 1 }], initial).notices,
    ).toEqual([])
    expect(observeDownloads([{ ...job, status: 'cancelled' }], initial).notices).toEqual([])
    const failed = observeDownloads(
      [{ ...job, status: 'failed', error: 'Source unavailable' }],
      initial,
    )
    expect(failed.notices).toMatchObject([{ title: 'EPUB download failed', error: true }])
    expect(observeDownloads([{ ...job, status: 'failed' }], failed.state).notices).toEqual([])
  })
})
