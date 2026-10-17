import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Route, Routes } from 'react-router-dom'
import { api } from '@/api/client'
import { books } from '@/test/fixtures'
import { renderWithProviders } from '@/test/render'
import { BookDetailsPage } from './BookDetailsPage'
import { getProgressHistoryWithDeltas } from './bookProgressHistory'

vi.mock('@/api/client', () => ({
  api: {
    getBook: vi.fn(),
    deleteBook: vi.fn(),
    refreshBookCover: vi.fn(),
  },
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('./BookCoverSection', () => ({
  BookCoverArtwork: ({ title, hint }: { title: string; hint?: string }) => (
    <div>
      {title} cover{hint}
    </div>
  ),
  CoverLightbox: () => null,
  useResolvedCoverImage: () => null,
}))

vi.mock('./ProgressDialog', () => ({
  ProgressDialog: () => <button type="button">Progress</button>,
}))

describe('BookDetailsPage', () => {
  it.each(['manga', 'manhwa', 'manhua', 'other'])('hides EPUB actions for %s', async (slug) => {
    vi.mocked(api.getBook).mockResolvedValue({
      ...books[0]!,
      contentType: slug,
      contentTypeSlug: slug,
    })
    renderWithProviders(
      <Routes>
        <Route element={<BookDetailsPage />} path="/books/:id" />
      </Routes>,
      { route: `/books/${books[0]!.id}` },
    )
    await screen.findByRole('link', { name: /library/i })
    expect(screen.queryByRole('button', { name: /find epub/i })).not.toBeInTheDocument()
    expect(screen.queryByText('EPUB files')).not.toBeInTheDocument()
  })

  it('preserves parsed line breaks in the description', async () => {
    vi.mocked(api.getBook).mockResolvedValue({
      ...books[0]!,
      description: 'First paragraph.\nSecond paragraph.',
    })

    renderWithProviders(
      <Routes>
        <Route element={<BookDetailsPage />} path="/books/:id" />
      </Routes>,
      { route: '/books/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' },
    )

    expect(
      await screen.findByText(
        (_, element) =>
          element?.tagName === 'P' && element.textContent === 'First paragraph.\nSecond paragraph.',
      ),
    ).toHaveClass('whitespace-pre-line')
  })

  it('returns to the exact filtered book list url stored by the list page', async () => {
    vi.mocked(api.getBook).mockResolvedValue(books[0]!)

    renderWithProviders(
      <Routes>
        <Route element={<BookDetailsPage />} path="/books/:id" />
      </Routes>,
      {
        route: {
          pathname: '/books/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
          state: { bookListReturnTo: '/books?take=50&query=Fantasy' },
        },
      },
    )

    expect(await screen.findByRole('link', { name: /library/i })).toHaveAttribute(
      'href',
      '/books?take=50&query=Fantasy',
    )
  })

  it('computes chapter deltas from sorted progress history entries', () => {
    expect(
      getProgressHistoryWithDeltas([
        {
          id: 'older',
          changedAt: '2026-01-01T10:00:00Z',
          chapterNumber: 10,
        },
        {
          id: 'latest',
          changedAt: '2026-01-03T10:00:00Z',
          chapterNumber: 16,
        },
        {
          id: 'middle',
          changedAt: '2026-01-02T10:00:00Z',
          chapterNumber: 12,
        },
        {
          id: 'label-only',
          changedAt: '2026-01-04T10:00:00Z',
          chapterLabel: 'Side story',
        },
      ]),
    ).toEqual([
      {
        id: 'label-only',
        changedAt: '2026-01-04T10:00:00Z',
        chapterLabel: 'Side story',
        delta: null,
      },
      {
        id: 'latest',
        changedAt: '2026-01-03T10:00:00Z',
        chapterNumber: 16,
        delta: 4,
      },
      {
        id: 'middle',
        changedAt: '2026-01-02T10:00:00Z',
        chapterNumber: 12,
        delta: 2,
      },
      {
        id: 'older',
        changedAt: '2026-01-01T10:00:00Z',
        chapterNumber: 10,
        delta: null,
      },
    ])
  })

  it('renders positive and negative deltas in the changelog header', async () => {
    vi.mocked(api.getBook).mockResolvedValue({
      ...books[0]!,
      progressHistory: [
        {
          id: 'latest',
          changedAt: '2026-02-03T10:00:00Z',
          chapterNumber: 20,
          chapterLabel: '20',
        },
        {
          id: 'mid',
          changedAt: '2026-02-02T10:00:00Z',
          chapterNumber: 14,
          chapterLabel: '14',
        },
        {
          id: 'older',
          changedAt: '2026-02-01T10:00:00Z',
          chapterNumber: 18,
          chapterLabel: '18',
        },
      ],
    })

    renderWithProviders(
      <Routes>
        <Route element={<BookDetailsPage />} path="/books/:id" />
      </Routes>,
      { route: '/books/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' },
    )

    expect(await screen.findByText('+6')).toHaveClass(
      'bg-status-finished-soft',
      'text-status-finished-ink',
    )
    expect(screen.getByText('-4')).toHaveClass('bg-danger-soft', 'text-danger-ink')
  })

  it('uses the shared dialog surface and readable title hierarchy', async () => {
    vi.mocked(api.getBook).mockResolvedValue(books[0]!)
    const user = userEvent.setup()

    renderWithProviders(
      <Routes>
        <Route element={<BookDetailsPage />} path="/books/:id" />
      </Routes>,
      { route: '/books/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' },
    )

    await screen.findByText('Lord of Mysteries')
    await user.click(screen.getByRole('button', { name: 'More actions' }))
    await user.click(screen.getByRole('menuitem', { name: /^Delete book…/ }))

    const dialog = screen.getByRole('dialog', { name: 'Delete book' })

    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(within(dialog).getByText('Lord of Mysteries')).toHaveClass('font-semibold', 'text-ink')
    expect(within(dialog).getByRole('button', { name: 'Delete' })).toBeEnabled()
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog', { name: 'Delete book' })).not.toBeInTheDocument()
  })

  it('renders the book status as a high-contrast labeled indicator', async () => {
    vi.mocked(api.getBook).mockResolvedValue(books[0]!)

    renderWithProviders(
      <Routes>
        <Route element={<BookDetailsPage />} path="/books/:id" />
      </Routes>,
      { route: '/books/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' },
    )

    const status = await screen.findByLabelText('Book status: Reading')
    expect(status).toHaveAttribute('data-tone', 'reading')
    expect(status).toHaveTextContent('Reading')
    expect(status).toHaveClass('bg-status-reading-soft', 'text-status-reading-ink')
  })

  it('renders ratings up to and including five in red', async () => {
    vi.mocked(api.getBook).mockResolvedValue({ ...books[0]!, rating: 5 })

    renderWithProviders(
      <Routes>
        <Route element={<BookDetailsPage />} path="/books/:id" />
      </Routes>,
      { route: '/books/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' },
    )

    const label = await screen.findByText('Rated 5 out of 10')
    expect(label.previousElementSibling).toHaveClass('text-danger-ink')
    expect(label.previousElementSibling?.querySelector('.fill-danger')).toBeInTheDocument()
  })

  it('keeps the status beside a long default title', async () => {
    vi.mocked(api.getBook).mockResolvedValue({
      ...books[0]!,
      primaryTitle:
        'A Very Long Default Book Title That Needs Several Lines Without Moving The Status Below It',
    })

    renderWithProviders(
      <Routes>
        <Route element={<BookDetailsPage />} path="/books/:id" />
      </Routes>,
      { route: '/books/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' },
    )

    const heading = await screen.findByRole('heading', { level: 1 })
    const status = screen.getByLabelText('Book status: Reading')

    expect(heading).toHaveClass('break-words')
    expect(status.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('replaces a technical cover download error with a helpful generic message', async () => {
    vi.mocked(api.getBook).mockResolvedValue({
      ...books[0]!,
      cover: {
        id: 'cover-1',
        status: 'Failed',
        failureReason: 'Response status code does not indicate success: 301 (Moved Permanently).',
      },
    })

    renderWithProviders(
      <Routes>
        <Route element={<BookDetailsPage />} path="/books/:id" />
      </Routes>,
      { route: '/books/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' },
    )

    expect(
      await screen.findByText(/A cover was found, but the image could not be downloaded/),
    ).toBeInTheDocument()
    expect(screen.queryByText(/301 \(Moved Permanently\)/)).not.toBeInTheDocument()
  })

  it('shows tag descriptions through the shared metadata component', async () => {
    vi.mocked(api.getBook).mockResolvedValue(books[0]!)
    const user = userEvent.setup()

    renderWithProviders(
      <Routes>
        <Route element={<BookDetailsPage />} path="/books/:id" />
      </Routes>,
      { route: '/books/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' },
    )

    const tag = await screen.findByText('favorite')
    await user.hover(tag)
    expect(screen.getByRole('tooltip')).toHaveTextContent('A personal favorite.')
  })

  it('links genres and tags to the library filtered by them, collapsing long tag lists', async () => {
    vi.mocked(api.getBook).mockResolvedValue({
      ...books[0]!,
      genres: ['Slice of Life'],
      tags: Array.from({ length: 16 }, (_, index) => 'tag' + String(index + 1)),
    })
    const user = userEvent.setup()

    renderWithProviders(
      <Routes>
        <Route element={<BookDetailsPage />} path="/books/:id" />
      </Routes>,
      { route: '/books/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' },
    )

    expect(await screen.findByRole('link', { name: 'Slice of Life' })).toHaveAttribute(
      'href',
      '/books?query=genre%3A%22slice+of+life%22',
    )
    expect(screen.getByRole('link', { name: 'tag1' })).toHaveAttribute(
      'href',
      '/books?query=tag%3Atag1',
    )
    expect(screen.queryByRole('link', { name: 'tag16' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Show all 16' }))
    expect(screen.getByRole('link', { name: 'tag16' })).toBeInTheDocument()
  })

  it('opens Find EPUB from the action row and keeps delete in the more menu', async () => {
    vi.mocked(api.getBook).mockResolvedValue(books[0]!)
    const user = userEvent.setup()

    renderWithProviders(
      <Routes>
        <Route element={<BookDetailsPage />} path="/books/:id" />
      </Routes>,
      { route: '/books/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' },
    )

    await screen.findByText('Lord of Mysteries')
    expect(screen.queryByRole('button', { name: 'Delete…' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Find EPUB' }))
    expect(screen.getByRole('dialog', { name: 'Find EPUB' })).toBeInTheDocument()
  })
})
