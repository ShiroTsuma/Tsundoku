import { expect, test } from '@playwright/test'
import { installLayoutApiMocks, layoutBooks, seedAuthenticatedSession } from './fixtures/api.js'
import {
  expectNoHorizontalOverflow,
  expectMinTouchTarget,
  expectInViewport,
} from './helpers/layout.js'

const bookId = layoutBooks[0]!.id
const files = [
  'Volume 1',
  'Volume 2',
  'A deliberately long volume title that must wrap without pushing tablet actions outside the viewport',
].map((title, i) => ({
  id: `file-${i}`,
  bookId,
  title,
  originalFileName: `volume-${i}.epub`,
  sortOrder: i,
  sizeBytes: 1048576,
  createdAt: '2026-10-13T10:00:00Z',
  deletedAtUtc: null,
  isShared: false,
  firstContentLabel: i === 0 ? 'V2C1' : '101',
  lastContentLabel: i === 0 ? 'V2C80' : '200',
}))
const job = {
  id: 'job-1',
  bookId,
  kind: 'Export',
  status: 'Ready',
  processedFiles: 2,
  totalFiles: 2,
  entries: [],
  warnings: [],
  expiresAtUtc: '2099-01-01T00:00:00Z',
  importedCount: 0,
  skippedCount: 0,
  error: null,
}

test.beforeEach(async ({ page }) => {
  await seedAuthenticatedSession(page)
  await installLayoutApiMocks(page)
  await page.route('**/api/v1/book/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === `/api/v1/book/${bookId}/files`)
      return route.fulfill({
        json: {
          files,
          snapshotId: 'public-1',
          usedStorageBytes: 3145728,
          maxStorageBytes: 10737418240,
          maxFileBytes: 104857600,
          maxUploadBytes: 314572800,
        },
      })
    if (path === '/api/v1/book/files/export/candidates')
      return route.fulfill({
        json: [{ bookId, bookTitle: layoutBooks[0]!.primaryTitle, contentType: 'Novel', files }],
      })
    if (
      path === '/api/v1/book/files/export/sessions' ||
      path === '/api/v1/book/files/sessions/job-1'
    )
      return route.fulfill({ json: job })
    if (path === '/api/v1/book/files/downloads')
      return route.fulfill({
        json: [
          {
            fileId: 'file-0',
            title: 'Volume 1',
            url: '/api/v1/book/files/download/ticket?token=test',
          },
        ],
      })
    if (path === '/api/v1/book/files/sessions/job-1/download')
      return route.fulfill({
        json: {
          fileId: 'job-1',
          title: 'epubs.zip',
          url: '/api/v1/book/files/download/ticket?token=test',
        },
      })
    if (path === '/api/v1/book/files/download/ticket')
      return route.fulfill({
        body: 'EPUB test bytes',
        contentType: 'application/epub+zip',
        headers: { 'Content-Disposition': 'attachment; filename="volume.epub"' },
      })
    return route.fallback()
  })
})

test('book file selection, separate download and ZIP stay usable on desktop and tablet', async ({
  page,
}, info) => {
  await page.goto(`/books/${bookId}`)
  const panel = page.getByRole('region', { name: 'EPUB files' })
  await panel.scrollIntoViewIfNeeded()
  await expect(panel.getByText('3 files · 3.0 MiB', { exact: true })).toBeVisible()
  await expect(page.getByLabel('Select Volume 1', { exact: true })).toHaveCount(0)
  await expectNoHorizontalOverflow(page)
  await expectInViewport(panel.getByRole('button', { name: 'Manage' }))
  await page.screenshot({ path: info.outputPath('epub-summary.png') })
  await panel.getByRole('button', { name: 'Manage' }).click()
  await page
    .getByRole('dialog', { name: 'Manage EPUBs', exact: true })
    .getByRole('button', { name: 'Done', exact: true })
    .click()
  const browser = page.getByRole('dialog', { name: 'EPUBs', exact: true })
  await expect(browser.getByText('V2C1 → V2C80', { exact: true })).toBeVisible()
  await expect(browser.getByRole('button', { name: 'Rename Volume 1' })).toHaveCount(0)
  await expectMinTouchTarget(
    browser.getByRole('button', { name: 'Download Volume 1', exact: true }),
    36,
  )
  const individualDownload = page.waitForEvent('download')
  await browser.getByRole('button', { name: 'Download Volume 1', exact: true }).click()
  expect((await individualDownload).suggestedFilename()).toBe('volume.epub')
  await browser.getByRole('button', { name: 'Download', exact: true }).click()
  let dialog = page.getByRole('dialog', { name: 'Download EPUBs', exact: true })
  await dialog.getByLabel('Select Volume 2', { exact: true }).uncheck()
  await dialog.getByLabel(`Select ${files[2]!.title}`, { exact: true }).uncheck()
  await expectMinTouchTarget(
    dialog.locator('label').filter({ has: page.getByLabel('Select Volume 1', { exact: true }) }),
    44,
  )
  await dialog.getByLabel('Separate EPUBs').check()
  await dialog.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(dialog.getByText('Volume 2', { exact: true })).toHaveCount(0)
  await expectInViewport(dialog)
  const downloaded = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Download', exact: true }).click()
  expect((await downloaded).suggestedFilename()).toBe('volume.epub')
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(browser).toBeVisible()
  await browser.getByRole('button', { name: 'Download', exact: true }).click()
  dialog = page.getByRole('dialog', { name: 'Download EPUBs', exact: true })
  await dialog.getByLabel('Select Volume 2', { exact: true }).uncheck()
  await dialog.getByLabel(`Select ${files[2]!.title}`, { exact: true }).uncheck()
  const create = page.waitForRequest((request) =>
    request.url().endsWith('/book/files/export/sessions'),
  )
  await dialog.getByRole('button', { name: 'Create ZIP' }).click()
  const createBody = (await create).postDataJSON() as { fileIds: string[] }
  expect(createBody.fileIds).toEqual(['file-0'])
  await expect(dialog.getByRole('button', { name: 'Download ZIP', exact: true })).toBeVisible()
  await expectNoHorizontalOverflow(page)
  await page.screenshot({ path: info.outputPath('epub-zip-dialog.png') })
})

test('EPUB upload previews selected titles and order before committing', async ({ page }, info) => {
  const preview = {
    ...job,
    kind: 'BookImport',
    entries: files.slice(0, 2).map((file, i) => ({
      ...file,
      id: `entry-${i}`,
      bookTitle: layoutBooks[0]!.primaryTitle,
      contentType: 'Novel',
      error: null,
      isDuplicate: false,
    })),
  }
  await page.route(`**/api/v1/book/${bookId}/files/import/sessions`, (route) =>
    route.fulfill({ json: preview }),
  )
  await page.route('**/api/v1/book/files/sessions/job-1', (route) =>
    route.fulfill({ json: preview }),
  )
  await page.route('**/api/v1/book/files/sessions/job-1/confirm', (route) =>
    route.fulfill({ json: { ...preview, status: 'Completed', importedCount: 1 } }),
  )
  await page.goto(`/books/${bookId}`)
  await page
    .getByRole('region', { name: 'EPUB files' })
    .getByRole('button', { name: 'Upload EPUB / ZIP', exact: true })
    .click()
  const dialog = page.getByRole('dialog', { name: 'Add EPUB / ZIP', exact: true })
  await dialog.getByLabel('Choose EPUB or ZIP files').setInputFiles({
    name: 'volumes.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from('fixture'),
  })
  await expect(dialog.getByRole('button', { name: 'Import selected (2)' })).toBeEnabled()
  await dialog.getByLabel('Import volume-1.epub', { exact: true }).uncheck()
  await dialog.getByLabel('Title', { exact: true }).first().fill('My first volume')
  await dialog.getByLabel('Order', { exact: true }).first().fill('7')
  await expectInViewport(dialog.getByRole('button', { name: 'Import selected (1)' }))
  await expectNoHorizontalOverflow(page)
  await page.screenshot({ path: info.outputPath('epub-import-preview.png') })
  const confirmation = page.waitForRequest((request) => request.url().endsWith('/job-1/confirm'))
  await dialog.getByRole('button', { name: 'Import selected (1)' }).click()
  expect((await confirmation).postDataJSON()).toEqual([
    { entryId: 'entry-0', bookId, title: 'My first volume', sortOrder: 7 },
  ])
  await expect(dialog.getByText('Import complete', { exact: true })).toBeVisible()
})

test('library EPUB export offers file selection and an independent manifest archive', async ({
  page,
}, info) => {
  await page.goto('/books?query=Fantasy')
  await page.getByRole('button', { name: 'Import / Export', exact: true }).click()
  await page.getByRole('menuitem', { name: /^EPUB files \(ZIP\)/ }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByLabel('Current filters (all matching pages)')).toBeChecked()
  await dialog.getByRole('button', { name: 'Choose files' }).click()
  await dialog.getByLabel('Export file Volume 2').uncheck()
  await expect(dialog.getByRole('button', { name: 'Export selected (2)' })).toBeEnabled()
  await expectInViewport(dialog.getByRole('button', { name: 'Export selected (2)' }))
  await expectNoHorizontalOverflow(page)
  await page.screenshot({ path: info.outputPath('epub-library-export.png') })
  const request = page.waitForRequest((request) =>
    request.url().endsWith('/book/files/export/sessions'),
  )
  await dialog.getByRole('button', { name: 'Export selected (2)' }).click()
  expect((await request).postDataJSON()).toEqual({
    fileIds: ['file-0', 'file-2'],
    includeManifest: true,
  })
})
