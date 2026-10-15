import { expect, test, type Page } from '@playwright/test'
import { installLayoutApiMocks, layoutBooks, seedAuthenticatedSession } from './fixtures/api.js'
import {
  expectFitsViewportWidth,
  expectInViewport,
  expectMinTouchTarget,
  expectNoHorizontalOverflow,
  requiredBox,
} from './helpers/layout.js'

test.beforeEach(async ({ page }) => {
  await seedAuthenticatedSession(page)
  await installLayoutApiMocks(page)
  await page.emulateMedia({ reducedMotion: 'reduce' })
})

async function expectLibraryResults(page: Page) {
  if (page.viewportSize()!.width < 640) {
    await expect(page.getByRole('list', { name: 'Books (compact)' })).toBeVisible()
    await expect(page.getByRole('table')).toBeHidden()
  } else {
    await expect(page.getByRole('table')).toBeVisible()
    await expectFitsViewportWidth(page.locator('.book-table-scroll'))
  }
}

test('app shell exposes responsive navigation, account menu and NSFW state', async ({ page }) => {
  await page.goto('/books')
  await expect(page.locator('header')).toBeVisible()
  await expect(page.getByRole('main')).toHaveCount(1)
  await expect(page.getByRole('heading', { name: 'Library', exact: true })).toBeVisible()
  const mobile = page.viewportSize()!.width < 768
  const nav = page.getByRole('navigation', {
    name: mobile ? 'Primary navigation (mobile)' : 'Primary navigation',
    exact: true,
  })
  await expectInViewport(nav)
  await expect(nav.getByRole('link', { name: 'Library' })).toHaveAttribute('aria-current', 'page')
  if (mobile) await expectMinTouchTarget(nav.getByRole('link', { name: 'Library' }))
  await expect(page.getByRole('link', { name: /skip to content/i })).toHaveAttribute(
    'href',
    '#main-content',
  )
  await page.getByRole('button', { name: 'Account menu' }).click()
  await expect(page.getByRole('menuitem', { name: /log out/i })).toBeVisible()
  await page.keyboard.press('Escape')
  const toggle = page.getByRole('button', { name: 'Enable NSFW content' })
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  await toggle.click()
  await expect(page.getByRole('button', { name: 'Disable NSFW content' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(page.getByRole('button', { name: 'Disable NSFW content' })).toBeVisible()
  await expectNoHorizontalOverflow(page)
})

test('graphite and paper design uses current typography and control shapes', async ({ page }) => {
  await page.goto('/books')
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(18, 19, 19)')
  await expect(page.getByRole('heading', { name: 'Library', exact: true })).toHaveCSS(
    'font-family',
    /Source Serif 4/,
  )
  await expect(page.getByRole('link', { name: 'Add book', exact: true })).toHaveCSS(
    'border-radius',
    '8px',
  )
  await expectLibraryResults(page)
})

test('library list contains scrolling within its surface and columns popup fits', async ({
  page,
}) => {
  await page.goto('/books')
  await expectLibraryResults(page)
  if (page.viewportSize()!.width >= 640) {
    const scroll = page.locator('.book-table-scroll')
    await scroll.evaluate((element) => {
      element.scrollLeft = element.scrollWidth
    })
    await expectFitsViewportWidth(scroll)
    await expectFitsViewportWidth(page.getByTestId(`book-table-actions-cell-${layoutBooks[0]!.id}`))
    await page.getByRole('button', { name: /columns/i }).click()
    await expectInViewport(page.getByTestId('column-settings-popup'))
  }
  await expectNoHorizontalOverflow(page)
})

test('card sizes keep long titles and finished markers inside responsive tracks', async ({
  page,
}) => {
  await page.goto('/books')
  await page.getByRole('button', { name: 'Cards', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Cards', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(page.getByRole('button', { name: 'Table', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  )
  const cards = page.locator('.book-card')
  await expect(cards).toHaveCount(layoutBooks.length)
  for (const card of await cards.all()) {
    await expectFitsViewportWidth(card)
    const title = card.getByRole('heading')
    const titleBox = await requiredBox(title)
    const cardBox = await requiredBox(card)
    expect(titleBox.x + titleBox.width).toBeLessThanOrEqual(cardBox.x + cardBox.width + 1)
  }
  await expect(
    page.locator('.book-card--completed').getByText('FINISHED', { exact: true }),
  ).toBeVisible()
  await expect(page.getByLabel('Rating 5 out of 10')).toHaveCSS('color', 'rgb(235, 165, 157)')
  await expectNoHorizontalOverflow(page)
})

test('search suggestions support keyboard navigation and stay within the viewport', async ({
  page,
}) => {
  await page.goto('/books')
  const search = page.getByRole('combobox', { name: 'Search books' })
  await search.click()
  const listbox = page.getByRole('listbox')
  await expectInViewport(listbox)
  await search.fill('rating:')
  await expect(listbox.getByRole('option', { name: /^rating:>=N/i })).toBeVisible()
  await search.press('ArrowDown')
  await expect(search).toHaveAttribute('aria-activedescendant', /book-search-suggestions-/)
  await search.press('Escape')
  await expect(listbox).toBeHidden()
  await expectNoHorizontalOverflow(page)
})

test('progress dialog stays inside the viewport and prevents invalid chapter submissions', async ({
  page,
}) => {
  await page.goto(`/books/${layoutBooks[0]!.id}`)
  await page.getByRole('button', { name: /log progress/i }).click()
  const dialog = page.getByRole('dialog', { name: 'Log progress' })
  await expectInViewport(dialog)
  const input = dialog.getByPlaceholder('Chapter number')
  await input.fill('1e9')
  await expect(input).toHaveAttribute('aria-invalid', 'true')
  await expect(
    dialog.getByText('Chapter number must be a non-negative number without exponent notation.'),
  ).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Save progress' })).toBeDisabled()
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(dialog).toBeHidden()
})

test('book form and HTML parsing preview fit the viewport', async ({ page }) => {
  await page.goto('/books/new')
  await expect(page.getByRole('heading', { name: 'Add book', exact: true })).toBeVisible()
  await expectFitsViewportWidth(page.getByLabel('Primary title', { exact: true }))
  await expectNoHorizontalOverflow(page)
  await page.getByRole('button', { name: 'Parse HTML', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Parse page HTML' })
  await expectInViewport(dialog)
  await dialog.getByLabel('Full page HTML').fill('<html>layout fixture</html>')
  await dialog.getByRole('button', { name: 'Parse HTML', exact: true }).click()
  await expect(dialog.getByText('NovelUpdates', { exact: true })).toBeVisible()
  await expect(dialog.getByText(/Unmapped Genre With a Long Name/)).toBeVisible()
  await expectFitsViewportWidth(dialog)
  const box = await requiredBox(dialog)
  expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height + 1)
  await expectNoHorizontalOverflow(page)
})

test('manage editor and author tab fit the viewport', async ({ page }) => {
  await page.goto('/manage')
  await page.getByText('favorite', { exact: true }).dblclick()
  const dialog = page.getByRole('dialog')
  await expectInViewport(dialog)
  await expect(dialog.getByLabel('Description')).toBeVisible()
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('tab', { name: 'Authors' }).click()
  await expect(page.getByText('Cuttlefish', { exact: true })).toBeVisible()
  await expectNoHorizontalOverflow(page)
})

const screens = [
  ['library', '/books', 'Library'],
  ['book-form', '/books/new', 'Add book'],
  ['book-details', `/books/${layoutBooks[0]!.id}`, layoutBooks[0]!.primaryTitle],
  ['stats', '/analytics', 'Stats'],
  ['manage', '/manage', 'Manage'],
  ['discover', '/discover', 'Discover'],
] as const

for (const [name, route, heading] of screens) {
  test(`${name} fits the viewport and matches the redesigned baseline`, async ({ page }) => {
    await page.goto(route)
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible()
    await expect(page.getByText(/Loading/).first()).toBeHidden()
    if (name === 'library') await expectLibraryResults(page)
    await page.evaluate(async () => {
      await document.fonts.ready
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    })
    await expectFitsViewportWidth(page.getByRole('main'))
    await expectNoHorizontalOverflow(page)
    await expect(page).toHaveScreenshot(`tsundoku-${name}.png`, { animations: 'disabled' })
  })
}

test('cards and progress dialog match the redesigned baselines', async ({ page }) => {
  await page.goto('/books')
  await page.getByRole('button', { name: 'Cards', exact: true }).click()
  await expect(page.locator('.book-card').first()).toBeVisible()
  await expect(page).toHaveScreenshot('tsundoku-cards.png', { animations: 'disabled' })
  await page.goto(`/books/${layoutBooks[0]!.id}`)
  await page.getByRole('button', { name: /log progress/i }).click()
  await expect(page.getByRole('dialog', { name: 'Log progress' })).toBeVisible()
  await expect(page).toHaveScreenshot('tsundoku-progress.png', { animations: 'disabled' })
})

test('CSV validation rows remain editable within the import dialog', async ({ page }) => {
  await page.goto('/books')
  await page.getByRole('button', { name: 'Import / Export', exact: true }).click()
  await page.getByRole('menuitem', { name: /CSV Import book data/ }).click()
  await page.getByTestId('import-file-input').setInputFiles({
    name: 'invalid-books.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('primaryTitle,contentType,status\nBroken,Novel,Readin\n'),
  })
  const dialog = page.getByRole('dialog', { name: 'Import books' })
  await expect(dialog.getByTestId('import-rows')).toBeVisible()
  const row = dialog.getByTestId('import-row-layout-row-1')
  await row.getByRole('button', { name: 'Fix', exact: true }).click()
  await expect(row.getByLabel('Status', { exact: true })).toBeVisible()
  await expectFitsViewportWidth(row)
  await expectInViewport(dialog)
  const box = await requiredBox(dialog)
  expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height + 1)
  await expectNoHorizontalOverflow(page)
})
