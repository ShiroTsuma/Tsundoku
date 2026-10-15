import type { Page } from '@playwright/test'

export const layoutBooks = [
  {
    id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    created: '2026-01-01T10:00:00Z',
    lastModified: '2026-02-01T10:00:00Z',
    primaryTitle: 'Lord of Mysteries',
    description: 'A long fantasy mystery.',
    alternativeTitles: ['LOTM'],
    alternativeTitlesCount: 1,
    authorOtherNames: [],
    authorId: 'author-1',
    author: 'Cuttlefish',
    contentType: 'Novel',
    status: 'Reading',
    currentChapterNumber: 348,
    currentChapterLabel: '348',
    totalChapters: 1432,
    rating: 9,
    priority: 1,
    notes: 'Private note',
    progressHistory: [
      {
        id: 'history-2',
        changedAt: '2026-07-18T18:37:00Z',
        chapterNumber: 348,
        chapterLabel: '348',
        comment: 'Arc 3 done',
      },
      {
        id: 'history-1',
        changedAt: '2026-05-02T09:10:00Z',
        chapterNumber: 120,
        chapterLabel: '120',
        comment: 'Initial progress',
      },
    ],
    genres: ['Fantasy'],
    genresCount: 1,
    genreDescriptions: { Fantasy: 'Magic, strange worlds, and supernatural stories.' },
    tags: ['favorite', 'mystery'],
    tagsCount: 2,
    tagDescriptions: { favorite: 'Worth rereading', mystery: null },
    links: [],
  },
  {
    id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    created: '2026-01-02T10:00:00Z',
    lastModified: '2026-02-02T10:00:00Z',
    primaryTitle:
      'A Very Long Book Title That Should Stay Inside Its Card Container Without Pushing Actions Away',
    alternativeTitles: [],
    alternativeTitlesCount: 0,
    authorOtherNames: [],
    author: 'Toika',
    contentType: 'Novel',
    status: 'Completed',
    currentChapterNumber: 120,
    totalChapters: 120,
    rating: 5,
    priority: 2,
    progressHistory: [],
    genres: ['Slice of Life'],
    tags: ['completed'],
    links: [],
  },
]

const dictionaries = {
  type: [
    { id: '10000000-0000-0000-0000-000000000001', name: 'Novel' },
    { id: '10000000-0000-0000-0000-000000000002', name: 'Manga' },
  ],
  status: [
    { id: '20000000-0000-0000-0000-000000000001', name: 'Reading' },
    { id: '20000000-0000-0000-0000-000000000002', name: 'Completed' },
  ],
  genre: [
    { id: '30000000-0000-0000-0000-000000000001', name: 'Fantasy' },
    { id: '30000000-0000-0000-0000-000000000002', name: 'Slice of Life' },
  ],
}

const managedTags = [
  {
    id: '40000000-0000-0000-0000-000000000001',
    name: 'favorite',
    description: 'Worth rereading',
    color: null,
    isGlobal: false,
  },
  {
    id: '40000000-0000-0000-0000-000000000002',
    name: 'mystery',
    description: null,
    color: null,
    isGlobal: true,
  },
]

const managedAuthors = [
  {
    id: '50000000-0000-0000-0000-000000000001',
    primaryName: 'Cuttlefish',
    otherNames: ['Cuttlefish That Loves Diving'],
    isPublic: true,
    isOwned: false,
  },
  {
    id: '50000000-0000-0000-0000-000000000002',
    primaryName: 'Toika',
    otherNames: [],
    isPublic: false,
    isOwned: true,
  },
]

const statusError = 'Status is required and must exist. Allowed values: Reading, Completed.'
const duplicateError = 'A book with this title and content type already exists in your library.'

export const invalidImportSession = {
  sessionId: 'layout-session',
  fileName: 'library-2026-10.csv',
  totalRows: 80,
  validRows: 77,
  invalidRows: 3,
  canFinalize: false,
  availableContentTypes: ['Novel', 'Manga'],
  availableStatuses: ['Reading', 'Completed'],
  rows: Array.from({ length: 80 }, (_unused, index) => {
    const misspelt = index < 2
    const duplicate = index === 2
    const errors = misspelt ? [statusError] : duplicate ? [duplicateError] : []
    return {
      rowId: `layout-row-${index + 1}`,
      lineNumber: index + 2,
      isValid: errors.length === 0,
      primaryTitle: duplicate ? 'Lord of Mysteries' : `Imported title ${index + 1}`,
      authorName: 'Some Author',
      contentType: 'Novel',
      status: misspelt ? 'Readin' : 'Reading',
      genres: 'Fantasy; Comedy',
      tags: null,
      totalChapters: null,
      currentChapterNumber: String(100 + index),
      currentChapterLabel: null,
      rating: null,
      priority: null,
      description: null,
      notes: null,
      rawImportedLine: null,
      errors,
      fieldErrors: misspelt
        ? { status: [statusError] }
        : duplicate
          ? { primaryTitle: [duplicateError] }
          : {},
    }
  }),
}

const extraSnapshots = [
  ['Shadow Slave', 'Guiltythree', 'Novel', 2400, ['Action', 'Fantasy'], ['Dark', 'Survival'], 3],
  ['Omniscient Reader', 'Sing Shong', 'Novel', 551, ['Fantasy'], ['Apocalypse', 'Meta', 'Webnovel Reader'], 0],
  ['Solo Leveling', 'Chugong', 'Manhwa', 200, ['Action'], ['Dungeons', 'System'], 0],
  ['The Beginning After the End', 'TurtleMe', 'Novel', null, ['Fantasy', 'Adventure'], ['Reincarnation'], 2],
  ['Frieren', 'Kanehito Yamada', 'Manga', 140, ['Fantasy', 'Slice of Life'], ['Elves', 'Journey'], 0],
  ['A Title Long Enough To Need Two Lines In The Card Without Breaking The Layout', null, 'Novel', 12, [], [], 0],
].map(([title, author, type, chapters, genres, tags, files], index) => ({
  id: `snapshot-extra-${String(index)}`,
  sourceBookId: `source-${String(index)}`,
  primaryTitle: title,
  description: index % 2 ? 'A shared book with a short description.' : null,
  alternativeTitles: [],
  author,
  authorOtherNames: [],
  contentType: type,
  totalChapters: chapters,
  genres: (genres as string[]).map((name) => ({ name, description: null })),
  tags: (tags as string[]).map((name) => ({ name, description: null })),
  coverUrl: null,
  snapshotAt: '2026-09-0' + String(index + 1) + 'T12:00:00Z',
  isOwner: index === 2,
  filesCount: files,
}))

export const analytics = {
  generatedAt: '2026-07-15T12:00:00Z',
  scope: {
    query: null,
    from: '2026-01-01',
    to: '2026-02-01',
    bucket: 'week',
  },
  overview: {
    totalBooks: 10,
    ratedBooks: 8,
    unratedBooks: 2,
    averageRating: 8.4,
    currentChapters: 468,
    booksWithKnownCurrentChapter: 9,
    booksWithoutKnownCurrentChapter: 1,
  },
  composition: {
    statusByType: [
      {
        type: 'Novel',
        totalBooks: 6,
        statuses: [
          { status: 'Reading', bookCount: 4 },
          { status: 'Completed', bookCount: 2 },
        ],
      },
    ],
    genres: [{ name: 'Fantasy', bookCount: 6, shareOfBooks: 60 }],
    tags: [{ name: 'favorite', bookCount: 4, shareOfBooks: 40 }],
  },
  ratings: {
    ratedBooks: 8,
    unratedBooks: 2,
    averageRating: 8.4,
    counts: Array.from({ length: 10 }, (_unused, index) => ({
      rating: index + 1,
      bookCount: index === 8 ? 1 : 0,
    })),
  },
  planning: {
    prioritiesByStatus: [
      {
        status: 'Reading',
        totalBooks: 6,
        priorities: [
          { priority: '1', bookCount: 2 },
          { priority: 'Unset', bookCount: 4 },
        ],
      },
    ],
  },
  progress: {
    typeVolumes: [
      {
        type: 'Novel',
        bookCount: 6,
        currentChapters: 468,
        averageCurrentChapter: 78,
        medianCurrentChapter: 64,
      },
    ],
  },
  activity: {
    baselineChapters: 0,
    points: [
      {
        date: '2026-01-05',
        progressEvents: 3,
        booksTouched: 2,
        chaptersAdvanced: 18,
      },
    ],
  },
  libraryGrowth: {
    openingCount: 0,
    points: [
      { date: '2026-01-01', booksAdded: 0, cumulativeBooks: 4, byType: [] },
      {
        date: '2026-01-08',
        booksAdded: 6,
        cumulativeBooks: 10,
        byType: [{ type: 'Novel', bookCount: 6 }],
      },
    ],
  },
  quality: {
    fieldCompleteness: [
      { field: 'author', bookCount: 9, shareOfBooks: 90 },
      { field: 'genre', bookCount: 6, shareOfBooks: 60 },
      { field: 'usableCover', bookCount: 4, shareOfBooks: 40 },
    ],
    linkSources: [{ source: 'NovelUpdates', linkCount: 8, bookCount: 6, shareOfBooks: 60 }],
    coverStatuses: [
      { status: 'Found', bookCount: 4, shareOfBooks: 40 },
      { status: 'Pending', bookCount: 2, shareOfBooks: 20 },
    ],
    coverSources: [{ source: 'NovelUpdates', bookCount: 4, shareOfBooks: 40 }],
  },
}

export async function seedAuthenticatedSession(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.removeItem('novelki.session')
  })
}

export async function installLayoutApiMocks(page: Page) {
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname.replace('/api/v1/', '')

    if (path === 'book/files/limits') {
      await route.fulfill({
        json: {
          maxFileBytes: 104857600,
          maxUploadBytes: 314572800,
          maxFilesPerImport: 100,
          maxLibraryArchiveBytes: 12884901888,
          retentionDays: 30,
        },
      })
      return
    }
    if (
      path === 'book/files/sessions' ||
      path === 'book/files/export/candidates' ||
      /^public-book\/[^/]+\/files$/.test(path)
    ) {
      await route.fulfill({ json: [] })
      return
    }
    if (/^book\/[^/]+\/files$/.test(path)) {
      await route.fulfill({
        json: {
          files: [
            {
              id: 'file-1',
              bookId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
              title: 'Volume 1',
              originalFileName: 'volume-1.epub',
              sortOrder: 0,
              sizeBytes: 1258291,
              createdAt: '2026-01-10T10:00:00Z',
              deletedAtUtc: null,
              isShared: true,
              firstContentLabel: 'Chapter 1',
              lastContentLabel: 'Chapter 120',
            },
            {
              id: 'file-2',
              bookId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
              title: 'Volume 2',
              originalFileName: 'volume-2.epub',
              sortOrder: 1,
              sizeBytes: 1468006,
              createdAt: new Date().toISOString(),
              deletedAtUtc: null,
              isShared: false,
              firstContentLabel: 'Chapter 121',
              lastContentLabel: 'Chapter 240',
            },
          ],
          snapshotId: null,
          usedStorageBytes: 2040109466,
          maxStorageBytes: 10737418240,
          maxFileBytes: 104857600,
          maxUploadBytes: 314572800,
        },
      })
      return
    }

    if (path === 'account/refresh') {
      await route.fulfill({
        json: {
          accessToken: 'header.eyJyb2xlIjoiVXNlciJ9.signature',
          tokenType: 'Bearer',
          expiresAt: '2099-01-01T00:00:00Z',
          refreshTokenExpiresAt: '2099-02-01T00:00:00Z',
          userId: '11111111-1111-1111-1111-111111111111',
          createdAt: '2026-01-01T00:00:00Z',
        },
      })
      return
    }

    if (path === 'book/import/sessions') {
      await route.fulfill({ json: invalidImportSession })
      return
    }

    if (path === 'book/import/sessions/layout-session/finalize') {
      await route.fulfill({
        json: {
          importedCount: 77,
          skippedCount: 1,
          errors: ["Line 4: title 'Lord of Mysteries' already exists for content type 'Novel'."],
          importedBooks: invalidImportSession.rows.slice(3, 12).map((row) => ({
            primaryTitle: row.primaryTitle,
            contentType: 'Novel',
            status: 'Reading',
            currentChapterNumber: Number(row.currentChapterNumber),
            currentChapterLabel: null,
            totalChapters: null,
          })),
        },
      })
      return
    }

    if (path === 'book/analytics') {
      await route.fulfill({ json: analytics })
      return
    }

    if (path === 'book/parse-html') {
      await route.fulfill({
        json: {
          source: 'NovelUpdates',
          primaryTitle: 'A Layout-Test Novel With a Deliberately Long Resolved Title',
          authorName: 'Resolved Author',
          contentType: { id: dictionaries.type[0]!.id, name: dictionaries.type[0]!.name },
          alternativeTitles: ['Alternative One', 'Alternative Two'],
          genres: [
            { id: dictionaries.genre[0]!.id, name: dictionaries.genre[0]!.name },
            { id: null, name: 'Unmapped Genre With a Long Name' },
          ],
          tags: ['Chinese', 'Slow Romance', 'Long Form Adventure'],
          description:
            'A resolved description long enough to exercise the clamped preview without expanding the dialog beyond the viewport.',
          canonicalUrl: 'https://www.novelupdates.com/series/layout-test-novel/',
          coverUrl: 'https://cdn.example.com/layout-test-cover.jpg',
          warnings: [
            "Genre 'Unmapped Genre With a Long Name' is not present in the library and will be skipped.",
          ],
        },
      })
      return
    }

    if (path === 'book/summary') {
      await route.fulfill({
        json: {
          totalBooks: 142,
          ratedBooks: 19,
          unratedBooks: 123,
          averageRating: 7.6,
          currentChapters: 36388,
          booksWithKnownCurrentChapter: 140,
          booksWithoutKnownCurrentChapter: 2,
          statusCounts: [
            { status: 'Reading', count: 123 },
            { status: 'Completed', count: 13 },
            { status: 'Plan To Read', count: 3 },
            { status: 'On Hold', count: 1 },
            { status: 'Unknown', count: 2 },
          ],
          typeCounts: [
            { type: 'Novel', bookCount: 131, currentChapters: 34000 },
            { type: 'Manga', bookCount: 11, currentChapters: 2388 },
          ],
          genreCounts: [],
          ratingCounts: [],
        },
      })
      return
    }

    if (path === 'book') {
      await route.fulfill({
        json: { skip: 0, take: 20, total: layoutBooks.length, data: layoutBooks },
      })
      return
    }

    if (path === 'tag') {
      await route.fulfill({ json: managedTags })
      return
    }

    if (path === 'author') {
      await route.fulfill({ json: managedAuthors })
      return
    }

    if (path === 'public-book') {
      await route.fulfill({
        json: {
          skip: 0,
          take: 40,
          total: 7,
          data: [
            ...extraSnapshots,
            {
              id: 'snapshot-layout',
              sourceBookId: layoutBooks[0]!.id,
              primaryTitle: 'Lord of Mysteries',
              description: 'A shared mystery with enough metadata to exercise the card tooltips.',
              alternativeTitles: ['LOTM'],
              author: 'Cuttlefish',
              authorOtherNames: [],
              contentType: 'Novel',
              totalChapters: 1432,
              genres: [
                {
                  name: 'Fantasy',
                  description: 'Magic, strange worlds, and supernatural stories.',
                },
              ],
              tags: [
                {
                  name: 'Mystery',
                  description: 'Secrets and investigations that may extend beyond the card.',
                },
              ],
              coverUrl: null,
              snapshotAt: '2026-07-18T12:00:00Z',
              isOwner: false,
            },
          ],
        },
      })
      return
    }

    if (path === 'book/manage') {
      const data = layoutBooks.map((book, index) => ({
        book,
        listing:
          index === 0
            ? { id: 'listing-layout', snapshotAt: '2026-07-18T12:00:00Z' }
            : null,
      }))
      await route.fulfill({ json: { skip: 0, take: 50, total: data.length, data } })
      return
    }

    if (path.startsWith('book/')) {
      await route.fulfill({ json: layoutBooks[0] })
      return
    }

    if (path in dictionaries) {
      const data = dictionaries[path as keyof typeof dictionaries]
      await route.fulfill({
        json: {
          skip: 0,
          take: 100,
          total: data.length,
          data,
        },
      })
      return
    }

    await route.fulfill({ status: 204 })
  })
}
