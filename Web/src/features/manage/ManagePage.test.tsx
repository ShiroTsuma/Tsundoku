import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/api/client'
import { renderWithProviders } from '@/test/render'
import { bookListItems, paginated } from '@/test/fixtures'
import type { ManagedBookListItemDto, PaginatedResult } from '@/api/types'
import { ManagePage } from './ManagePage'

function fixtureAt<T>(items: readonly T[], index: number): T {
  const item = items[index]
  if (item === undefined) {
    throw new Error(`Missing test fixture at index ${String(index)}`)
  }
  return item
}

const firstListItem = fixtureAt(bookListItems, 0)
const secondListItem = fixtureAt(bookListItems, 1)

vi.mock('@/api/client', () => ({
  api: {
    searchTags: vi.fn(),
    searchAuthors: vi.fn(),
    createTag: vi.fn(),
    createAuthor: vi.fn(),
    updateTag: vi.fn(),
    deleteTag: vi.fn(),
    updateAuthor: vi.fn(),
    updateAuthorVisibility: vi.fn(),
    deleteAuthor: vi.fn(),
    getManagedBooks: vi.fn(),
    publishBook: vi.fn(),
    refreshPublishedBook: vi.fn(),
    unlistPublishedBook: vi.fn(),
  },
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

const tag = {
  id: '11111111-1111-1111-1111-111111111111',
  name: 'favorite',
  description: 'The best ones',
  color: null,
  isGlobal: false,
}

const author = {
  id: '22222222-2222-2222-2222-222222222222',
  primaryName: 'Er Gen',
  otherNames: ['耳根'],
  isPublic: false,
  isOwned: true,
}

const publishedBook = {
  id: 'snapshot-1',
  sourceBookId: firstListItem.id,
  primaryTitle: firstListItem.primaryTitle,
  description: 'A snapshot',
  alternativeTitles: ['LOTM'],
  author: 'Cuttlefish',
  authorOtherNames: ['Cuttlefish That Loves Diving'],
  contentType: 'Novel',
  genres: [{ name: 'Fantasy', description: 'Magic' }],
  tags: [{ name: 'mystery', description: 'Secrets' }],
  coverUrl: null,
  snapshotAt: '2026-07-18T12:00:00Z',
  isOwner: true,
}

const firstManagedBook = {
  ...firstListItem,
  cover: {
    status: 'Found' as const,
    imageUrl: '/api/book/cover/first',
    thumbnailImageUrl: '/api/book/cover/first/thumbnail',
  },
}

const secondManagedBook = {
  ...secondListItem,
  description: 'A complete listing candidate',
  cover: {
    status: 'Uploaded' as const,
    imageUrl: '/api/book/cover',
    thumbnailImageUrl: '/api/book/cover/thumbnail',
  },
}

const managedBooks = [firstManagedBook, secondManagedBook]

const managedBookRows: ManagedBookListItemDto[] = managedBooks.map((book, index) => ({
  book,
  listing:
    index === 0
      ? {
          id: publishedBook.id,
          sourceBookId: book.id,
          snapshotAt: publishedBook.snapshotAt,
        }
      : null,
}))

describe('ManagePage', () => {
  beforeEach(() => {
    vi.mocked(api.searchTags).mockReset().mockResolvedValue([tag])
    vi.mocked(api.searchAuthors).mockReset().mockResolvedValue([author])
    vi.mocked(api.createTag).mockReset().mockResolvedValue(tag)
    vi.mocked(api.createAuthor).mockReset().mockResolvedValue(author)
    vi.mocked(api.updateTag).mockReset().mockResolvedValue(tag)
    vi.mocked(api.deleteTag).mockReset().mockResolvedValue(undefined)
    vi.mocked(api.updateAuthor).mockReset().mockResolvedValue(author)
    vi.mocked(api.updateAuthorVisibility).mockReset().mockResolvedValue(author)
    vi.mocked(api.deleteAuthor).mockReset().mockResolvedValue(undefined)
    vi.mocked(api.getManagedBooks).mockReset().mockResolvedValue(paginated(managedBookRows))
    vi.mocked(api.publishBook).mockReset().mockResolvedValue(publishedBook)
    vi.mocked(api.refreshPublishedBook).mockReset().mockResolvedValue(publishedBook)
    vi.mocked(api.unlistPublishedBook).mockReset().mockResolvedValue(undefined)
  })

  it('opens a tag on double click and saves its description', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ManagePage />)

    fireEvent.doubleClick(await screen.findByText('favorite'))
    const description = screen.getByLabelText('Description')
    await user.clear(description)
    await user.type(description, 'Worth rereading')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() =>
      expect(api.updateTag).toHaveBeenCalledWith(tag.id, {
        description: 'Worth rereading',
      }),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('searches authors by alias and saves one alternative name per line', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ManagePage />)

    await user.click(screen.getByRole('tab', { name: 'Authors' }))
    const search = screen.getByPlaceholderText('Search authors or aliases…')
    await user.type(search, 'Cuttlefish')
    await waitFor(() => expect(api.searchAuthors).toHaveBeenCalledWith('Cuttlefish', 50))

    await user.click(await screen.findByRole('button', { name: 'Edit author Er Gen' }))
    const aliases = screen.getByLabelText('Alternative names')
    await user.clear(aliases)
    await user.type(aliases, '耳根{enter}Ergen')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() =>
      expect(api.updateAuthor).toHaveBeenCalledWith(author.id, {
        otherNames: ['耳根', 'Ergen'],
      }),
    )
  })

  it('requires a second click before deleting a tag', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ManagePage />)

    await user.click(await screen.findByRole('button', { name: 'Edit tag favorite' }))
    await user.click(screen.getByRole('button', { name: 'Delete tag' }))
    expect(api.deleteTag).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Confirm delete' }))
    await waitFor(() => expect(api.deleteTag).toHaveBeenCalledWith(tag.id))
  })

  it('creates tags and authors from the active section', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ManagePage />)

    await user.click(await screen.findByRole('button', { name: 'Add tag' }))
    await user.type(screen.getByLabelText('Tag name'), 'to review')
    await user.type(screen.getByLabelText('Description'), 'Needs another look')
    await user.click(screen.getByRole('button', { name: 'Create tag' }))
    await waitFor(() =>
      expect(api.createTag).toHaveBeenCalledWith({
        name: 'to review',
        description: 'Needs another look',
      }),
    )

    await user.click(screen.getByRole('tab', { name: 'Authors' }))
    await user.click(await screen.findByRole('button', { name: 'Add author' }))
    await user.type(screen.getByLabelText('Primary name'), 'New Author')
    await user.type(screen.getByLabelText('Alternative names'), 'Pen Name')
    await user.click(screen.getByRole('button', { name: 'Create author' }))
    await waitFor(() =>
      expect(api.createAuthor).toHaveBeenCalledWith({
        primaryName: 'New Author',
        otherNames: ['Pen Name'],
      }),
    )
  })

  it('shows global tags as read-only', async () => {
    vi.mocked(api.searchTags).mockResolvedValue([
      { ...tag, id: 'global-tag', name: 'official', isGlobal: true },
    ])
    renderWithProviders(<ManagePage />)

    expect(await screen.findByText('Global')).toBeInTheDocument()
    expect(screen.getByText('Managed by admin')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit tag official' })).not.toBeInTheDocument()
  })

  it('publishes a private author from the editor', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ManagePage />)

    await user.click(screen.getByRole('tab', { name: 'Authors' }))
    expect(await screen.findByText('Yours')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Edit author Er Gen' }))
    await user.click(screen.getByRole('button', { name: 'Make public' }))

    await waitFor(() => expect(api.updateAuthorVisibility).toHaveBeenCalledWith(author.id, true))
  })

  it('shows cloned global author identities as read-only known authors', async () => {
    vi.mocked(api.searchAuthors).mockResolvedValue([
      { ...author, id: 'global-author', isPublic: true, isOwned: false },
    ])
    const user = userEvent.setup()
    renderWithProviders(<ManagePage />)

    await user.click(screen.getByRole('tab', { name: 'Authors' }))

    expect(await screen.findByText('Global')).toBeInTheDocument()
    expect(screen.getByText('Global identity')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit author Er Gen' })).not.toBeInTheDocument()
  })

  it('keeps the current users public authors editable', async () => {
    vi.mocked(api.searchAuthors).mockResolvedValue([{ ...author, isPublic: true, isOwned: true }])
    const user = userEvent.setup()
    renderWithProviders(<ManagePage />)

    await user.click(screen.getByRole('tab', { name: 'Authors' }))

    expect(await screen.findByText('Yours')).toBeInTheDocument()
    expect(screen.getByText('Public')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit author Er Gen' })).toBeInTheDocument()
  })

  it('lists, refreshes, and unlists books from the books section', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ManagePage />)

    await user.click(screen.getByRole('tab', { name: 'Books' }))
    await user.click(
      await screen.findByRole('button', {
        name: `Refresh listing ${firstListItem.primaryTitle}`,
      }),
    )
    await waitFor(() => expect(api.refreshPublishedBook).toHaveBeenCalledWith(publishedBook.id))

    await user.click(screen.getByRole('button', { name: `Unlist ${firstListItem.primaryTitle}` }))
    await waitFor(() => expect(api.unlistPublishedBook).toHaveBeenCalledWith(publishedBook.id))

    await user.click(screen.getByRole('button', { name: `List ${secondListItem.primaryTitle}` }))
    await waitFor(() => expect(api.publishBook).toHaveBeenCalledWith(secondListItem.id))
  })

  it('passes exclusion queries from the books section without quoting them', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ManagePage />)

    await user.click(screen.getByRole('tab', { name: 'Books' }))
    await user.type(screen.getByPlaceholderText(/-tag:dropped/i), '-rating:8 -genre:romance')

    await waitFor(() =>
      expect(api.getManagedBooks).toHaveBeenLastCalledWith(
        expect.objectContaining({
          query: '-rating:8 -genre:romance',
        }),
      ),
    )
  })

  it('renders the server order and blocks incomplete listings', async () => {
    const incomplete = {
      ...secondListItem,
      id: 'incomplete-book',
      primaryTitle: 'Aardvark incomplete',
      description: null,
      author: null,
      genres: [],
      genresCount: 0,
      tags: [],
      tagsCount: 0,
      cover: null,
    }
    vi.mocked(api.getManagedBooks).mockResolvedValue(
      paginated([
        fixtureAt(managedBookRows, 0),
        { book: incomplete, listing: null },
        fixtureAt(managedBookRows, 1),
      ]),
    )
    renderWithProviders(<ManagePage />)

    await userEvent.click(screen.getByRole('tab', { name: 'Books' }))
    const rows = await screen.findAllByText(/Listed|Private/)
    expect(rows[0]).toHaveTextContent('Listed')
    expect(screen.getByRole('button', { name: 'List Aardvark incomplete' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'List Aardvark incomplete' })).toHaveAttribute(
      'title',
      expect.stringContaining('description'),
    )
  })

  it('preserves the listed-first alphabetical order returned by the backend', async () => {
    const privateA = { ...firstManagedBook, id: 'private-a', primaryTitle: 'A private' }
    const privateB = { ...firstManagedBook, id: 'private-b', primaryTitle: 'B private' }
    const listedC = { ...firstManagedBook, id: 'listed-c', primaryTitle: 'C listed' }
    const listedZ = { ...firstManagedBook, id: 'listed-z', primaryTitle: 'Z listed' }
    vi.mocked(api.getManagedBooks).mockResolvedValue(
      paginated([
        {
          book: listedC,
          listing: {
            id: 'snapshot-c',
            sourceBookId: listedC.id,
            snapshotAt: publishedBook.snapshotAt,
          },
        },
        {
          book: listedZ,
          listing: {
            id: 'snapshot-z',
            sourceBookId: listedZ.id,
            snapshotAt: publishedBook.snapshotAt,
          },
        },
        { book: privateA, listing: null },
        { book: privateB, listing: null },
      ]),
    )
    renderWithProviders(<ManagePage />)

    await userEvent.click(screen.getByRole('tab', { name: 'Books' }))
    const list = await screen.findByLabelText('Books')
    const titles = Array.from(
      list.querySelectorAll('[data-manage-title]'),
      (title) => title.textContent,
    )

    expect(titles).toEqual(['C listed', 'Z listed', 'A private', 'B private'])
  })

  it('allows listing when a legacy cover has a stored image despite a stale NotFound status', async () => {
    const legacyCoverBook = {
      ...secondManagedBook,
      id: 'legacy-cover-book',
      primaryTitle: 'Legacy cover book',
      cover: {
        status: 'NotFound' as const,
        source: 'ManualUpload',
        imageUrl: '/api/book/legacy/cover/file',
        thumbnailImageUrl: '/api/book/legacy/cover/thumbnail',
      },
    }
    vi.mocked(api.getManagedBooks).mockResolvedValue(
      paginated([{ book: legacyCoverBook, listing: null }]),
    )
    const user = userEvent.setup()
    renderWithProviders(<ManagePage />)

    await user.click(screen.getByRole('tab', { name: 'Books' }))
    const listButton = await screen.findByRole('button', { name: 'List Legacy cover book' })
    expect(listButton).toBeEnabled()
    await user.click(listButton)
    await waitFor(() => expect(api.publishBook).toHaveBeenCalledWith(legacyCoverBook.id))
  })

  it('loads the next already-sorted manage page when the list reaches the bottom', async () => {
    const laterBook = {
      ...secondManagedBook,
      id: publishedBook.sourceBookId,
      primaryTitle: 'A later listed book',
    }
    const firstLibraryPage = Array.from({ length: 50 }, (_, index) => ({
      ...fixtureAt(managedBooks, index % managedBooks.length),
      id: `book-${index}`,
      primaryTitle: `Book ${index.toString().padStart(2, '0')}`,
    }))
    const nextPageResult: PaginatedResult<ManagedBookListItemDto> = {
      skip: 50,
      take: 50,
      total: 51,
      data: [
        {
          book: laterBook,
          listing: {
            id: publishedBook.id,
            sourceBookId: laterBook.id,
            snapshotAt: publishedBook.snapshotAt,
          },
        },
      ],
    }
    let resolveNextPage!: (result: typeof nextPageResult) => void
    const nextPage = new Promise<typeof nextPageResult>((resolve) => {
      resolveNextPage = resolve
    })
    vi.mocked(api.getManagedBooks).mockImplementation(({ skip = 0 }) =>
      skip === 0
        ? Promise.resolve({
            skip: 0,
            take: 50,
            total: 51,
            data: firstLibraryPage.map((book) => ({ book, listing: null })),
          })
        : nextPage,
    )
    renderWithProviders(<ManagePage />)

    await userEvent.click(screen.getByRole('tab', { name: 'Books' }))
    const list = await screen.findByLabelText('Books')
    Object.defineProperties(list, {
      scrollHeight: { configurable: true, value: 1000 },
      scrollTop: { configurable: true, value: 850 },
      clientHeight: { configurable: true, value: 100 },
    })
    fireEvent.scroll(list)
    fireEvent.scroll(list)
    fireEvent.scroll(list)

    await waitFor(() =>
      expect(api.getManagedBooks).toHaveBeenCalledWith({
        skip: 50,
        take: 50,
        query: undefined,
      }),
    )
    expect(api.getManagedBooks).toHaveBeenCalledTimes(2)
    resolveNextPage(nextPageResult)
    expect(await screen.findByText('A later listed book')).toBeInTheDocument()
  })

  it('does not render a book twice when adjacent pages overlap', async () => {
    const repeated = fixtureAt(managedBookRows, 0)
    vi.mocked(api.getManagedBooks).mockImplementation(({ skip = 0 }) =>
      Promise.resolve(
        skip === 0
          ? { skip: 0, take: 1, total: 2, data: [repeated] }
          : { skip: 1, take: 1, total: 2, data: [repeated] },
      ),
    )
    renderWithProviders(<ManagePage />)

    await userEvent.click(screen.getByRole('tab', { name: 'Books' }))
    const list = await screen.findByLabelText('Books')
    Object.defineProperties(list, {
      scrollHeight: { configurable: true, value: 1000 },
      scrollTop: { configurable: true, value: 850 },
      clientHeight: { configurable: true, value: 100 },
    })
    fireEvent.scroll(list)

    await waitFor(() =>
      expect(api.getManagedBooks).toHaveBeenCalledWith({
        skip: 1,
        take: 50,
        query: undefined,
      }),
    )
    expect(screen.getAllByText(repeated.book.primaryTitle)).toHaveLength(1)
  })
})
