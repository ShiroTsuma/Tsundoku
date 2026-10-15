import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/api/client'
import type { AdminBookListItemDto, PaginatedResult } from '@/api/types'
import { paginated } from '@/test/fixtures'
import { renderWithProviders } from '@/test/render'
import { AdminPage } from './AdminPage'

vi.mock('@/api/client', () => ({
  api: {
    getAdminBooks: vi.fn(),
    deleteAdminBooksByOwner: vi.fn(),
    createAdminStatus: vi.fn(),
    createAdminType: vi.fn(),
    createAdminGenre: vi.fn(),
    getStatuses: vi.fn(),
    getTypes: vi.fn(),
    getGenres: vi.fn(),
    searchAdminGlobalTags: vi.fn(),
    getAdminUsers: vi.fn(),
    deleteAdminUser: vi.fn(),
  },
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

describe('AdminPage', () => {
  beforeEach(() => {
    vi.mocked(api.getAdminBooks).mockReset()
    vi.mocked(api.getStatuses).mockResolvedValue({ skip: 0, take: 100, total: 0, data: [] })
    vi.mocked(api.getAdminUsers).mockResolvedValue({ skip: 0, take: 100, total: 0, data: [] })
  })

  it('keeps the section in the URL and shows one section at a time', async () => {
    vi.mocked(api.getAdminBooks).mockResolvedValue(paginated([]))
    const user = userEvent.setup()
    renderWithProviders(<AdminPage />, { route: '/admin?tab=accounts' })

    expect(screen.getByRole('tab', { name: 'Accounts' })).toHaveAttribute('aria-selected', 'true')
    expect(await screen.findByPlaceholderText('Search by username or email…')).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Dictionary' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Dictionaries' }))
    expect(screen.getByRole('group', { name: 'Dictionary' })).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('Search by username or email…')).not.toBeInTheDocument()
  })

  it('filters admin books using the normalized query string', async () => {
    vi.mocked(api.getAdminBooks).mockResolvedValue(
      paginated([
        createAdminBook({
          id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
          primaryTitle: 'Lord of Mysteries',
        }),
      ]),
    )

    renderWithProviders(<AdminPage />, {
      route: '/admin?query=%20title%3ALord%20&sortBy=title&sortDirection=asc',
    })

    expect(await screen.findByText('Lord of Mysteries')).toBeInTheDocument()
    expect(screen.queryByText('Shadow Slave')).not.toBeInTheDocument()
    expect(api.getAdminBooks).toHaveBeenCalledWith({
      skip: 0,
      take: 20,
      query: 'title:Lord',
      sortBy: 'title',
      sortDirection: 'asc',
    })
  })

  it('shows an empty state when the admin search returns no matches', async () => {
    vi.mocked(api.getAdminBooks).mockResolvedValue({
      skip: 0,
      take: 20,
      total: 0,
      data: [],
    })

    renderWithProviders(<AdminPage />, {
      route: '/admin?query=title%3AMissing&sortBy=title&sortDirection=asc',
    })

    expect(await screen.findByText('No books match the search.')).toBeInTheDocument()
    await waitFor(() =>
      expect(api.getAdminBooks).toHaveBeenCalledWith({
        skip: 0,
        take: 20,
        query: 'title:Missing',
        sortBy: 'title',
        sortDirection: 'asc',
      }),
    )
  })

  it('filters admin books by typed status query', async () => {
    const reading = createAdminBook({
      id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      primaryTitle: 'Reading Title',
      status: 'Reading',
    })
    const completed = createAdminBook({
      id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      primaryTitle: 'Completed Title',
      status: 'Completed',
    })
    vi.mocked(api.getAdminBooks).mockImplementation((params) =>
      Promise.resolve(
        params.query === 'status:completed'
          ? paginated([completed])
          : paginated([reading, completed]),
      ),
    )
    const user = userEvent.setup()

    renderWithProviders(<AdminPage />, { route: '/admin' })

    expect(await screen.findByText('Reading Title')).toBeInTheDocument()
    await user.type(screen.getByPlaceholderText(/rating:>=8/i), 'status:completed')

    await waitFor(() =>
      expect(api.getAdminBooks).toHaveBeenLastCalledWith(
        expect.objectContaining({
          skip: 0,
          take: 20,
          query: 'status:completed',
          sortBy: 'lastModified',
          sortDirection: 'desc',
        }),
      ),
    )
    expect(await screen.findByText('Completed Title')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('Reading Title')).not.toBeInTheDocument())
  })

  it('preserves spaces in the admin search input while sending a trimmed query to the api', async () => {
    vi.mocked(api.getAdminBooks).mockResolvedValue(paginated([createAdminBook()]))
    const user = userEvent.setup()

    renderWithProviders(<AdminPage />, { route: '/admin' })

    await screen.findByText('Shadow Slave')
    const searchInput = screen.getByPlaceholderText(/rating:>=8/i)
    await user.clear(searchInput)
    await user.type(searchInput, 'status:plan to read ')

    expect(searchInput).toHaveValue('status:plan to read ')
    await waitFor(() =>
      expect(api.getAdminBooks).toHaveBeenLastCalledWith(
        expect.objectContaining({
          query: 'status:plan to read',
        }),
      ),
    )
  })

  it('keeps previous admin rows visible while the next search is fetching', async () => {
    const pendingSearch = createDeferred<PaginatedResult<AdminBookListItemDto>>()
    vi.mocked(api.getAdminBooks).mockImplementation((params) => {
      if (params.query === 'status:completed') {
        return pendingSearch.promise
      }

      return Promise.resolve(
        paginated([
          createAdminBook({
            id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            primaryTitle: 'Reading Title',
            status: 'Reading',
          }),
        ]),
      )
    })
    const user = userEvent.setup()

    renderWithProviders(<AdminPage />, { route: '/admin' })

    expect(await screen.findByText('Reading Title')).toBeInTheDocument()
    await user.type(screen.getByPlaceholderText(/rating:>=8/i), 'status:completed')

    await waitFor(() =>
      expect(api.getAdminBooks).toHaveBeenLastCalledWith(
        expect.objectContaining({
          query: 'status:completed',
        }),
      ),
    )
    expect(screen.getByText('Reading Title')).toBeInTheDocument()
    expect(screen.getByText('Searching…')).toBeInTheDocument()

    pendingSearch.resolve(
      paginated([
        createAdminBook({
          id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
          primaryTitle: 'Completed Title',
          status: 'Completed',
        }),
      ]),
    )

    expect(await screen.findByText('Completed Title')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('Searching…')).not.toBeInTheDocument())
  })

  it('uses the shared numbered pagination controls', async () => {
    vi.mocked(api.getAdminBooks).mockResolvedValue({
      skip: 0,
      take: 20,
      total: 220,
      data: [createAdminBook()],
    })
    const user = userEvent.setup()

    renderWithProviders(<AdminPage />, { route: '/admin' })

    expect(await screen.findByText('Shadow Slave')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '1' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: '2' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '11' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '2' }))

    await waitFor(() =>
      expect(api.getAdminBooks).toHaveBeenLastCalledWith(
        expect.objectContaining({
          skip: 20,
          take: 20,
        }),
      ),
    )
  })

  it('sorts by total chapters from the admin table column', async () => {
    window.localStorage.setItem(
      'tsundoku.adminBooks.columns.v1',
      JSON.stringify([{ id: 'totalChapters', visible: true }]),
    )
    vi.mocked(api.getAdminBooks).mockResolvedValue(paginated([createAdminBook()]))
    const user = userEvent.setup()

    renderWithProviders(<AdminPage />, { route: '/admin' })

    expect(await screen.findByText('Shadow Slave')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /total chapters|total/i }))

    await waitFor(() =>
      expect(api.getAdminBooks).toHaveBeenLastCalledWith(
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

  it('shows shared scroll shortcut buttons', async () => {
    vi.mocked(api.getAdminBooks).mockResolvedValue(paginated([createAdminBook()]))
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
    const user = userEvent.setup()
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 })
    Object.defineProperty(document.documentElement, 'scrollHeight', {
      configurable: true,
      value: 2400,
    })
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 640 })

    renderWithProviders(<AdminPage />, { route: '/admin' })

    await screen.findByText('Shadow Slave')
    window.dispatchEvent(new Event('scroll'))

    const backToTopButton = await screen.findByRole('button', { name: /back to top/i })
    const goToBottomButton = screen.getByRole('button', { name: /go to bottom/i })
    await user.click(backToTopButton)
    await user.click(goToBottomButton)

    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' })
    expect(scrollTo).toHaveBeenCalledWith({ top: 2400, behavior: 'smooth' })
    scrollTo.mockRestore()
  })
})

function createAdminBook(overrides: Partial<AdminBookListItemDto> = {}): AdminBookListItemDto {
  return {
    id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    created: '2026-01-01T10:00:00Z',
    lastModified: '2026-02-01T10:00:00Z',
    primaryTitle: 'Shadow Slave',
    description: null,
    alternativeTitles: [],
    alternativeTitlesCount: 0,
    author: 'Guiltythree',
    authorOtherNames: [],
    contentType: 'Novel',
    status: 'Reading',
    currentChapterNumber: 100,
    currentChapterLabel: '100',
    totalChapters: 500,
    rating: 9,
    priority: 1,
    notes: null,
    cover: null,
    genres: ['Fantasy'],
    genreDescriptions: { Fantasy: 'Fantasy description' },
    genresCount: 1,
    tags: ['favorite'],
    tagDescriptions: { favorite: 'Favorite description' },
    tagsCount: 1,
    linksCount: 0,
    ownerId: '11111111-1111-1111-1111-111111111111',
    ownerUsername: 'admin-user',
    ownerEmail: 'admin@example.com',
    ...overrides,
  }
}

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })

  return { promise, resolve, reject }
}
