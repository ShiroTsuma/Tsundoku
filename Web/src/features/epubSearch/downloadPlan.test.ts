import { describe, expect, it } from 'vitest'
import { chapterCount, formatFileTitle, planFiles, resolveRange } from './downloadPlan'

describe('resolveRange', () => {
  it('covers every chapter for "all"', () => {
    expect(resolveRange({ kind: 'all' }, 311)).toEqual({ from: 1, to: 311 })
  })

  it('continues after the current progress', () => {
    expect(resolveRange({ kind: 'fromProgress', from: 167 }, 311)).toEqual({ from: 167, to: 311 })
  })

  it('yields an empty range when the source is behind the reader', () => {
    const range = resolveRange({ kind: 'fromProgress', from: 200 }, 120)
    expect(chapterCount(range)).toBe(0)
  })

  it('clamps a custom range to the source', () => {
    expect(resolveRange({ kind: 'custom', from: 0, to: 9999 }, 120)).toEqual({ from: 1, to: 120 })
    expect(resolveRange({ kind: 'custom', from: 50, to: 10 }, 120)).toEqual({ from: 50, to: 50 })
  })
})

describe('planFiles', () => {
  it.each([50, 100, 200])(
    'regenerates only the growing last volume using %i chapters per file',
    (size) => {
      const existing = Array.from({ length: 6 }, (_, index) => ({
        fileId: `file-${index + 1}`,
        title: `Volume ${index + 1}`,
        firstChapter: index * size + 1,
        lastChapter: index === 5 ? size * 5 + 27 : (index + 1) * size,
      }))
      const to = size * 5 + 42
      const expected = [
        {
          title: 'Volume 6',
          firstChapter: size * 5 + 1,
          lastChapter: to,
          replacesFileId: 'file-6',
        },
      ]
      expect(planFiles({ from: 1, to }, size, 'Volume {n}', 7, existing)).toEqual(expected)
      expect(planFiles({ from: size * 5 + 28, to }, size, 'Volume {n}', 7, existing)).toEqual(
        expected,
      )
      expect(planFiles({ from: size + 10, to }, size, 'Volume {n}', 7, existing)).toEqual(expected)
    },
  )

  it('extends volume 6 and numbers the following new volume as volume 7', () => {
    const existing = [{ fileId: 'six', title: 'Volume 6', firstChapter: 501, lastChapter: 527 }]
    expect(planFiles({ from: 528, to: 625 }, 100, 'Volume {n}', 7, existing)).toEqual([
      { title: 'Volume 6', firstChapter: 501, lastChapter: 600, replacesFileId: 'six' },
      { title: 'Volume 7', firstChapter: 601, lastChapter: 625 },
    ])
  })

  it('splits into files and continues numbering', () => {
    const files = planFiles({ from: 167, to: 311 }, 100, 'Volume {n}', 4)
    expect(files).toEqual([
      { title: 'Volume 4', firstChapter: 167, lastChapter: 266 },
      { title: 'Volume 5', firstChapter: 267, lastChapter: 311 },
    ])
  })

  it('returns no files for an empty range', () => {
    expect(planFiles({ from: 121, to: 120 }, 100, 'Volume {n}', 1)).toEqual([])
  })
})

describe('formatFileTitle', () => {
  it('appends the number when the template has no placeholder', () => {
    expect(formatFileTitle('Part', 3)).toBe('Part 3')
    expect(formatFileTitle('  ', 2)).toBe('Volume 2')
  })
})
