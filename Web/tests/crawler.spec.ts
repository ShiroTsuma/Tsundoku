import { expect, test } from '@playwright/test'
import { installLayoutApiMocks, layoutBooks, seedAuthenticatedSession } from './fixtures/api.js'

const bookId = layoutBooks[0]!.id
const source = {
  id: 'source-1',
  sourceName: 'Example source',
  url: 'https://example.com/novel/test',
  chapterCount: 2000,
  latestChapterLabel: 'V4C500',
  updatedAt: null,
  language: 'en',
}

test('admin can control source search and Always include while processing is paused', async ({
  page,
}) => {
  await seedAuthenticatedSession(page)
  await installLayoutApiMocks(page)
  await page.route('**/api/v1/account/refresh', (route) =>
    route.fulfill({
      json: {
        accessToken: 'header.eyJyb2xlIjoiQWRtaW4ifQ.signature',
        tokenType: 'Bearer',
        expiresAt: '2099-01-01T00:00:00Z',
      },
    }),
  )
  let processingEnabled = false
  await page.route('**/api/v1/admin/crawler/processing', async (route) => {
    if (route.request().method() === 'PUT')
      processingEnabled = (route.request().postDataJSON() as { processingEnabled: boolean })
        .processingEnabled
    await route.fulfill({ json: { processingEnabled } })
  })
  let enabled = true
  let alwaysInclude = false
  await page.route('**/api/v1/admin/crawler/sources**', async (route) => {
    if (route.request().method() === 'PUT') {
      const body = route.request().postDataJSON() as { enabled: boolean; alwaysInclude: boolean }
      enabled = body.enabled
      alwaysInclude = body.alwaysInclude
      await route.fulfill({ status: 204 })
      return
    }
    await route.fulfill({
      json: {
        processingEnabled: false,
        sources: [
          {
            domain: 'dobytranslations.com',
            url: 'https://dobytranslations.com',
            language: 'en',
            canSearch: true,
            enabled,
            alwaysInclude,
            sampleCount: 10,
            successCount: 8,
            timeoutCount: 1,
            warningCount: 1,
            rateLimitedCount: 0,
            successRate: 0.8,
            timeoutRate: 0.1,
            warningRate: 0.1,
            lastObservedAt: null,
            autoSkipped: false,
            nextProbeAt: 0,
          },
        ],
      },
    })
  })
  await page.route('**/api/v1/admin/crawler?**', (route) =>
    route.fulfill({
      json: {
        enabled: true,
        processingEnabled: false,
        checkedBooks: 27,
        totalBooks: 249,
        pendingBooks: 222,
        runningJobs: 0,
        waitingJobs: 27,
        trackedSources: 52,
        totalJobs: 0,
        skip: 0,
        take: 20,
        jobs: [],
      },
    }),
  )
  await page.goto('/admin?tab=crawler')
  await expect(page.getByText('Processing paused', { exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Crawler sources' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Start processing' }).click()
  await expect(page.getByRole('button', { name: 'Pause processing' })).toBeVisible()
  await page.getByRole('button', { name: 'Pause processing' }).click()
  await expect(page.getByRole('button', { name: 'Start processing' })).toBeVisible()
  await page.getByRole('button', { name: 'Sources', exact: true }).click()
  const panel = page.getByRole('region', { name: 'Crawler sources' })
  await expect(panel.getByText('dobytranslations.com')).toBeVisible()
  await panel.getByRole('button', { name: 'Always include' }).click()
  await expect(panel.getByRole('button', { name: 'Always include' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await panel.getByRole('button', { name: 'Disable search' }).click()
  await expect(panel.getByText('Disabled', { exact: true })).toBeVisible()
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0, { timeout: 15000 })
  await expect(page.locator('html')).toHaveJSProperty(
    'scrollWidth',
    await page.locator('html').evaluate((node) => node.clientWidth),
  )
  await page.screenshot({
    path: `test-results/crawler-sources-${test.info().project.name}.png`,
    fullPage: true,
  })
})

test('global crawler activity stays available in Library and shows retry progress', async ({
  page,
}) => {
  await seedAuthenticatedSession(page)
  await installLayoutApiMocks(page)
  await page.route('**/api/v1/book/crawler-status', (route) =>
    route.fulfill({
      json: {
        enabled: true,
        checkedBooks: 12,
        totalBooks: 142,
        pendingBooks: 130,
        runningJobs: 0,
        waitingJobs: 1,
        trackedSources: 78,
        totalJobs: 1,
        skip: 0,
        take: 10,
        observedAtUtc: new Date().toISOString(),
        jobs: [
          {
            id: 'job',
            bookId,
            bookTitle: 'Blood Servant',
            kind: 'discovery',
            status: 'queued',
            retryAttempt: 1,
            nextRetryAt: new Date(Date.now() + 540000).toISOString(),
            searchedSourceCount: 28,
            totalSourceCount: 35,
            checkedLinkCount: 3,
            totalLinkCount: 3,
            chaptersDone: 0,
            chaptersTotal: 0,
            readyFiles: 0,
            totalFiles: 0,
            warnings: [],
            error: null,
          },
        ],
      },
    }),
  )
  await page.goto('/books')
  await page.getByRole('button', { name: 'Crawler activity: 12/142 books checked' }).click()
  await expect(page.getByRole('menuitem', { name: /12\/142 books checked/ })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: /Blood Servant/ })).toContainText(
    'Retry 1/5 in 9 min',
  )
  await expect(page.getByRole('menu')).toBeInViewport({ ratio: 1 })
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBeTruthy()
  await page.screenshot({ path: `test-results/crawler-activity-${test.info().project.name}.png` })
  await page.getByRole('menuitem', { name: /Blood Servant/ }).click()
  await expect(page).toHaveURL(new RegExp(`/books/${bookId}$`))
})

test('search shows saved-link progress before the first match', async ({ page }) => {
  await seedAuthenticatedSession(page)
  await installLayoutApiMocks(page)
  let reads = 0
  await page.route('**/api/v1/book/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/epub-searches') || path.endsWith('/epub-searches/search-progress')) {
      if (route.request().method() === 'GET') reads += 1
      return route.fulfill({
        json: {
          id: 'search-progress',
          status: reads >= 2 ? 'completed' : 'crawling',
          error: null,
          result: {
            candidates:
              reads >= 2
                ? [{ id: 'novel-1', title: 'Blood Servant', match: 'similar', sources: [source] }]
                : [],
            searchedSourceCount: reads,
            totalSourceCount: 100,
            checkedLinkCount: 0,
            totalLinkCount: 1,
            currentSource: 'Checking saved link: dobytranslations.com',
            durationMs: reads * 2000,
            warnings: [],
          },
        },
      })
    }
    return route.fallback()
  })
  await page.goto(`/books/${bookId}`)
  await page
    .getByRole('region', { name: 'EPUB files' })
    .getByRole('button', { name: 'Find & download' })
    .click()
  const dialog = page.getByRole('dialog', { name: 'Find EPUB' })
  await dialog.getByRole('button', { name: 'Search', exact: true }).click()
  await expect(dialog.getByText(/saved links 0\/1/)).toBeVisible()
  await expect(dialog.getByText(/Checking saved link: dobytranslations.com/)).toBeVisible()
  await expect(dialog.getByText('No matches. Try one of the alternative titles.')).toHaveCount(0)
  await expect(dialog.getByRole('radio', { name: /Example source/ })).toBeVisible({
    timeout: 10000,
  })
})

test('crawler download preserves the existing options and attaches EPUBs', async ({ page }) => {
  await seedAuthenticatedSession(page)
  await installLayoutApiMocks(page)
  let finished = false
  let job: Record<string, unknown> | null = null
  await page.route('**/api/v1/book/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/epub-searches'))
      return route.fulfill({
        json: {
          id: 'search-1',
          status: 'completed',
          error: null,
          result: {
            candidates: [
              {
                id: 'novel-1',
                title: layoutBooks[0]!.primaryTitle,
                match: 'title',
                sources: [source],
              },
            ],
            searchedSourceCount: 3,
            durationMs: 100,
            warnings: [],
          },
        },
      })
    if (path === `/api/v1/book/${bookId}/epub-downloads`) {
      if (route.request().method() === 'GET')
        return route.fulfill({ json: job && !finished ? [job] : [] })
      const body = route.request().postDataJSON() as {
        regenerateAffectedVolumes: boolean
        splitEvery: number
        requestKey: string
      }
      expect(body.regenerateAffectedVolumes).toBe(false)
      expect(body.splitEvery).toBe(100)
      expect(body.requestKey).toBeTruthy()
      job = {
        id: 'download-1',
        bookId,
        sourceName: source.sourceName,
        status: 'building',
        chaptersDone: 10,
        chaptersTotal: 10,
        startedAt: '2026-10-16T12:00:00Z',
        error: null,
        files: [
          {
            title: 'Volume 1',
            firstChapter: 1,
            lastChapter: 10,
            chaptersDone: 10,
            status: 'building',
          },
        ],
      }
      return route.fulfill({ json: job })
    }
    if (path === '/api/v1/book/epub-downloads/download-1') {
      finished = true
      return route.fulfill({
        json: {
          ...job,
          status: 'completed',
          files: [
            {
              title: 'Volume 1',
              firstChapter: 1,
              lastChapter: 10,
              chaptersDone: 10,
              status: 'added',
              importSessionId: 'import-1',
            },
          ],
        },
      })
    }
    return route.fallback()
  })
  await page.goto(`/books/${bookId}`)
  await page
    .getByRole('region', { name: 'EPUB files' })
    .getByRole('button', { name: 'Find & download' })
    .click()
  const dialog = page.getByRole('dialog', { name: 'Find EPUB' })
  await dialog.getByRole('button', { name: 'Search', exact: true }).click()
  await dialog.getByRole('radio', { name: /Example source/ }).click()
  await expect(dialog.getByText('Update date unknown')).toBeVisible()
  await dialog.getByRole('button', { name: 'Use this source' }).click()
  await dialog.getByRole('radio', { name: /Custom range/ }).click()
  await dialog.getByLabel('From', { exact: true }).fill('1')
  await dialog.getByLabel('to', { exact: true }).fill('10')
  await dialog.getByRole('button', { name: 'Start download' }).click()
  await expect(dialog.getByText('All files added to the book')).toBeVisible()
  await dialog.getByRole('button', { name: 'Done', exact: true }).click()
  await expect(
    page
      .getByRole('region', { name: 'EPUB files' })
      .getByRole('button', { name: 'Upload EPUB / ZIP' }),
  ).toBeVisible()
})

test('a running crawler job can be restored after reload and cancelled', async ({ page }) => {
  await seedAuthenticatedSession(page)
  await installLayoutApiMocks(page)
  let cancelled = false
  const job = {
    id: 'download-1',
    bookId,
    sourceName: 'Example source',
    chaptersDone: 1,
    chaptersTotal: 10,
    startedAt: '2026-10-16T12:00:00Z',
    error: null,
    files: [
      { title: 'Volume 1', firstChapter: 1, lastChapter: 10, chaptersDone: 1, status: 'crawling' },
    ],
  }
  await page.route('**/api/v1/book/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    const current = { ...job, status: cancelled ? 'cancelled' : 'crawling' }
    if (path === `/api/v1/book/${bookId}/epub-downloads`) return route.fulfill({ json: [current] })
    if (path === '/api/v1/book/epub-downloads/download-1/cancel') {
      cancelled = true
      return route.fulfill({ json: { ...job, status: 'cancelled' } })
    }
    if (path === '/api/v1/book/epub-downloads/download-1') return route.fulfill({ json: current })
    return route.fallback()
  })
  await page.goto(`/books/${bookId}`)
  await expect(page.getByText('Downloading from Example source')).toBeVisible()
  await page.reload()
  await expect(page.getByText('Downloading from Example source')).toBeVisible()
  await page
    .getByRole('region', { name: 'EPUB files' })
    .getByRole('button', { name: 'Details', exact: true })
    .click()
  const dialog = page.getByRole('dialog', { name: 'Find EPUB' })
  await dialog.getByRole('button', { name: 'Cancel download', exact: true }).click()
  await expect(dialog.getByText('Download cancelled', { exact: true })).toBeVisible()
})
