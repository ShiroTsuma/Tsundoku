import type { EpubChapterRange, EpubExistingVolume } from './types'

export type PlannedFile = {
  replacesFileId?: string
  title: string
  firstChapter: number
  lastChapter: number
}

export type ResolvedRange = {
  from: number
  to: number
}

/** Clamp a requested range to the chapters the source actually has. */
export function resolveRange(range: EpubChapterRange, sourceChapterCount: number): ResolvedRange {
  const last = Math.max(0, Math.floor(sourceChapterCount))
  switch (range.kind) {
    case 'all':
      return { from: 1, to: last }
    case 'fromProgress':
      return { from: clamp(range.from, 1, last + 1), to: last }
    case 'custom': {
      const from = clamp(range.from, 1, last)
      return { from, to: clamp(range.to, from, last) }
    }
  }
}

export function chapterCount(range: ResolvedRange): number {
  return Math.max(0, range.to - range.from + 1)
}

/** Split a chapter range into EPUB files of at most `splitEvery` chapters. */
export function planFiles(
  range: ResolvedRange,
  splitEvery: number,
  titleTemplate: string,
  firstFileNumber: number,
  existing: EpubExistingVolume[] = [],
): PlannedFile[] {
  const size = Math.max(1, Math.floor(splitEvery))
  const files: PlannedFile[] = []
  let number = firstFileNumber
  const affected = existing.find(
    (volume) => volume.firstChapter <= range.from && volume.lastChapter + 1 >= range.from,
  )
  for (let first = affected?.firstChapter ?? range.from; first <= range.to; first += size) {
    const last = Math.min(range.to, first + size - 1)
    const previous = existing.find((volume) => volume.firstChapter === first)
    if (previous && previous.lastChapter >= last) continue
    if (
      existing.some(
        (volume) =>
          volume.firstChapter <= last &&
          volume.lastChapter >= first &&
          volume.fileId !== previous?.fileId,
      )
    )
      return []
    files.push({
      title: previous?.title ?? formatFileTitle(titleTemplate, number),
      firstChapter: first,
      lastChapter: last,
      ...(previous ? { replacesFileId: previous.fileId } : {}),
    })
    if (!previous) number += 1
  }
  return files
}

export function formatFileTitle(template: string, fileNumber: number): string {
  const trimmed = template.trim()
  const base = trimmed.length > 0 ? trimmed : 'Volume {n}'
  return base.includes('{n}') ? base.replaceAll('{n}', String(fileNumber)) : `${base} ${fileNumber}`
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(Math.max(Math.floor(value), min), Math.max(min, max))
}
