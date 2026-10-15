import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/api/client'
import { HttpError } from '@/api/http'
import { bookListItems, books, dictionaries, paginated, statuses } from '@/test/fixtures'
import { renderWithProviders } from '@/test/render'
import { toast } from 'sonner'
import { BooksPage } from './BooksPage'
import {
  getCardDetailRowClass,
  getCardGridColumns,
  getCardPageSizeOptions,
  getCardRowMinHeightClasses,
  getCardTextSizeClasses,
  getClosestPageSize,
  getCardColumnCount,
  readCardSize,
} from './bookCardLayout'
import { formatAverageRating } from './bookFormatters'
import { formatProgress } from './bookProgress'
import {
  defaultColumnPreferences,
  getColumnPopupPosition,
  getVisibleColumns,
} from './columnPreferences'

vi.mock('@/api/client', () => ({
  api: {
    getBooks: vi.fn(),
    getBooksSummary: vi.fn(),
    getBookSearchSuggestions: vi.fn(),
    downloadBooksExport: vi.fn(),
    downloadBooksFullExport: vi.fn(),
  },
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

/** Switches the query bar to its text view (it opens on pills when the URL has a query). */
function getSearchInput() {
  const queryButton = screen.queryByRole('button', { name: 'Query' })
  if (queryButton?.getAttribute('aria-pressed') === 'false') {
    fireEvent.click(queryButton)
  }
  return screen.getByRole<HTMLInputElement>('combobox', { name: /search books/i })
}

describe('BooksPage', () => {
  beforeEach(() => {
    window.localStorage.removeItem('novelki.books.page-size.v1')
    window.sessionStorage.clear()
    vi.mocked(api.getBooks).mockReset()
    vi.mocked(api.getBooksSummary).mockReset()
    vi.mocked(api.getBookSearchSuggestions).mockReset()
    vi.mocked(api.getBookSearchSuggestions).mockResolvedValue([])
  })

  it('renders books in table view and fetches with default list params', async () => {
    vi.mocked(api.getBooks).mockResolvedValue(paginated(bookListItems))
    const user = userEvent.setup()

    renderWithProviders(<BooksPage />, { route: '/books' })

    expect(await screen.findByText('Lord of Mysteries')).toBeInTheDocument()
    expect(screen.getByText('Cuttlefish')).toBeInTheDocument()
    await user.hover(screen.getByLabelText('1 alternative name'))
    expect(screen.getByRole('tooltip')).toHaveTextContent(
      'Alternative name: Cuttlefish That Loves Diving',
    )
    await user.unhover(screen.getByLabelText('1 alternative name'))
    expect(screen.queryByText('favorite')).not.toBeInTheDocument()
    expect(api.getBooks).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 0,
        take: 20,
        query: '',
        sortBy: 'lastModified',
        sortDirection: 'desc',
      }),
    )
  })

  it('keeps table actions isolated from crowded columns', async () => {
    vi.mocked(api.getBooks).mockResolvedValue(paginated(bookListItems))

    const { container } = renderWithProviders(<BooksPage />, { route: '/books' })

    await screen.findByText('Lord of Mysteries')
    expect(container.querySelector('table')).toHaveStyle({ minWidth: '76rem' })
    expect(container.querySelectorAll('col')).toHaveLength(7)
    expect(screen.getByRole('columnheader', { name: /actions/i })).toHaveClass('sticky', 'right-0')
    expect(screen.queryByRole('columnheader', { name: /^id$/i })).not.toBeInTheDocument()
    expect(
      screen.queryByRole('columnheader', { name: /alternative titles/i }),
    ).not.toBeInTheDocument()
    expect(screen.getByLabelText('1 alternative title')).toHaveTextContent('· 1 alt title')
  })

  it('keeps all enabled table columns inside a symmetric scroll container', async () => {
    window.localStorage.setItem(
      'novelki.books.columns.v1',
      JSON.stringify([
        { id: 'title', visible: true },
        { id: 'author', visible: true },
        { id: 'status', visible: true },
        { id: 'type', visible: true },
        { id: 'progress', visible: true },
        { id: 'totalChapters', visible: true },
        { id: 'rating', visible: true },
        { id: 'priority', visible: true },
        { id: 'created', visible: true },
        { id: 'lastModified', visible: true },
        { id: 'genres', visible: true },
        { id: 'tags', visible: true },
        { id: 'links', visible: true },
        { id: 'notes', visible: true },
        { id: 'description', visible: true },
      ]),
    )
    vi.mocked(api.getBooks).mockResolvedValue(paginated(bookListItems))
    const user = userEvent.setup()

    const { container } = renderWithProviders(<BooksPage />, { route: '/books' })

    await screen.findByText('Lord of Mysteries')

    const table = container.querySelector('table')
    const scroller = table?.parentElement
    const box = table?.closest('.rounded-xl')

    expect(table).toHaveStyle({ minWidth: '154.5rem' })
    expect(container.querySelectorAll('col')).toHaveLength(16)
    expect(scroller).toHaveClass('max-w-full', 'overflow-x-auto')
    expect(box).toHaveClass('min-w-0', 'overflow-hidden')
    expect(screen.queryByRole('columnheader', { name: /^id$/i })).not.toBeInTheDocument()
    expect(
      screen.queryByRole('columnheader', { name: /alternative titles/i }),
    ).not.toBeInTheDocument()
    await user.hover(screen.getByText('Fantasy'))
    expect(screen.getByRole('tooltip')).toHaveTextContent(
      'Magic, strange worlds, and supernatural stories.',
    )
  })

  it('discovers filters and colon-based operators from the search suggestions', async () => {
    vi.mocked(api.getBooks).mockResolvedValue(paginated(bookListItems))
    const user = userEvent.setup()

    renderWithProviders(<BooksPage />, { route: '/books' })

    await screen.findByText('Lord of Mysteries')
    const searchInput = getSearchInput()
    await user.click(searchInput)
    expect(screen.getByRole('option', { name: /^title:#/i })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /^description:#/i })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /:none/i })).not.toBeInTheDocument()
    await user.click(screen.getByRole('option', { name: /^rating:/i }))

    expect(searchInput).toHaveValue('rating:')
    expect(screen.getByRole('option', { name: /^rating:>=N/i })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /^rating:<=N/i })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /^rating:=N/i })).toBeInTheDocument()
  })

  it('keeps title and description values manual', async () => {
    vi.mocked(api.getBooks).mockResolvedValue(paginated(bookListItems))
    const user = userEvent.setup()

    renderWithProviders(<BooksPage />, { route: '/books' })

    await screen.findByText('Lord of Mysteries')
    const searchInput = getSearchInput()
    await user.click(searchInput)
    await user.click(screen.getByRole('option', { name: /^title:#/i }))
    expect(searchInput).toHaveValue('title:""')
    expect(searchInput).toHaveFocus()
    expect(searchInput.selectionStart).toBe('title:"'.length)
    expect(screen.getByRole('option', { name: /^\* wildcard/i })).toHaveTextContent(
      'Matches any sequence of characters',
    )
    await user.keyboard('Lord')

    expect(searchInput).toHaveValue('title:"Lord"')
    expect(api.getBookSearchSuggestions).not.toHaveBeenCalled()
  })

  it('preserves spaces in the search input while sending a trimmed query to the api', async () => {
    vi.mocked(api.getBooks).mockResolvedValue(paginated(bookListItems))
    const user = userEvent.setup()

    renderWithProviders(<BooksPage />, { route: '/books' })

    await screen.findByText('Lord of Mysteries')
    const searchInput = getSearchInput()
    await user.clear(searchInput)
    await user.type(searchInput, 'status:plan to read ')

    expect(searchInput).toHaveValue('status:plan to read ')
    await waitFor(() =>
      expect(api.getBooks).toHaveBeenLastCalledWith(
        expect.objectContaining({
          query: 'status:plan to read',
        }),
      ),
    )
  })

  it('clears the active search from the right-side clear button', async () => {
    vi.mocked(api.getBooks).mockResolvedValue(paginated(bookListItems))
    const user = userEvent.setup()

    renderWithProviders(<BooksPage />, { route: '/books?query=status%3AReading' })

    const searchInput = getSearchInput()
    await user.click(screen.getByRole('button', { name: /clear search and filters/i }))

    expect(searchInput).toHaveValue('')
    await waitFor(() =>
      expect(api.getBooks).toHaveBeenLastCalledWith(expect.objectContaining({ query: '' })),
    )
  })

  it('inserts frequency-ranked text suggestions as quoted filter values', async () => {
    vi.mocked(api.getBooks).mockResolvedValue(paginated(bookListItems))
    vi.mocked(api.getBookSearchSuggestions).mockResolvedValue([
      { value: 'Completed', count: 12, isExact: false, isAvailable: true },
      { value: 'Currently Reading', count: 4, isExact: false, isAvailable: true },
      { value: 'none', count: 1, isExact: false, isAvailable: true },
    ])
    const user = userEvent.setup()

    renderWithProviders(<BooksPage />, { route: '/books' })

    await screen.findByText('Lord of Mysteries')
    const searchInput = getSearchInput()
    await user.type(searchInput, 'status:comp')
    await waitFor(() =>
      expect(api.getBookSearchSuggestions).toHaveBeenCalledWith(
        expect.objectContaining({
          field: 'status',
          search: 'comp',
          take: 10,
        }),
      ),
    )
    const completedSuggestion = await screen.findByRole('option', { name: /^Completed/i })
    await user.click(completedSuggestion)

    expect(searchInput).toHaveValue('status:"Completed" ')
    expect(screen.getByRole('option', { name: /^title:#/i })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /^none/i })).not.toBeInTheDocument()
  })

  it('shows close values alongside actions when the current author is not an exact match', async () => {
    vi.mocked(api.getBooks).mockResolvedValue(paginated(bookListItems))
    vi.mocked(api.getBookSearchSuggestions).mockResolvedValue([
      { value: 'Perfect123', count: 3, isExact: false, isAvailable: true },
    ])
    const user = userEvent.setup()

    renderWithProviders(<BooksPage />, { route: '/books?query=author%3A%22perf%22' })

    await screen.findByText('Lord of Mysteries')
    await user.click(getSearchInput())
    await waitFor(() =>
      expect(api.getBookSearchSuggestions).toHaveBeenCalledWith(
        expect.objectContaining({
          field: 'author',
          search: 'perf',
          take: 10,
        }),
      ),
    )

    expect(screen.getByRole('option', { name: /^Exclude author:"perf"/i })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /^Remove author:"perf"/i })).toBeInTheDocument()
    expect(await screen.findByRole('option', { name: /^Perfect123/i })).toBeInTheDocument()
  })

  it('shows only token actions when the current author is an exact match', async () => {
    vi.mocked(api.getBooks).mockResolvedValue(paginated(bookListItems))
    vi.mocked(api.getBookSearchSuggestions).mockResolvedValue([
      { value: 'Perf', count: 2, isExact: true, isAvailable: true },
      { value: 'Perfect123', count: 3, isExact: false, isAvailable: true },
    ])
    const user = userEvent.setup()

    renderWithProviders(<BooksPage />, { route: '/books?query=author%3A%22Perf%22' })

    await screen.findByText('Lord of Mysteries')
    await user.click(getSearchInput())
    await waitFor(() =>
      expect(api.getBookSearchSuggestions).toHaveBeenCalledWith(
        expect.objectContaining({
          field: 'author',
          search: 'Perf',
          take: 10,
        }),
      ),
    )
    await waitFor(() => {
      expect(screen.getByRole('listbox')).toHaveAttribute('aria-busy', 'false')
      expect(screen.getByRole('option', { name: /^Exclude author:"Perf"/ })).toBeInTheDocument()
      expect(screen.getByRole('option', { name: /^Remove author:"Perf"/ })).toBeInTheDocument()
      expect(within(screen.getByRole('listbox')).queryByText('Perf')).not.toBeInTheDocument()
      expect(screen.queryByRole('option', { name: /^Perfect123/ })).not.toBeInTheDocument()
    })
  })

  it('shows matching values outside the current filter as disabled suggestions', async () => {
    vi.mocked(api.getBooks).mockResolvedValue(paginated(bookListItems))
    vi.mocked(api.getBookSearchSuggestions).mockResolvedValue([
      { value: 'Manga', count: 0, isExact: true, isAvailable: false },
    ])
    const user = userEvent.setup()

    renderWithProviders(<BooksPage />, {
      route: '/books?query=status%3ACompleted%20type%3A%22Manga%22',
    })

    await screen.findByText('Lord of Mysteries')
    const searchInput = getSearchInput()
    await user.click(searchInput)
    await waitFor(() =>
      expect(api.getBookSearchSuggestions).toHaveBeenCalledWith(
        expect.objectContaining({
          field: 'type',
          search: 'Manga',
          query: 'status:Completed',
          take: 10,
        }),
      ),
    )

    const unavailable = await screen.findByRole('option', { name: /^Manga/i })
    expect(unavailable).toBeDisabled()
    expect(unavailable).toHaveTextContent('0 books in current filters')
    await user.click(unavailable)

    expect(searchInput).toHaveValue('status:Completed type:"Manga"')
  })

  it('can exclude and remove the complete filter under the caret', async () => {
    vi.mocked(api.getBooks).mockResolvedValue(paginated(bookListItems))
    const user = userEvent.setup()

    renderWithProviders(<BooksPage />, { route: '/books?query=tag%3Afavorite' })

    await screen.findByText('Lord of Mysteries')
    const searchInput = getSearchInput()
    await user.click(searchInput)
    await user.click(screen.getByRole('option', { name: /^Exclude tag:favorite/i }))
    expect(searchInput).toHaveValue('-tag:favorite')

    await user.click(screen.getByRole('option', { name: /^Remove -tag:favorite/i }))
    expect(searchInput).toHaveValue('')
  })

  it('keeps the caret position when inserting a space in the middle of the search', async () => {
    vi.mocked(api.getBooks).mockResolvedValue(paginated(bookListItems))
    const user = userEvent.setup()

    renderWithProviders(<BooksPage />, { route: '/books?query=title%3ALordofMysteries' })

    await screen.findByText('Lord of Mysteries')
    const searchInput = getSearchInput()
    searchInput.focus()
    searchInput.setSelectionRange('title:Lord'.length, 'title:Lord'.length)
    await user.keyboard(' ')

    expect(searchInput).toHaveValue('title:Lord ofMysteries')
    expect(searchInput.selectionStart).toBe('title:Lord '.length)
    expect(searchInput.selectionEnd).toBe('title:Lord '.length)
  })

  it('switches to cards view and persists the preference', async () => {
    vi.mocked(api.getBooks).mockResolvedValue(paginated(bookListItems))
    const user = userEvent.setup()

    renderWithProviders(<BooksPage />, { route: '/books' })

    await screen.findByText('Lord of Mysteries')
    await user.click(screen.getByRole('button', { name: /cards/i }))

    expect(window.localStorage.getItem('novelki.books.layout.v1')).toBe('cards')
    expect(screen.getByRole('heading', { name: /A Very Long Book Title/ })).toHaveAttribute(
      'title',
      'A Very Long Book Title That Should Stay Inside Its Card Container Without Pushing Actions Away',
    )
  })

  it('remembers the exact scroll position and filtered list url before opening details', async () => {
    vi.mocked(api.getBooks).mockResolvedValue(paginated(bookListItems))
    const user = userEvent.setup()
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 731 })

    renderWithProviders(<BooksPage />, { route: '/books?take=50&query=Fantasy' })

    await user.click(await screen.findByRole('link', { name: 'Lord of Mysteries' }))

    expect(
      window.sessionStorage.getItem(
        'novelki.books.scroll-position.v1:/books?take=50&query=Fantasy',
      ),
    ).toBe('731')
  })

  it('remembers the exact scroll position and filtered list url before editing directly', async () => {
    vi.mocked(api.getBooks).mockResolvedValue(paginated(bookListItems))
    const user = userEvent.setup()
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 731 })

    renderWithProviders(<BooksPage />, { route: '/books?take=50&query=Fantasy' })

    await user.click(
      await screen.findByRole('button', { name: 'More actions for Lord of Mysteries' }),
    )
    await user.click(screen.getByRole('menuitem', { name: 'Edit book' }))

    expect(
      window.sessionStorage.getItem(
        'novelki.books.scroll-position.v1:/books?take=50&query=Fantasy',
      ),
    ).toBe('731')
  })

  it('restores and consumes the saved scroll position after the book list loads', async () => {
    vi.mocked(api.getBooks).mockResolvedValue(paginated(bookListItems))
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
    const storageKey = 'novelki.books.scroll-position.v1:/books?take=50'
    window.sessionStorage.setItem(storageKey, '684')

    renderWithProviders(<BooksPage />, { route: '/books?take=50' })

    await waitFor(() => {
      expect(scrollTo).toHaveBeenCalledWith({ top: 684, behavior: 'auto' })
    })
    expect(window.sessionStorage.getItem(storageKey)).toBeNull()
    scrollTo.mockRestore()
  })

  it('restores the selected page size after leaving and returning to the list', async () => {
    vi.mocked(api.getBooks).mockResolvedValue(paginated(bookListItems))
    const firstVisit = renderWithProviders(<BooksPage />, { route: '/books?take=50' })
    await screen.findByText('Lord of Mysteries')
    expect(api.getBooks).toHaveBeenCalledWith(expect.objectContaining({ take: 50 }))
    firstVisit.unmount()
    vi.mocked(api.getBooks).mockClear()

    renderWithProviders(<BooksPage />, { route: '/books' })

    await screen.findByText('Lord of Mysteries')
    expect(api.getBooks).toHaveBeenCalledWith(expect.objectContaining({ take: 50 }))
  })

  it('shows the actual number of metadata values omitted by the list projection', async () => {
    vi.mocked(api.getBooks).mockResolvedValue(
      paginated([
        {
          ...bookListItems[0]!,
          tags: ['visible-one', 'visible-two', 'visible-three', 'known-hidden'],
          tagDescriptions: {},
          tagsCount: 26,
        },
      ]),
    )
    window.localStorage.setItem(
      'novelki.books.columns.v1',
      JSON.stringify([{ id: 'tags', visible: true }]),
    )

    renderWithProviders(<BooksPage />, { route: '/books' })

    expect(await screen.findByLabelText('24 more: visible-three, known-hidden')).toHaveTextContent(
      /^\+24$/,
    )
  })

  it('offers export and import in one Import / Export menu', async () => {
    vi.mocked(api.getBooks).mockResolvedValue(paginated(bookListItems))
    const user = userEvent.setup()

    renderWithProviders(<BooksPage />, { route: '/books' })

    await screen.findByText('Lord of Mysteries')
    expect(screen.queryByRole('button', { name: /^summary$/i })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Import / Export' }))
    const menu = screen.getByRole('menu', { name: 'Import / Export' })
    expect(within(menu).getByText('Export')).toBeInTheDocument()
    expect(within(menu).getByText('Import')).toBeInTheDocument()
  })

  it('exports the current filtered and sorted books to csv', async () => {
    vi.mocked(api.getBooks).mockResolvedValue(paginated(books))
    vi.mocked(api.downloadBooksExport).mockResolvedValue(new Blob(['csv'], { type: 'text/csv' }))
    const createObjectUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:books-export')
    const revokeObjectUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined)
    const user = userEvent.setup()

    renderWithProviders(<BooksPage />, {
      route: '/books?query=author%3AToika&sortBy=title&sortDirection=asc',
    })

    await screen.findByText('Lord of Mysteries')
    await user.click(screen.getByRole('button', { name: 'Import / Export' }))
    await user.click(screen.getAllByRole('menuitem', { name: /^csv/i })[0]!)

    await waitFor(() =>
      expect(api.downloadBooksExport).toHaveBeenCalledWith({
        query: 'author:Toika',
        sortBy: 'title',
        sortDirection: 'asc',
      }),
    )
    expect(clickSpy).toHaveBeenCalledTimes(1)
    expect(createObjectUrl).toHaveBeenCalledTimes(1)
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:books-export')

    createObjectUrl.mockRestore()
    revokeObjectUrl.mockRestore()
    clickSpy.mockRestore()
  })

  it('offers csv above full backup for both export and import', async () => {
    vi.mocked(api.getBooks).mockResolvedValue(paginated(bookListItems))
    const user = userEvent.setup()

    renderWithProviders(<BooksPage />, { route: '/books' })

    await screen.findByText('Lord of Mysteries')
    await user.click(screen.getByRole('button', { name: 'Import / Export' }))
    const menuItems = screen.getAllByRole('menuitem')
    expect(menuItems[0]).toHaveTextContent(/^CSV/)
    expect(menuItems[1]).toHaveTextContent(/^Full backup/)
    expect(menuItems[3]).toHaveTextContent(/^CSV/)
    expect(menuItems[4]).toHaveTextContent(/^Full backup/)

    await user.click(menuItems[4]!)
    expect(screen.getByRole('heading', { name: 'Import books' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Full backup (ZIP)' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('shows the API detail when a full export is rate limited', async () => {
    vi.mocked(api.getBooks).mockResolvedValue(paginated(bookListItems))
    vi.mocked(api.downloadBooksFullExport).mockRejectedValue(
      new HttpError({
        type: 'RateLimitExceeded',
        title: 'Too Many Requests',
        status: 429,
        detail: 'Too many requests. Try again in 30 minutes.',
        instance: '/book/export/full',
      }),
    )
    const user = userEvent.setup()

    renderWithProviders(<BooksPage />, { route: '/books' })

    await screen.findByText('Lord of Mysteries')
    await user.click(screen.getByRole('button', { name: 'Import / Export' }))
    await user.click(screen.getAllByRole('menuitem', { name: /^full backup/i })[0]!)

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Too many requests. Try again in 30 minutes.')
    })
  })

  it('shows whole-library stats under the title', async () => {
    vi.mocked(api.getBooks).mockResolvedValue(paginated(books))
    vi.mocked(api.getBooksSummary).mockResolvedValue(createSummary())

    renderWithProviders(<BooksPage />, { route: '/books?query=author%3AToika' })

    expect(
      await screen.findByText('2 books · 1 finished · 468 chapters read · avg rating 9.0'),
    ).toBeInTheDocument()
    expect(api.getBooksSummary).toHaveBeenCalledWith({ query: '' })
  })

  it('counts each status tab against the rest of the query', async () => {
    vi.mocked(api.getBooks).mockResolvedValue(paginated(books))
    vi.mocked(api.getBooksSummary).mockResolvedValue(createSummary())

    renderWithProviders(<BooksPage />, {
      route: '/books?query=status%3Areading%20author%3AToika',
    })

    await screen.findByText('Lord of Mysteries')
    await waitFor(() => expect(api.getBooksSummary).toHaveBeenCalledWith({ query: 'author:Toika' }))
    const completed = await screen.findByRole('button', { name: /Completed\s*1/ })
    expect(completed).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: /Reading\s*1/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('button', { name: /Dropped\s*0/ })).toBeInTheDocument()
  })

  it('links to Stats with the current complex query', async () => {
    vi.mocked(api.getBooks).mockResolvedValue(paginated(books))
    vi.mocked(api.getBooksSummary).mockResolvedValue(createSummary())

    renderWithProviders(<BooksPage />, {
      route: '/books?query=author%3AToika%20title%3A%22Lord%20of%20Mysteries%22',
    })

    expect(await screen.findByRole('link', { name: 'Open in Stats' })).toHaveAttribute(
      'href',
      '/analytics?query=author%3AToika+title%3A%22Lord+of+Mysteries%22',
    )
  })

  it('moves date query filters into the Stats from/to parameters', async () => {
    vi.mocked(api.getBooks).mockResolvedValue(paginated(books))
    vi.mocked(api.getBooksSummary).mockResolvedValue(createSummary())

    renderWithProviders(<BooksPage />, {
      route: '/books?query=author%3AToika%20created%3A%3D2026%20updated%3A%3C%3D07.2026',
    })

    expect(await screen.findByRole('link', { name: 'Open in Stats' })).toHaveAttribute(
      'href',
      '/analytics?query=author%3AToika&from=2026-01-01&to=2026-08-01',
    )
  })

  it('links to Stats without a query', async () => {
    vi.mocked(api.getBooks).mockResolvedValue(paginated(books))
    vi.mocked(api.getBooksSummary).mockResolvedValue(createSummary())

    renderWithProviders(<BooksPage />, { route: '/books' })

    expect(await screen.findByRole('link', { name: 'Open in Stats' })).toHaveAttribute(
      'href',
      '/analytics',
    )
  })

  it('lets the user pick a card size, persists it and fills whole rows per page', async () => {
    vi.mocked(api.getBooks).mockResolvedValue(paginated(books))
    const user = userEvent.setup()

    const { container } = renderWithProviders(<BooksPage />, { route: '/books' })

    await screen.findByText('Lord of Mysteries')
    await user.click(screen.getByRole('button', { name: /cards/i }))
    expect(screen.getByRole('button', { name: 'Medium cards' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await user.click(screen.getByRole('button', { name: 'Small cards' }))

    expect(window.localStorage.getItem('novelki.books.card-size.v1')).toBe('small')
    expect(
      container
        .querySelector<HTMLElement>('.book-card-grid')
        ?.style.getPropertyValue('--card-columns'),
    ).toBe(getCardGridColumns('small'))
    const columns = getCardColumnCount('small', window.innerWidth - 64, false)
    const options = getCardPageSizeOptions(columns)
    await waitFor(() =>
      expect(api.getBooks).toHaveBeenLastCalledWith(
        expect.objectContaining({ take: getClosestPageSize(20, options) }),
      ),
    )
    for (const option of options) {
      expect(screen.getByRole('combobox', { name: /per page/i })).toHaveTextContent(String(option))
    }
  })

  it('keeps every dense card constrained to its grid track', async () => {
    vi.mocked(api.getBooks).mockResolvedValue(paginated(books))
    const user = userEvent.setup()

    const { container } = renderWithProviders(<BooksPage />, { route: '/books' })

    await screen.findByText('Lord of Mysteries')
    await user.click(screen.getByRole('button', { name: /cards/i }))
    await user.click(screen.getByRole('button', { name: 'Small cards' }))

    const cards = Array.from(container.querySelectorAll('.book-card'))
    expect(cards).toHaveLength(books.length)
    cards.forEach((card) => {
      expect(card).toHaveClass('book-card', 'min-w-0', 'w-full', 'max-w-full')
      expect(card.querySelector('a')).toHaveClass(
        'min-w-0',
        'w-full',
        'max-w-full',
        'overflow-hidden',
      )
      expect(card.querySelector('.book-card__cover')).toHaveClass('min-w-0', 'w-full', 'max-w-full')
    })
  })

  it('shows rating overlays only on cards with a rating', async () => {
    vi.mocked(api.getBooks).mockResolvedValue(paginated(books))
    const user = userEvent.setup()

    renderWithProviders(<BooksPage />, { route: '/books' })

    await screen.findByText('Lord of Mysteries')
    await user.click(screen.getByRole('button', { name: /cards/i }))

    const ratingBadge = screen.getByLabelText('Rating 9 out of 10')
    expect(ratingBadge).toHaveClass('book-card-rating')
    expect(ratingBadge.querySelector('.book-card-rating__star')).toBeInTheDocument()
    expect(ratingBadge).toHaveTextContent('9')
  })

  it('uses a red rating treatment for scores up to and including five', async () => {
    vi.mocked(api.getBooks).mockResolvedValue(paginated([books[0]!, { ...books[1]!, rating: 5 }]))
    const user = userEvent.setup()

    renderWithProviders(<BooksPage />, { route: '/books' })

    await screen.findByText('Lord of Mysteries')
    await user.click(screen.getByRole('button', { name: /cards/i }))

    expect(screen.getByLabelText('Rating 9 out of 10')).not.toHaveClass('book-card-rating--low')
    const lowRating = screen.getByLabelText('Rating 5 out of 10')
    expect(lowRating).toHaveClass('book-card-rating--low')
    expect(lowRating.querySelector('.book-card-rating__star')).toBeInTheDocument()
  })

  it('shows status overlays on cards with status-specific colors', async () => {
    vi.mocked(api.getBooks).mockResolvedValue(paginated(books))
    const user = userEvent.setup()

    renderWithProviders(<BooksPage />, { route: '/books' })

    await screen.findByText('Lord of Mysteries')
    await user.click(screen.getByRole('button', { name: /cards/i }))

    expect(screen.getByLabelText('Book status: Reading').closest('article')).toHaveAttribute(
      'data-status-tone',
      'reading',
    )
    expect(screen.getByLabelText('Book status: Completed').closest('article')).toHaveAttribute(
      'data-status-tone',
      'finished',
    )
    expect(screen.getByLabelText('Book status: Reading')).toHaveTextContent('Reading')
  })

  it('gives completed cards a dedicated golden glow treatment', async () => {
    vi.mocked(api.getBooks).mockResolvedValue(paginated(books))
    const user = userEvent.setup()

    const { container } = renderWithProviders(<BooksPage />, { route: '/books' })

    await screen.findByText('Lord of Mysteries')
    await user.click(screen.getByRole('button', { name: /cards/i }))

    const cards = Array.from(container.querySelectorAll('.book-card'))
    expect(cards[0]).not.toHaveClass('book-card--completed')
    expect(cards[1]).toHaveClass('book-card--completed')
  })

  it('shows card-specific field options in the columns popup for cards view', async () => {
    vi.mocked(api.getBooks).mockResolvedValue(paginated(books))
    const user = userEvent.setup()

    renderWithProviders(<BooksPage />, { route: '/books' })

    await screen.findByText('Lord of Mysteries')
    await user.click(screen.getByRole('button', { name: /cards/i }))
    await user.click(screen.getByRole('button', { name: /^columns$/i }))

    expect(screen.getByText('Visible card fields')).toBeInTheDocument()
    expect(screen.getByText('Alternative titles')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^type$/i })).toBeInTheDocument()
    expect(screen.queryByText('Tags')).not.toBeInTheDocument()
    expect(screen.queryByText('Description')).not.toBeInTheDocument()
    expect(screen.queryByText('Chapters')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Up' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Down' })).not.toBeInTheDocument()
  })

  it('hides and shows card fields based on cards view preferences', async () => {
    vi.mocked(api.getBooks).mockResolvedValue(paginated(books))
    const user = userEvent.setup()

    renderWithProviders(<BooksPage />, { route: '/books' })

    await screen.findByText('Lord of Mysteries')
    await user.click(screen.getByRole('button', { name: /cards/i }))

    expect(screen.getByText('Cuttlefish')).toBeInTheDocument()
    expect(screen.queryByText('LOTM')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^columns$/i }))
    await user.click(screen.getByRole('button', { name: /author/i }))
    await user.click(screen.getByRole('button', { name: /alternative titles/i }))
    await user.click(screen.getByRole('button', { name: /type/i }))

    expect(screen.queryByText('Cuttlefish')).not.toBeInTheDocument()
    expect(screen.getByText('LOTM')).toBeInTheDocument()
    expect(screen.getAllByText('Novel').at(-1)).toHaveClass('truncate', 'text-ink-3')
    expect(window.localStorage.getItem('novelki.books.card-fields.v1')).toContain(
      '"alternativeTitles"',
    )
  })

  it('updates query params and refetches when sorting by title', async () => {
    vi.mocked(api.getBooks).mockResolvedValue(paginated(books))
    const user = userEvent.setup()

    renderWithProviders(<BooksPage />, { route: '/books' })

    await screen.findByText('Lord of Mysteries')
    await user.click(screen.getByRole('button', { name: /^title$/i }))

    await waitFor(() =>
      expect(api.getBooks).toHaveBeenLastCalledWith(
        expect.objectContaining({
          skip: 0,
          take: 20,
          query: '',
          sortBy: 'title',
          sortDirection: 'asc',
        }),
      ),
    )
  })

  it('sorts by total chapters from the table column', async () => {
    window.localStorage.setItem(
      'novelki.books.columns.v1',
      JSON.stringify([{ id: 'totalChapters', visible: true }]),
    )
    vi.mocked(api.getBooks).mockResolvedValue(paginated(books))
    const user = userEvent.setup()

    renderWithProviders(<BooksPage />, { route: '/books' })

    await screen.findByText('Lord of Mysteries')
    await user.click(screen.getByRole('button', { name: /^(total chapters|total)/i }))

    await waitFor(() =>
      expect(api.getBooks).toHaveBeenLastCalledWith(
        expect.objectContaining({
          skip: 0,
          take: 20,
          query: '',
          sortBy: 'chapters',
          sortDirection: 'asc',
        }),
      ),
    )
  })

  it('renders the total chapters column label in the shared column settings', async () => {
    window.localStorage.setItem(
      'novelki.books.columns.v1',
      JSON.stringify([{ id: 'totalChapters', visible: true }]),
    )
    vi.mocked(api.getBooks).mockResolvedValue(paginated(books))
    const user = userEvent.setup()

    renderWithProviders(<BooksPage />, { route: '/books' })

    await screen.findByText('Lord of Mysteries')
    await user.click(screen.getByRole('button', { name: /^columns$/i }))

    expect(screen.getAllByText('Total chapters').length).toBeGreaterThan(0)
  })

  it('cycles status sorting through the domain order on repeated clicks', async () => {
    vi.mocked(api.getBooks).mockImplementation((params) => {
      if (params.advanceCycle) {
        return Promise.resolve({
          ...paginated(books),
          data:
            params.sortDirection === statuses[0]!.name
              ? [books[1]!, books[0]!]
              : [books[0]!, books[1]!],
        })
      }

      return Promise.resolve(paginated(books))
    })
    const user = userEvent.setup()

    renderWithProviders(<BooksPage />, { route: '/books' })

    await screen.findByText('Lord of Mysteries')
    const statusHeader = screen.getByRole('button', { name: /status/i })

    await user.click(statusHeader)
    await waitFor(() =>
      expect(api.getBooks).toHaveBeenLastCalledWith(
        expect.objectContaining({
          sortBy: 'status',
          advanceCycle: true,
        }),
      ),
    )

    await user.click(statusHeader)
    await waitFor(() =>
      expect(api.getBooks).toHaveBeenLastCalledWith(
        expect.objectContaining({
          sortBy: 'status',
          sortDirection: statuses[0]!.name,
          advanceCycle: true,
        }),
      ),
    )

    await user.click(statusHeader)
    await waitFor(() =>
      expect(api.getBooks).toHaveBeenLastCalledWith(
        expect.objectContaining({
          sortBy: 'status',
          sortDirection: statuses[1]!.name,
          advanceCycle: true,
        }),
      ),
    )
  })

  it('does not refetch after syncing the resolved cyclic sort direction into the url', async () => {
    vi.mocked(api.getBooks).mockImplementation((params) => {
      if (params.advanceCycle) {
        return Promise.resolve({
          ...paginated(books),
          data: [books[0]!, books[1]!],
        })
      }

      return Promise.resolve(paginated(books))
    })
    const user = userEvent.setup()

    renderWithProviders(<BooksPage />, { route: '/books' })

    await screen.findByText('Lord of Mysteries')
    const initialCalls = vi.mocked(api.getBooks).mock.calls.length

    await user.click(screen.getByRole('button', { name: /status/i }))

    await waitFor(() =>
      expect(api.getBooks).toHaveBeenCalledWith(
        expect.objectContaining({
          sortBy: 'status',
          advanceCycle: true,
        }),
      ),
    )
    await waitFor(() => expect(vi.mocked(api.getBooks).mock.calls.length).toBe(initialCalls + 1))
  })

  it('cycles type sorting through the domain order on repeated clicks', async () => {
    const typeBooks = [
      books[0]!,
      {
        ...books[1]!,
        contentType: 'Manga',
      },
    ]
    vi.mocked(api.getBooks).mockImplementation((params) => {
      if (params.advanceCycle) {
        return Promise.resolve({
          ...paginated(typeBooks),
          data:
            params.sortDirection === dictionaries[0]!.name
              ? [typeBooks[1]!, typeBooks[0]!]
              : [typeBooks[0]!, typeBooks[1]!],
        })
      }

      return Promise.resolve(paginated(typeBooks))
    })
    const user = userEvent.setup()

    renderWithProviders(<BooksPage />, { route: '/books' })

    await screen.findByText('Lord of Mysteries')
    const typeHeader = screen.getByRole('button', { name: /type/i })

    await user.click(typeHeader)
    await waitFor(() =>
      expect(api.getBooks).toHaveBeenLastCalledWith(
        expect.objectContaining({
          sortBy: 'type',
          advanceCycle: true,
        }),
      ),
    )

    await user.click(typeHeader)
    await waitFor(() =>
      expect(api.getBooks).toHaveBeenLastCalledWith(
        expect.objectContaining({
          sortBy: 'type',
          sortDirection: dictionaries[0]!.name,
          advanceCycle: true,
        }),
      ),
    )

    await user.click(typeHeader)
    await waitFor(() =>
      expect(api.getBooks).toHaveBeenLastCalledWith(
        expect.objectContaining({
          sortBy: 'type',
          sortDirection: dictionaries[1]!.name,
          advanceCycle: true,
        }),
      ),
    )
  })

  it('shows page numbers and supports jumping to a specific page', async () => {
    vi.mocked(api.getBooks).mockResolvedValue({
      skip: 0,
      take: 20,
      total: 220,
      data: books,
    })
    const user = userEvent.setup()

    renderWithProviders(<BooksPage />, { route: '/books' })

    await screen.findByText('Lord of Mysteries')
    expect(screen.getByRole('button', { name: '1' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: '2' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '11' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /jump between pages/i })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '2' }))

    await waitFor(() =>
      expect(api.getBooks).toHaveBeenLastCalledWith(
        expect.objectContaining({
          skip: 20,
          take: 20,
          query: '',
          sortBy: 'lastModified',
          sortDirection: 'desc',
        }),
      ),
    )

    await user.click(screen.getByRole('button', { name: /next page/i }))

    await waitFor(() =>
      expect(api.getBooks).toHaveBeenLastCalledWith(
        expect.objectContaining({
          skip: 40,
          take: 20,
          query: '',
          sortBy: 'lastModified',
          sortDirection: 'desc',
        }),
      ),
    )

    await user.click(screen.getByRole('button', { name: /jump between pages/i }))
    const jumpInput = screen.getByRole('textbox', { name: /page number/i })
    await user.type(jumpInput, '11')
    await user.keyboard('{Enter}')

    await waitFor(() =>
      expect(api.getBooks).toHaveBeenLastCalledWith(
        expect.objectContaining({
          skip: 200,
          take: 20,
          query: '',
          sortBy: 'lastModified',
          sortDirection: 'desc',
        }),
      ),
    )
  })

  it('renders the list footer after table and cards content without sticky spacing', async () => {
    vi.mocked(api.getBooks).mockResolvedValue(paginated(books))
    const user = userEvent.setup()

    const { container } = renderWithProviders(<BooksPage />, { route: '/books' })

    await screen.findByText('Lord of Mysteries')
    let footer = container.querySelector('#book-list-results > :last-child')
    expect(footer).toHaveTextContent('Per page')
    expect(container.querySelector('.overflow-x-auto.pb-24')).toBeFalsy()
    expect(container.querySelector('section > .sticky.bottom-0')).toBeFalsy()

    await user.click(screen.getByRole('button', { name: /cards/i }))

    footer = container.querySelector('#book-list-results > :last-child')
    expect(footer).toHaveTextContent('Per page')
    expect(container.querySelector('.grid.gap-4.p-4.pb-24')).toBeFalsy()
    expect(container.querySelector('section > .sticky.bottom-0')).toBeFalsy()
  })

  it('keeps the page jump popover open for invalid page numbers', async () => {
    vi.mocked(api.getBooks).mockResolvedValue({
      skip: 0,
      take: 20,
      total: 220,
      data: books,
    })
    const user = userEvent.setup()

    renderWithProviders(<BooksPage />, { route: '/books' })

    await screen.findByText('Lord of Mysteries')
    await user.click(screen.getByRole('button', { name: /jump between pages/i }))

    const jumpInput = screen.getByRole('textbox', { name: /page number/i })
    await user.type(jumpInput, '0')
    await user.keyboard('{Enter}')

    expect(jumpInput).toHaveAttribute('aria-invalid', 'true')
    expect(api.getBooks).toHaveBeenCalledTimes(1)
  })

  it('focuses the page jump input immediately after opening the gap popover', async () => {
    vi.mocked(api.getBooks).mockResolvedValue({
      skip: 0,
      take: 20,
      total: 220,
      data: books,
    })
    const user = userEvent.setup()

    renderWithProviders(<BooksPage />, { route: '/books' })

    await screen.findByText('Lord of Mysteries')
    await user.click(screen.getByRole('button', { name: /jump between pages/i }))

    expect(screen.getByRole('textbox', { name: /page number/i })).toHaveFocus()
  })

  it('keeps only one page gap popover open at a time', async () => {
    vi.mocked(api.getBooks).mockResolvedValue({
      skip: 100,
      take: 20,
      total: 420,
      data: books,
    })
    const user = userEvent.setup()

    renderWithProviders(<BooksPage />, { route: '/books?skip=100&take=20' })

    await screen.findByText('Lord of Mysteries')
    const gapButtons = screen.getAllByRole('button', { name: /jump between pages/i })
    expect(gapButtons).toHaveLength(2)

    await user.click(gapButtons[0]!)
    expect(screen.getByRole('textbox', { name: /page number/i })).toBeInTheDocument()
    expect(gapButtons[0]).toHaveAttribute('aria-expanded', 'true')
    expect(gapButtons[1]).toHaveAttribute('aria-expanded', 'false')

    await user.click(gapButtons[1]!)
    expect(screen.getByRole('textbox', { name: /page number/i })).toBeInTheDocument()
    expect(gapButtons[0]).toHaveAttribute('aria-expanded', 'false')
    expect(gapButtons[1]).toHaveAttribute('aria-expanded', 'true')
  })

  it('scrolls to the top of the table when changing pages near the page bottom', async () => {
    vi.mocked(api.getBooks).mockResolvedValue({
      skip: 0,
      take: 20,
      total: 220,
      data: books,
    })
    const user = userEvent.setup()
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)

    Object.defineProperty(window, 'scrollY', { configurable: true, value: 1190 })

    renderWithProviders(<BooksPage />, { route: '/books' })

    await screen.findByText('Lord of Mysteries')
    vi.spyOn(
      document.getElementById('book-list-results')!,
      'getBoundingClientRect',
    ).mockReturnValue({
      top: -790,
    } as DOMRect)
    await user.click(screen.getByRole('button', { name: '2' }))

    await waitFor(() => {
      expect(scrollTo).toHaveBeenCalledWith({ top: 400, behavior: 'auto' })
    })

    scrollTo.mockRestore()
  })

  it('shows scroll shortcut buttons and scrolls to the top or bottom on click', async () => {
    vi.mocked(api.getBooks).mockResolvedValue(paginated(books))
    const user = userEvent.setup()
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 })
    Object.defineProperty(document.documentElement, 'scrollHeight', {
      configurable: true,
      value: 2400,
    })
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 })

    renderWithProviders(<BooksPage />, { route: '/books' })

    await screen.findByText('Lord of Mysteries')
    expect(screen.queryByRole('button', { name: /back to top/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /go to bottom/i })).toBeInTheDocument()

    Object.defineProperty(window, 'scrollY', { configurable: true, value: 640 })
    window.dispatchEvent(new Event('scroll'))

    const backToTopButton = await screen.findByRole('button', { name: /back to top/i })
    const goToBottomButton = screen.getByRole('button', { name: /go to bottom/i })
    expect(backToTopButton).toHaveClass('ui-icon-button--round')
    expect(goToBottomButton).toHaveClass('ui-icon-button--round')
    await user.click(backToTopButton)
    await user.click(goToBottomButton)

    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' })
    expect(scrollTo).toHaveBeenCalledWith({ top: 2400, behavior: 'smooth' })
    scrollTo.mockRestore()
  })

  it('keeps column visibility helpers deterministic', () => {
    const columns = [
      { id: 'title', label: 'Title', defaultVisible: true, render: () => 'Title' },
      { id: 'notes', label: 'Notes', defaultVisible: false, render: () => 'Notes' },
    ]

    const preferences = defaultColumnPreferences(columns)

    expect(preferences).toEqual([
      { id: 'title', visible: true },
      { id: 'notes', visible: false },
    ])
    expect(getVisibleColumns(columns, preferences).map((column) => column.id)).toEqual(['title'])
  })

  it('calculates a predictable columns popup position on desktop and mobile', () => {
    expect(getColumnPopupPosition({ left: 400, right: 520, bottom: 100 }, 1280, 720)).toEqual({
      left: '200px',
      top: '110px',
    })

    expect(getColumnPopupPosition({ left: 40, right: 180, bottom: 80 }, 390, 844)).toEqual({
      left: '16px',
      top: '90px',
    })
  })

  it('formats progress with chapter label and total', () => {
    expect(formatProgress(books[0]!)).toBe('348 / 1432')
    expect(
      formatProgress({
        ...books[0]!,
        currentChapterLabel: 'Side Story',
        currentChapterNumber: null,
      }),
    ).toBe('Side Story / 1432')
    expect(
      formatProgress({
        ...books[0]!,
        currentChapterLabel: null,
        currentChapterNumber: null,
        totalChapters: null,
      }),
    ).toBe('-')
  })

  it('formats average rating for summary cards', () => {
    expect(formatAverageRating(8)).toBe('8.0')
    expect(formatAverageRating(8.25)).toBe('8.3')
    expect(formatAverageRating(null)).toBe('-')
  })

  it('reads the card size, mapping an older cards-per-row choice', () => {
    window.localStorage.removeItem('novelki.books.card-size.v1')
    window.localStorage.setItem('novelki.books.cards-per-row.v1', '8')
    expect(readCardSize('novelki.books.card-size.v1', 'novelki.books.cards-per-row.v1')).toBe(
      'small',
    )
    window.localStorage.setItem('novelki.books.cards-per-row.v1', '4')
    expect(readCardSize('novelki.books.card-size.v1', 'novelki.books.cards-per-row.v1')).toBe(
      'large',
    )
    window.localStorage.setItem('novelki.books.card-size.v1', 'nonsense')
    window.localStorage.removeItem('novelki.books.cards-per-row.v1')
    expect(readCardSize('novelki.books.card-size.v1', 'novelki.books.cards-per-row.v1')).toBe(
      'medium',
    )
  })

  it('keeps card page sizes aligned to complete rows', () => {
    expect(getCardPageSizeOptions(1)).toEqual([20, 50, 100, 500])
    expect(getCardPageSizeOptions(3)).toEqual([21, 51, 102, 498])
    expect(getCardPageSizeOptions(4)).toEqual([20, 52, 100, 500])
    expect(getCardPageSizeOptions(6)).toEqual([24, 54, 102, 498])
    expect(getCardPageSizeOptions(7)).toEqual([21, 56, 105, 497])
    expect(getCardPageSizeOptions(8)).toEqual([24, 56, 104, 496])
    expect(getClosestPageSize(50, getCardPageSizeOptions(6))).toBe(54)
    expect(getClosestPageSize(20, getCardPageSizeOptions(8))).toBe(24)
    for (const cardsPerRow of [2, 3, 4, 5, 6, 7, 8]) {
      expect(
        getCardPageSizeOptions(cardsPerRow).every(
          (pageSize) => pageSize <= 500 && pageSize % cardsPerRow === 0,
        ),
      ).toBe(true)
    }
  })

  it('counts the columns that fit, with two on phones', () => {
    expect(getCardColumnCount('large', 2000, true)).toBe(2)
    expect(getCardColumnCount('medium', 1376, false)).toBe(5)
    expect(getCardColumnCount('small', 1376, false)).toBe(7)
    expect(getCardColumnCount('large', 2176, false)).toBe(7)
    expect(getCardColumnCount('large', 200, false)).toBe(1)
  })

  it('scales card text sizes with the cards-per-row setting', () => {
    expect(getCardTextSizeClasses(4)).toEqual({
      title: 'text-[15px]',
      meta: 'text-[13px]',
    })
    expect(getCardTextSizeClasses(6)).toEqual({
      title: 'text-sm',
      meta: 'text-xs',
    })
    expect(getCardTextSizeClasses(8)).toEqual({
      title: 'text-[13px]',
      meta: 'text-xs',
    })
  })

  it('builds card detail rows only from globally enabled card fields', () => {
    expect(
      getCardDetailRowClass({
        cardsPerRow: 4,
        showAlternativeTitles: false,
        showAuthor: false,
        showProgress: false,
        showTitle: true,
        showType: false,
      }),
    ).toBe('grid-rows-[minmax(0,3.5rem)]')

    expect(
      getCardDetailRowClass({
        cardsPerRow: 4,
        showAlternativeTitles: false,
        showAuthor: true,
        showProgress: true,
        showTitle: true,
        showType: true,
      }),
    ).toBe('grid-rows-[minmax(0,3.5rem)_minmax(0,1.5rem)_minmax(0,1.75rem)]')
  })

  it('uses tighter card detail row presets as more cards are shown per row', () => {
    const visibleFields = {
      showAlternativeTitles: false,
      showAuthor: true,
      showProgress: false,
      showTitle: true,
      showType: false,
    }

    expect(getCardDetailRowClass({ cardsPerRow: 4, ...visibleFields })).toBe(
      'grid-rows-[minmax(0,3.5rem)_minmax(0,1.5rem)]',
    )
    expect(getCardDetailRowClass({ cardsPerRow: 6, ...visibleFields })).toBe(
      'grid-rows-[minmax(0,3rem)_minmax(0,1.25rem)]',
    )
    expect(getCardDetailRowClass({ cardsPerRow: 8, ...visibleFields })).toBe(
      'grid-rows-[minmax(0,2.5rem)_minmax(0,1rem)]',
    )
    expect(getCardDetailRowClass({ cardsPerRow: 8, ...visibleFields, showProgress: true })).toBe(
      'grid-rows-[minmax(0,2.5rem)_minmax(0,1rem)_minmax(0,1.25rem)]',
    )
  })

  it('uses tighter card row min-heights for dense card layouts', () => {
    expect(getCardRowMinHeightClasses(4)).toEqual({
      author: 'min-h-6',
      progress: 'min-h-7',
    })
    expect(getCardRowMinHeightClasses(6)).toEqual({
      author: 'min-h-5',
      progress: 'min-h-6',
    })
    expect(getCardRowMinHeightClasses(8)).toEqual({
      author: 'min-h-4',
      progress: 'min-h-5',
    })
  })

  function createSummary() {
    return {
      totalBooks: 2,
      ratedBooks: 1,
      unratedBooks: 1,
      averageRating: 9,
      currentChapters: 468,
      booksWithKnownCurrentChapter: 2,
      booksWithoutKnownCurrentChapter: 0,
      statusCounts: [
        { status: 'Reading', count: 1 },
        { status: 'Completed', count: 1 },
      ],
      typeCounts: [{ type: 'Novel', bookCount: 2, currentChapters: 468 }],
      genreCounts: [
        { genre: 'Fantasy', bookCount: 1 },
        { genre: 'Slice of Life', bookCount: 1 },
      ],
      ratingCounts: [{ rating: 9, bookCount: 1 }],
    }
  }
})
