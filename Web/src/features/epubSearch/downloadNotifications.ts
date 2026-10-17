import { isDownloadFinished, type EpubDownloadJob } from './types'

type ObservedJob = { ready: number[]; terminal: boolean; seenAt: number }
export type DownloadNotificationState = Record<string, ObservedJob>
export type DownloadNotice = {
  id: string
  bookId: string
  title: string
  description: string
  error: boolean
}

export function observeDownloads(
  jobs: EpubDownloadJob[],
  previous: DownloadNotificationState,
  now = Date.now(),
): { state: DownloadNotificationState; notices: DownloadNotice[] } {
  const state = Object.fromEntries(
    Object.entries(previous).filter(([, value]) => now - value.seenAt < 7 * 86400000),
  )
  const notices: DownloadNotice[] = []
  for (const job of jobs) {
    const before = state[job.id]
    const ready = job.files.flatMap((file, index) =>
      file.status === 'ready' || file.status === 'added' ? [index] : [],
    )
    const terminal = isDownloadFinished(job.status)
    const book = job.bookTitle ?? job.sourceName
    const finishedNow = before && !before.terminal && terminal
    if (finishedNow && job.status === 'completed') {
      notices.push({
        id: `epub-${job.id}-completed`,
        bookId: job.bookId,
        title: 'EPUB download completed',
        description: `${book} · ${ready.length} ${ready.length === 1 ? 'file' : 'files'}${job.files.some((file) => file.status === 'ready') ? ' ready to review' : ' added to the book'}`,
        error: false,
      })
    } else if (before) {
      for (const index of ready.filter((index) => !before.ready.includes(index))) {
        const file = job.files[index]
        if (!file) continue
        notices.push({
          id: `epub-${job.id}-file-${index}`,
          bookId: job.bookId,
          title: `${file.title} ${file.status === 'added' ? 'added to the book' : 'ready to review'}`,
          description: book,
          error: false,
        })
      }
    }
    if (finishedNow && job.status === 'failed') {
      notices.push({
        id: `epub-${job.id}-failed`,
        bookId: job.bookId,
        title: 'EPUB download failed',
        description: `${book} · ${job.error ?? 'Finished files remain available.'}`,
        error: true,
      })
    }
    state[job.id] = {
      ready: [...new Set([...(before?.ready ?? []), ...ready])],
      terminal: terminal || (before?.terminal ?? false),
      seenAt: now,
    }
  }
  return { state, notices }
}
