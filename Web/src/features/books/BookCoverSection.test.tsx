import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BookCoverDto } from '@/api/types'
import { BookCoverArtwork } from './BookCoverSection'

vi.mock('@/api/http', () => ({
  API_BASE_URL: 'https://api.example.com/api/v1',
  apiBlobRequest: async (path: string) => {
    const response = await fetch(`https://api.example.com/api/v1${path}`)
    return response.blob()
  },
  getStoredSession: () => ({ accessToken: 'token-123', userId: 'user-123' }),
  getStoredSessionUserId: () => 'user-123',
}))

const baseCover: BookCoverDto = {
  id: 'cover-1',
  status: 'Ready',
  imageUrl: '/api/v1/book/book-1/cover/file?v=2026-07-12T10%3A00%3A00Z',
  thumbnailImageUrl: '/api/v1/book/book-1/cover/thumbnail?v=2026-07-12T10%3A00%3A00Z',
  lastAttemptAt: '2026-07-12T10:00:00Z',
}

describe('BookCoverSection', () => {
  const cacheEntries = new Map<string, Response>()
  const cacheNames: string[] = []

  beforeEach(() => {
    vi.useFakeTimers()
    cacheEntries.clear()
    cacheNames.length = 0
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementation(() =>
          Promise.resolve(new Response(new Blob(['cover']), { status: 200 })),
        ),
    )
    vi.stubGlobal('caches', {
      open: vi.fn((cacheName: string) => {
        cacheNames.push(cacheName)
        return Promise.resolve({
          add: vi.fn(() => Promise.resolve()),
          addAll: vi.fn(() => Promise.resolve()),
          match: vi.fn((request: Request) =>
            Promise.resolve(cacheEntries.get(request.url)?.clone()),
          ),
          matchAll: vi.fn(() => Promise.resolve([])),
          put: vi.fn((request: Request, response: Response) => {
            cacheEntries.set(request.url, response.clone())
            return Promise.resolve()
          }),
          keys: vi.fn(() =>
            Promise.resolve(
              Array.from(cacheEntries.keys()).map(
                (url) => new Request(new URL(url, window.location.origin).toString()),
              ),
            ),
          ),
          delete: vi.fn((request: Request) => {
            const normalizedUrl = new URL(request.url)
            const relativeUrl = `${normalizedUrl.pathname}${normalizedUrl.search}`
            return Promise.resolve(
              cacheEntries.delete(request.url) || cacheEntries.delete(relativeUrl),
            )
          }),
        } satisfies Cache)
      }),
    })
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:cover-1')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('waits until a lazy cover is near the viewport before fetching it', async () => {
    const lazyCover = {
      ...baseCover,
      id: 'lazy-cover',
      imageUrl: 'http://localhost/api/v1/books/book-lazy/cover',
      thumbnailImageUrl: 'http://localhost/api/v1/books/book-lazy/cover?variant=thumbnail',
    }
    let reveal = (): void => undefined
    const observe = vi.fn()
    const disconnect = vi.fn()
    class MockIntersectionObserver implements IntersectionObserver {
      readonly root = null
      readonly rootMargin = '600px 0px'
      readonly scrollMargin = '0px'
      readonly thresholds = [0]

      constructor(callback: IntersectionObserverCallback) {
        reveal = () => callback([{ isIntersecting: true } as IntersectionObserverEntry], this)
      }

      disconnect = disconnect
      observe = observe
      takeRecords = () => []
      unobserve = vi.fn()
    }
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver)

    render(<BookCoverArtwork cover={lazyCover} loading="lazy" title="Lazy book cover" />)

    await act(async () => {
      await Promise.resolve()
    })
    expect(observe).toHaveBeenCalledTimes(1)
    expect(fetch).not.toHaveBeenCalled()

    await act(async () => {
      reveal()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(fetch).toHaveBeenCalledTimes(1)
    expect(disconnect).toHaveBeenCalled()
    expect(screen.getByRole('img', { name: 'Lazy book cover' })).toHaveAttribute('loading', 'lazy')
    expect(screen.getByRole('img', { name: 'Lazy book cover' })).toHaveAttribute(
      'decoding',
      'async',
    )
  })

  it('reuses the cached blob url when the same cover is mounted again', async () => {
    const firstRender = render(<BookCoverArtwork cover={baseCover} title="Book cover" />)

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(screen.getByRole('img', { name: 'Book cover' })).toHaveAttribute('src', 'blob:cover-1')
    firstRender.unmount()

    const secondRender = render(<BookCoverArtwork cover={baseCover} title="Book cover" />)

    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.getByRole('img', { name: 'Book cover' })).toHaveAttribute('src', 'blob:cover-1')
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1)

    secondRender.unmount()
  })

  it('reuses Cache Storage after the in-memory ttl expires', async () => {
    const firstRender = render(<BookCoverArtwork cover={baseCover} title="Book cover" />)

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    firstRender.unmount()

    act(() => {
      vi.advanceTimersByTime(60_000)
    })

    vi.mocked(URL.createObjectURL).mockReturnValueOnce('blob:cover-from-cache')
    const secondRender = render(<BookCoverArtwork cover={baseCover} title="Book cover" />)
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(fetch).toHaveBeenCalledTimes(1)
    expect(cacheNames).toContain('novelki.covers.v1::user-123')
    expect(screen.getByRole('img', { name: 'Book cover' })).toHaveAttribute(
      'src',
      'blob:cover-from-cache',
    )
    secondRender.unmount()
  })

  it('releases cached object urls after the cache ttl elapses', async () => {
    const result = render(<BookCoverArtwork cover={baseCover} title="Book cover" />)

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(screen.getByRole('img', { name: 'Book cover' })).toHaveAttribute('src', 'blob:cover-1')
    result.unmount()

    act(() => {
      vi.advanceTimersByTime(60_000)
    })

    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:cover-1')
  })

  it('invalidates the cached image when the cover attempt timestamp changes', async () => {
    const { rerender } = render(<BookCoverArtwork cover={baseCover} title="Book cover" />)

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(fetch).toHaveBeenCalledTimes(1)

    vi.mocked(URL.createObjectURL).mockReturnValueOnce('blob:cover-2')
    rerender(
      <BookCoverArtwork
        cover={{
          ...baseCover,
          imageUrl: '/api/v1/book/book-1/cover/file?v=2026-07-12T10%3A05%3A00Z',
          thumbnailImageUrl: '/api/v1/book/book-1/cover/thumbnail?v=2026-07-12T10%3A05%3A00Z',
          lastAttemptAt: '2026-07-12T10:05:00Z',
        }}
        title="Book cover"
      />,
    )

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('img', { name: 'Book cover' })).toHaveAttribute('src', 'blob:cover-2')
    expect(Array.from(cacheEntries.keys())).toEqual([
      'https://api.example.com/api/v1/book/book-1/cover/file?v=2026-07-12T10%3A05%3A00Z',
    ])
  })

  it('uses the thumbnail url when thumbnail variant is requested', async () => {
    render(<BookCoverArtwork cover={baseCover} preferredVariant="thumbnail" title="Book cover" />)

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(fetch).toHaveBeenCalledWith(
      'https://api.example.com/api/v1/book/book-1/cover/thumbnail?v=2026-07-12T10%3A00%3A00Z',
    )
    expect(screen.getByRole('img', { name: 'Book cover' })).toHaveAttribute('src', 'blob:cover-1')
  })

  it('uses the circular icon-button variant for removing a cover', async () => {
    const { container } = render(
      <BookCoverArtwork
        cover={{
          ...baseCover,
          imageUrl: '/api/v1/book/book-round/cover/file?v=round',
          thumbnailImageUrl: '/api/v1/book/book-round/cover/thumbnail?v=round',
        }}
        interactive
        title="Book cover"
        onRemove={vi.fn()}
      />,
    )

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(container.querySelector('button.rounded-full')).toBeInTheDocument()
  })

  it('prunes older cached variants even when existing cache keys are relative urls', async () => {
    cacheEntries.set(
      '/api/v1/book/book-1/cover/file?v=old',
      new Response(new Blob(['old']), { status: 200 }),
    )

    render(<BookCoverArtwork cover={baseCover} title="Book cover" />)

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(Array.from(cacheEntries.keys())).toEqual([
      'https://api.example.com/api/v1/book/book-1/cover/file?v=2026-07-12T10%3A00%3A00Z',
    ])
  })

  it('loads covers when API_BASE_URL is relative', async () => {
    vi.resetModules()
    vi.doMock('@/api/http', () => ({
      API_BASE_URL: '/api/v1',
      apiBlobRequest: async (path: string) => {
        const response = await fetch(`${window.location.origin}/api/v1${path}`)
        return response.blob()
      },
      getStoredSession: () => ({ accessToken: 'token-123', userId: 'user-123' }),
      getStoredSessionUserId: () => 'user-123',
    }))

    const { BookCoverArtwork: RelativeBaseArtwork } = await import('./BookCoverSection')

    render(<RelativeBaseArtwork cover={baseCover} title="Book cover" />)

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(fetch).toHaveBeenCalledWith(
      `${window.location.origin}/api/v1/book/book-1/cover/file?v=2026-07-12T10%3A00%3A00Z`,
    )
    expect(screen.getByRole('img', { name: 'Book cover' })).toHaveAttribute('src', 'blob:cover-1')
  })
})
