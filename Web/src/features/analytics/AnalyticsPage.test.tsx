import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { addDays, format, subMonths } from 'date-fns'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/api/client'
import { setStoredSession } from '@/api/http'
import type { BookAnalyticsDto } from '@/api/types'
import { expectReadableTextContrast } from '@/test/contrast'
import { testSession } from '@/test/fixtures'
import { renderWithProviders } from '@/test/render'
import { AnalyticsChartCard } from './AnalyticsChartCard'
import { AnalyticsPage } from './AnalyticsPage'
import { libraryGrowthChartPoints } from './charts/libraryGrowthData'
import { readingActivityChartPoints } from './charts/readingActivityData'
import {
  distributeStackedPercents,
  statusByTypeRows,
  statusByTypeTooltipRows,
} from './charts/statusByTypeData'

vi.mock('@/api/client', () => ({
  api: {
    getBookAnalytics: vi.fn(),
    getBookSearchSuggestions: vi.fn(),
    getReadingTimeSettings: vi.fn(),
    updateReadingTimeSettings: vi.fn(),
  },
}))

describe('AnalyticsPage', () => {
  beforeEach(() => {
    vi.mocked(api.getBookAnalytics).mockReset()
    vi.mocked(api.getBookSearchSuggestions).mockReset().mockResolvedValue([])
    vi.mocked(api.getReadingTimeSettings).mockReset()
    vi.mocked(api.updateReadingTimeSettings).mockReset()
    vi.mocked(api.getReadingTimeSettings).mockResolvedValue([])
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('fetches analytics from restored URL filters', async () => {
    vi.mocked(api.getBookAnalytics).mockResolvedValue(createAnalytics())

    renderWithProviders(<AnalyticsPage />, {
      route:
        '/analytics?query=author%3AToika%20rating%3A%3E%3D8&from=2026-01-01&to=2026-02-01&bucket=month',
    })

    expect(await screen.findByText('Status by type')).toBeInTheDocument()
    expect(api.getBookAnalytics).toHaveBeenCalledWith({
      query: 'author:Toika rating:>=8',
      from: '2026-01-01',
      to: '2026-02-01',
      bucket: 'month',
    })
    expect(screen.getByDisplayValue('author:Toika rating:>=8')).toBeInTheDocument()
    expect(screen.queryByText(/query uses the same filters/i)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /date range: jan 1, 2026/i })).toHaveAttribute(
      'title',
      'Jan 1, 2026 – Jan 31, 2026',
    )
  })

  it('renders chart fetch errors with theme-aware dark colors', () => {
    render(
      <AnalyticsChartCard
        columns={[]}
        description="Broken chart"
        isError
        rows={[]}
        title="Broken analytics"
        onRetry={() => undefined}
      >
        <div>Chart</div>
      </AnalyticsChartCard>,
    )

    const alert = screen.getByRole('alert')
    expect(alert).toHaveClass('bg-danger-soft', 'text-danger-ink')
    expect(alert).toHaveTextContent('Could not load this chart.')
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })

  it('extracts date filters from query into analytics range request', async () => {
    vi.mocked(api.getBookAnalytics).mockResolvedValue(createAnalytics())

    renderWithProviders(<AnalyticsPage />, {
      route: '/analytics?query=author%3AToika%20updated%3A%3D2026-07',
    })

    expect(await screen.findByText('Status by type')).toBeInTheDocument()
    expect(api.getBookAnalytics).toHaveBeenCalledWith(
      expect.objectContaining({
        query: 'author:Toika',
        from: '2026-07-01',
        to: '2026-08-01',
      }),
    )
    expect(screen.getByDisplayValue('author:Toika')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /date range: jul 1, 2026/i })).toHaveAttribute(
      'title',
      'Jul 1, 2026 – Jul 31, 2026',
    )
  })

  it('defaults analytics to the last three months through today', async () => {
    const today = getTodayForTest()
    const from = subMonths(today, 3)
    const toExclusive = addDays(today, 1)
    vi.mocked(api.getBookAnalytics).mockResolvedValue(createAnalytics())

    renderWithProviders(<AnalyticsPage />, { route: '/analytics' })

    expect(await screen.findByText('Status by type')).toBeInTheDocument()
    expect(api.getBookAnalytics).toHaveBeenCalledWith(
      expect.objectContaining({
        from: toDateInputValueForTest(from),
        to: toDateInputValueForTest(toExclusive),
      }),
    )
    expect(screen.getByRole('button', { name: /date range: last 3 months/i })).toHaveAttribute(
      'title',
      `${format(from, 'MMM d, yyyy')} – ${format(today, 'MMM d, yyyy')}`,
    )
    expect(screen.getByText('Today')).toBeInTheDocument()
  })

  it('defaults analytics to beginning when the account is newer than three months', async () => {
    const today = getTodayForTest()
    const accountStart = subMonths(today, 1)
    const toExclusive = addDays(today, 1)
    vi.mocked(api.getBookAnalytics).mockResolvedValue(createAnalytics())
    setStoredSession({ ...testSession, createdAt: accountStart.toISOString() })

    renderWithProviders(<AnalyticsPage />, { route: '/analytics' })

    expect(await screen.findByText('Status by type')).toBeInTheDocument()
    expect(api.getBookAnalytics).toHaveBeenCalledWith(
      expect.objectContaining({
        from: toDateInputValueForTest(accountStart),
        to: toDateInputValueForTest(toExclusive),
      }),
    )
    expect(screen.getByRole('button', { name: /date range: beginning/i })).toHaveAttribute(
      'title',
      `${format(accountStart, 'MMM d, yyyy')} – ${format(today, 'MMM d, yyyy')}`,
    )
  })

  it('opens themed preset choices above the calendar and applies a preset range', async () => {
    const today = getTodayForTest()
    const from = subMonths(today, 1)
    const toExclusive = addDays(today, 1)
    vi.mocked(api.getBookAnalytics).mockResolvedValue(createAnalytics())
    const user = userEvent.setup()

    renderWithProviders(<AnalyticsPage />, { route: '/analytics?from=2026-01-01&to=2026-02-01' })

    await screen.findByText('Status by type')
    await user.click(screen.getByRole('button', { name: /date range/i }))

    const lastMonth = screen.getByRole('button', { name: 'Last month' })
    expect(screen.getByRole('button', { name: 'Beginning' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Last 2 years' })).toBeInTheDocument()
    expect(
      lastMonth.compareDocumentPosition(firstOf(screen.getAllByRole('grid'))) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Last 3 months' })).toHaveClass('ui-filter-chip')

    await user.click(lastMonth)
    await user.click(screen.getByRole('button', { name: /apply filters/i }))

    await waitFor(() =>
      expect(api.getBookAnalytics).toHaveBeenLastCalledWith(
        expect.objectContaining({
          from: toDateInputValueForTest(from),
          to: toDateInputValueForTest(toExclusive),
        }),
      ),
    )
  })

  it('applies beginning and custom calendar ranges with an inclusive end date', async () => {
    vi.mocked(api.getBookAnalytics).mockResolvedValue(createAnalytics())
    setStoredSession({ ...testSession, createdAt: '2025-12-15T10:30:00Z' })
    const user = userEvent.setup()
    const today = getTodayForTest()
    const start = subMonths(today, 1)
    const end = addDays(start, 13)

    renderWithProviders(<AnalyticsPage />, { route: '/analytics?from=2026-01-01&to=2026-02-01' })

    await screen.findByText('Status by type')
    await user.click(screen.getByRole('button', { name: /date range/i }))
    const startDay = screen.getByRole('button', { name: dayButtonMatcher(start) })
    await user.click(startDay)

    const pendingButton = screen.getByRole('button', {
      name: new RegExp(`date range: ${format(start, 'MMM d, yyyy')}`, 'i'),
    })
    expect(pendingButton).toHaveAttribute('title', format(start, 'MMM d, yyyy'))
    expect(pendingButton).not.toHaveTextContent('Today')
    expect(startDay).toHaveClass('analytics-calendar-day-button')
    expect(getDayCell(startDay)).toHaveClass(
      'analytics-calendar-day--range-start',
      'rounded-l-full',
    )
    expect(getDayCell(startDay)).not.toHaveClass('rounded-r-full')

    const endDay = screen.getByRole('button', { name: dayButtonMatcher(end) })
    await user.click(endDay)
    await user.click(screen.getByRole('button', { name: /date range/i }))
    const appliedEndCell = getDayCell(screen.getByRole('button', { name: dayButtonMatcher(end) }))
    expect(appliedEndCell).toHaveClass('analytics-calendar-day--range-end', 'rounded-r-full')
    expect(appliedEndCell).not.toHaveClass('rounded-l-full')
    expect(
      getDayCell(screen.getByRole('button', { name: dayButtonMatcher(addDays(start, 1)) })),
    ).toHaveClass('analytics-calendar-day--range-middle')
    await user.click(screen.getByRole('button', { name: /date range/i }))
    await user.click(screen.getByRole('button', { name: /apply filters/i }))

    await waitFor(() =>
      expect(api.getBookAnalytics).toHaveBeenLastCalledWith(
        expect.objectContaining({
          from: toDateInputValueForTest(start),
          to: toDateInputValueForTest(addDays(end, 1)),
        }),
      ),
    )

    await user.click(screen.getByRole('button', { name: /date range/i }))
    await user.click(screen.getByRole('button', { name: 'Beginning' }))
    await user.click(screen.getByRole('button', { name: /apply filters/i }))

    await waitFor(() =>
      expect(api.getBookAnalytics).toHaveBeenLastCalledWith(
        expect.objectContaining({
          from: '2025-12-15',
        }),
      ),
    )
  })

  it('clears previous range highlight when starting a new custom calendar range', async () => {
    vi.mocked(api.getBookAnalytics).mockResolvedValue(createAnalytics())
    setStoredSession({ ...testSession, createdAt: '2025-12-15T10:30:00Z' })
    const user = userEvent.setup()
    const today = getTodayForTest()
    const previousStart = addDays(subMonths(today, 1), 2)
    const previousMiddle = addDays(previousStart, 4)
    const previousEnd = addDays(previousStart, 8)
    const nextStart = addDays(previousStart, 14)

    renderWithProviders(<AnalyticsPage />, {
      route: `/analytics?from=${toDateInputValueForTest(previousStart)}&to=${toDateInputValueForTest(addDays(previousEnd, 1))}`,
    })

    await screen.findByText('Status by type')
    await user.click(screen.getByRole('button', { name: /date range/i }))

    expect(
      getDayCell(screen.getByRole('button', { name: dayButtonMatcher(previousStart) })),
    ).toHaveClass('rounded-l-full')
    expect(
      getDayCell(screen.getByRole('button', { name: dayButtonMatcher(previousEnd) })),
    ).toHaveClass('rounded-r-full')

    await user.click(screen.getByRole('button', { name: dayButtonMatcher(nextStart) }))

    const nextStartCell = getDayCell(
      screen.getByRole('button', { name: dayButtonMatcher(nextStart) }),
    )
    expect(nextStartCell).toHaveClass('rounded-l-full')
    expect(nextStartCell).not.toHaveClass('rounded-r-full')

    const previousStartCell = getDayCell(
      screen.getByRole('button', { name: dayButtonMatcher(previousStart) }),
    )
    const previousMiddleCell = getDayCell(
      screen.getByRole('button', { name: dayButtonMatcher(previousMiddle) }),
    )
    const previousEndCell = getDayCell(
      screen.getByRole('button', { name: dayButtonMatcher(previousEnd) }),
    )
    expect(previousStartCell).not.toHaveClass('rounded-l-full')
    expect(previousStartCell).not.toHaveClass('range_start')
    expectNoClassContaining(previousStartCell, 'cyan')
    expectNoClassContaining(previousMiddleCell, 'cyan')
    expectNoClassContaining(previousEndCell, 'cyan')
  })

  it('disables calendar days before the account creation date', async () => {
    vi.mocked(api.getBookAnalytics).mockResolvedValue(createAnalytics())
    const today = getTodayForTest()
    const accountStart = addDays(today, -2)
    setStoredSession({ ...testSession, createdAt: accountStart.toISOString() })
    const user = userEvent.setup()

    renderWithProviders(<AnalyticsPage />, {
      route: `/analytics?from=${toDateInputValueForTest(accountStart)}&to=${toDateInputValueForTest(addDays(today, 1))}`,
    })

    await screen.findByText('Status by type')
    await user.click(screen.getByRole('button', { name: /date range/i }))

    expect(
      screen.getByRole('button', { name: dayButtonMatcher(addDays(accountStart, -1)) }),
    ).toBeDisabled()
    expect(screen.getByRole('button', { name: dayButtonMatcher(addDays(today, 1)) })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Last 2 years' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Last 1 year' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Last 6 months' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Beginning' }))
    await user.click(screen.getByRole('button', { name: /apply filters/i }))

    await waitFor(() =>
      expect(api.getBookAnalytics).toHaveBeenLastCalledWith(
        expect.objectContaining({
          from: toDateInputValueForTest(accountStart),
        }),
      ),
    )
  })

  it('closes the date range picker when clicking outside', async () => {
    vi.mocked(api.getBookAnalytics).mockResolvedValue(createAnalytics())
    const user = userEvent.setup()

    renderWithProviders(<AnalyticsPage />, { route: '/analytics?from=2026-01-01&to=2026-02-01' })

    await screen.findByText('Status by type')
    await user.click(screen.getByRole('button', { name: /date range/i }))
    expect(screen.getByRole('button', { name: 'Beginning' })).toBeInTheDocument()

    await user.click(screen.getByLabelText(/query/i))

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Beginning' })).not.toBeInTheDocument(),
    )
    expect(screen.getByRole('button', { name: /date range/i })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
  })

  it('starts a fresh custom range after a preset before updating the end date', async () => {
    vi.mocked(api.getBookAnalytics).mockResolvedValue(createAnalytics())
    setStoredSession({ ...testSession, createdAt: '2025-12-15T10:30:00Z' })
    const user = userEvent.setup()
    const today = getTodayForTest()
    const start = subMonths(today, 1)
    const end = addDays(start, 11)

    renderWithProviders(<AnalyticsPage />, { route: '/analytics?from=2026-01-01&to=2026-02-01' })

    await screen.findByText('Status by type')
    await user.click(screen.getByRole('button', { name: /date range/i }))
    await user.click(screen.getByRole('button', { name: 'Last 6 months' }))

    expect(screen.getByRole('button', { name: /date range: last 6 months/i })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /date range/i }))
    await user.click(screen.getByRole('button', { name: dayButtonMatcher(start) }))
    const pendingButton = screen.getByRole('button', {
      name: new RegExp(`date range: ${format(start, 'MMM d, yyyy')}`, 'i'),
    })
    expect(pendingButton).toHaveAttribute('title', format(start, 'MMM d, yyyy'))
    expect(pendingButton).not.toHaveTextContent('Today')

    await user.click(screen.getByRole('button', { name: dayButtonMatcher(end) }))
    await user.click(screen.getByRole('button', { name: /apply filters/i }))

    await waitFor(() =>
      expect(api.getBookAnalytics).toHaveBeenLastCalledWith(
        expect.objectContaining({
          from: toDateInputValueForTest(start),
          to: toDateInputValueForTest(addDays(end, 1)),
        }),
      ),
    )
  })

  it('updates URL-backed filters and creates a new request', async () => {
    vi.mocked(api.getBookAnalytics).mockResolvedValue(createAnalytics())
    const user = userEvent.setup()

    renderWithProviders(<AnalyticsPage />, {
      route: '/analytics?from=2026-01-01&to=2026-02-01&bucket=week',
    })

    await screen.findByText('10')
    await user.type(screen.getByLabelText(/query/i), 'status:"Plan to Read"')
    const bucket = screen.getByRole('group', { name: 'Bucket' })
    expect(within(bucket).getByRole('button', { name: 'Week' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await user.click(within(bucket).getByRole('button', { name: 'Day' }))
    await user.click(screen.getByRole('button', { name: /apply filters/i }))

    await waitFor(() =>
      expect(api.getBookAnalytics).toHaveBeenLastCalledWith({
        query: 'status:"Plan to Read"',
        from: '2026-01-01',
        to: '2026-02-01',
        bucket: 'day',
      }),
    )
  })

  it('shows different empty states for empty library and no matches', async () => {
    vi.mocked(api.getBookAnalytics).mockResolvedValueOnce(createAnalytics({ totalBooks: 0 }))

    const { unmount } = renderWithProviders(<AnalyticsPage />, {
      route: '/analytics?from=2026-01-01&to=2026-02-01',
    })

    expect(await screen.findByText(/your library is empty/i)).toBeInTheDocument()
    unmount()

    vi.mocked(api.getBookAnalytics).mockResolvedValueOnce(createAnalytics({ totalBooks: 0 }))
    renderWithProviders(<AnalyticsPage />, {
      route: '/analytics?query=missing&from=2026-01-01&to=2026-02-01',
    })

    expect(
      await screen.findByText(/no books match the current analytics filters/i),
    ).toBeInTheDocument()
  })

  it('preserves previous data during refetch', async () => {
    let resolveSecondRequest: (value: BookAnalyticsDto) => void = () => undefined
    vi.mocked(api.getBookAnalytics)
      .mockResolvedValueOnce(createAnalytics({ totalBooks: 10 }))
      .mockImplementationOnce(
        () =>
          new Promise<BookAnalyticsDto>((resolve) => {
            resolveSecondRequest = resolve
          }),
      )
    const user = userEvent.setup()

    renderWithProviders(<AnalyticsPage />, {
      route: '/analytics?from=2026-01-01&to=2026-02-01&bucket=week',
    })

    expect(await screen.findByText('10')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Month' }))
    await user.click(screen.getByRole('button', { name: /apply filters/i }))

    expect(screen.getByText('10')).toBeInTheDocument()
    expect(screen.getByText(/refreshing/i)).toBeInTheDocument()

    resolveSecondRequest(createAnalytics({ totalBooks: 12 }))
    expect(await screen.findByText('12')).toBeInTheDocument()
  })

  it('formats large overview numbers with thousand separators', async () => {
    vi.mocked(api.getBookAnalytics).mockResolvedValue(
      createAnalytics({
        totalBooks: 1_000_000,
        ratedBooks: 9_999,
        unratedBooks: 990_001,
        currentChapters: 1_234_567.5,
      }),
    )

    renderWithProviders(<AnalyticsPage />, { route: '/analytics?from=2026-01-01&to=2026-02-01' })

    expect(await screen.findByText('1,000,000')).toBeInTheDocument()
    expect(screen.getByText('9,999')).toBeInTheDocument()
    expect(screen.getByText('990,001')).toBeInTheDocument()
    expect(screen.getByText('1,234,567.5')).toBeInTheDocument()
  })

  it('places priority analytics in the right column and cover/link cleanup under priority', async () => {
    vi.mocked(api.getBookAnalytics).mockResolvedValue(createAnalytics())

    renderWithProviders(<AnalyticsPage />, { route: '/analytics?from=2026-01-01&to=2026-02-01' })

    await screen.findByText('Rating distribution')

    const leftColumn = screen.getByTestId('analytics-left-column')
    const rightColumn = screen.getByTestId('analytics-right-column')
    const left = within(leftColumn)
    const right = within(rightColumn)

    const priority = left.getByText('Priority by status')
    const linkSources = left.getByText('Link sources')
    const coverAvailability = left.getByText('Cover availability')

    expect(left.queryByText('Rating distribution')).not.toBeInTheDocument()
    expect(left.queryByText('Chapter volume by type')).not.toBeInTheDocument()
    expect(left.queryByText('Estimated reading time')).not.toBeInTheDocument()
    expect(
      priority.compareDocumentPosition(linkSources) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(
      linkSources.compareDocumentPosition(coverAvailability) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()

    const rating = right.getByText('Rating distribution')
    const chapterVolume = right.getByText('Chapter volume by type')
    const readingTime = right.getByText('Estimated reading time')
    const readingActivity = right.getByText('Reading activity')

    expect(right.queryByText('Link sources')).not.toBeInTheDocument()
    expect(right.queryByText('Cover availability')).not.toBeInTheDocument()
    expect(
      rating.compareDocumentPosition(chapterVolume) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(
      chapterVolume.compareDocumentPosition(readingTime) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(
      readingTime.compareDocumentPosition(readingActivity) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('shows useful card data tables without forcing horizontal page overflow', async () => {
    vi.mocked(api.getBookAnalytics).mockResolvedValue(createAnalytics())
    const user = userEvent.setup()

    renderWithProviders(<AnalyticsPage />, { route: '/analytics?from=2026-01-01&to=2026-02-01' })

    await screen.findByText('Status by type')
    await user.click(screen.getByRole('button', { name: /view data for cover availability/i }))

    expect(screen.getByRole('columnheader', { name: 'Kind' })).toBeInTheDocument()
    expect(
      screen.getByRole('table', { name: /cover availability data table/i }).parentElement,
    ).toHaveClass('overflow-auto')
  })

  it('rounds status percentages before rendering status row values', () => {
    const rows = statusByTypeRows(
      createAnalytics({
        composition: {
          statusByType: [
            {
              type: 'Novel',
              totalBooks: 10,
              statuses: [{ status: 'Reading', bookCount: 10 }],
            },
          ],
        },
      }),
    )

    expect(rows).toContainEqual(['Novel', 'Reading', '10', '100%'])
    expect(rows.flat()).not.toContain('100.00000000000001%')
  })

  it('keeps tiny positive status by type segments large enough to click', () => {
    const displayPercents = distributeStackedPercents([499, 1], 500)

    expect(displayPercents[1]).toBeGreaterThanOrEqual(3)
    expect(Math.round(displayPercents.reduce((sum, value) => sum + value, 0))).toBe(100)

    const rows = statusByTypeRows(
      createAnalytics({
        composition: {
          statusByType: [
            {
              type: 'Manga',
              totalBooks: 500,
              statuses: [
                { status: 'Reading', bookCount: 499 },
                { status: 'On Hold', bookCount: 1 },
              ],
            },
          ],
        },
      }),
    )

    expect(rows).toContainEqual(['Manga', 'On Hold', '1', '0.2%'])
  })

  it('orders status by type hover rows by share and keeps their colors', () => {
    const rows = statusByTypeTooltipRows([
      {
        color: '#2563eb',
        name: 'Completed',
        payload: { CompletedCount: 2, CompletedPercent: 20 },
        value: 20,
      },
      {
        color: '#0891b2',
        name: 'Reading',
        payload: { ReadingCount: 7, ReadingPercent: 70 },
        value: 70,
      },
      {
        color: '#7c3aed',
        name: 'On Hold',
        payload: { 'On HoldCount': 1, 'On HoldPercent': 10 },
        value: 10,
      },
      {
        color: '#db2777',
        name: 'Dropped',
        payload: { DroppedCount: 0, DroppedPercent: 0 },
        value: 0,
      },
    ])

    expect(rows.map((row) => row.status)).toEqual(['Reading', 'Completed', 'On Hold'])
    expect(rows.map((row) => row.color)).toEqual(['#0891b2', '#2563eb', '#7c3aed'])
    expect(rows.map((row) => row.percent)).toEqual([70, 20, 10])
  })

  it('exposes text-equivalent data tables where raw data adds value', async () => {
    vi.mocked(api.getBookAnalytics).mockResolvedValue(createAnalytics())
    const user = userEvent.setup()

    renderWithProviders(<AnalyticsPage />, { route: '/analytics?from=2026-01-01&to=2026-02-01' })

    const buttons = await screen.findAllByRole('button', { name: /view data for/i })
    expect(buttons).toHaveLength(7)
    expect(
      screen.queryByRole('button', { name: /view data for status by type/i }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /view data for top tags/i }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /view data for metadata completeness/i }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /view data for rating distribution/i }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /view data for priority by status/i }),
    ).not.toBeInTheDocument()

    for (const button of buttons) {
      await user.click(button)
      expect(button).toHaveAttribute('aria-expanded', 'true')
    }

    expect(screen.getByText('Cover availability data table')).toBeInTheDocument()
    expect(screen.queryByText('Status by type data table')).not.toBeInTheDocument()
    expect(screen.queryByText('Top tags data table')).not.toBeInTheDocument()
    expect(screen.queryByText('Metadata completeness data table')).not.toBeInTheDocument()
  })

  it('toggles card data with keyboard and keeps screen-reader names specific', async () => {
    vi.mocked(api.getBookAnalytics).mockResolvedValue(createAnalytics())
    const user = userEvent.setup()

    renderWithProviders(<AnalyticsPage />, { route: '/analytics?from=2026-01-01&to=2026-02-01' })

    const button = await screen.findByRole('button', { name: /view data for reading activity/i })
    button.focus()
    await user.keyboard('{Enter}')

    expect(button).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Reading activity data table')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /hide data for reading activity/i }),
    ).toBeInTheDocument()
  })

  it('renders composition charts with Other buckets and drill-down links', async () => {
    vi.mocked(api.getBookAnalytics).mockResolvedValue(
      createAnalytics({
        composition: {
          genres: [
            { name: 'Fantasy', bookCount: 8, shareOfBooks: 80 },
            { name: 'Drama "Special" / 2026', bookCount: 7, shareOfBooks: 70 },
            { name: 'Slice of Life', bookCount: 6, shareOfBooks: 60 },
            { name: 'Mystery', bookCount: 4, shareOfBooks: 40 },
            { name: 'Action', bookCount: 3, shareOfBooks: 30 },
            { name: 'Drama', bookCount: 2, shareOfBooks: 20 },
            {
              name: 'Very Long Genre Name That Must Stay Readable',
              bookCount: 1,
              shareOfBooks: 10,
            },
          ],
          tags: [
            { name: 'favorite', bookCount: 5, shareOfBooks: 50 },
            { name: 'slow burn', bookCount: 3, shareOfBooks: 30 },
          ],
        },
      }),
    )
    const user = userEvent.setup()

    renderWithProviders(<AnalyticsPage />, { route: '/analytics?from=2026-01-01&to=2026-02-01' })

    expect(await screen.findByRole('link', { name: 'Fantasy' })).toHaveAttribute(
      'href',
      '/books?query=created%3A%3E%3D2026-01-01%20created%3A%3C2026-02-01%20genre%3AFantasy',
    )
    expect(await screen.findByRole('link', { name: 'Drama "Special" / 2026' })).toHaveAttribute(
      'href',
      '/books?query=created%3A%3E%3D2026-01-01%20created%3A%3C2026-02-01%20genre%3A%22Drama%20%5C%22Special%5C%22%20%2F%202026%22',
    )
    expect(await screen.findByRole('link', { name: 'slow burn' })).toHaveAttribute(
      'href',
      '/books?query=created%3A%3E%3D2026-01-01%20created%3A%3C2026-02-01%20tag%3A%22slow%20burn%22',
    )
    expect(await screen.findByText('Other')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Show 2 more' }))
    expect(
      screen.getByRole('link', { name: 'Very Long Genre Name That Must Stay Readable' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show top 5' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )

    await user.click(screen.getByRole('button', { name: /view data for top genres/i }))
    expect(screen.queryByRole('columnheader', { name: /bucket/i })).not.toBeInTheDocument()
  })

  it('renders empty composition card states without hiding other cards', async () => {
    vi.mocked(api.getBookAnalytics).mockResolvedValue(
      createAnalytics({
        composition: {
          statusByType: [
            {
              type: 'Novel',
              totalBooks: 1,
              statuses: [{ status: 'Reading', bookCount: 1 }],
            },
          ],
          genres: [],
          tags: [],
        },
      }),
    )

    renderWithProviders(<AnalyticsPage />, { route: '/analytics?from=2026-01-01&to=2026-02-01' })

    expect((await screen.findAllByText('Novel')).length).toBeGreaterThan(0)
    expect(screen.getByText('No genre data for this analytics scope.')).toBeInTheDocument()
    expect(screen.getByText('No tag data for this analytics scope.')).toBeInTheDocument()
  })

  it('renders rating distribution with a separate unrated drill-down', async () => {
    vi.mocked(api.getBookAnalytics).mockResolvedValue(
      createAnalytics({
        ratings: {
          ratedBooks: 1,
          unratedBooks: 9,
          averageRating: 10,
          counts: Array.from({ length: 10 }, (_unused, index) => ({
            rating: index + 1,
            bookCount: index === 9 ? 1 : 0,
          })),
        },
      }),
    )
    renderWithProviders(<AnalyticsPage />, {
      route: '/analytics?query=type%3AManga&from=2026-01-01&to=2026-02-01',
    })

    expect(await screen.findByText('10%')).toBeInTheDocument()
    expect(document.querySelector('.analytics-drilldown-chart')).toBeTruthy()
    expect(screen.getAllByText('Unrated: 9')).toHaveLength(1)
    expect(screen.getByRole('link', { name: /unrated: 9/i })).toHaveAttribute(
      'href',
      '/books?query=type%3AManga%20created%3A%3E%3D2026-01-01%20created%3A%3C2026-02-01%20rating%3Anone',
    )
    expect(screen.getByRole('link', { name: /open rating 10 books/i })).toHaveAttribute(
      'href',
      '/books?query=type%3AManga%20created%3A%3E%3D2026-01-01%20created%3A%3C2026-02-01%20rating%3A10',
    )
    expect(
      screen.queryByRole('button', { name: /view data for rating distribution/i }),
    ).not.toBeInTheDocument()
  })

  it('renders priority heatmap with unset drill-down', async () => {
    vi.mocked(api.getBookAnalytics).mockResolvedValue(
      createAnalytics({
        planning: {
          prioritiesByStatus: [
            {
              status: 'Plan to Read',
              totalBooks: 4,
              priorities: [
                { priority: '1', bookCount: 1 },
                { priority: 'Unset', bookCount: 3 },
              ],
            },
          ],
        },
      }),
    )

    renderWithProviders(<AnalyticsPage />, { route: '/analytics?from=2026-01-01&to=2026-02-01' })

    expect(await screen.findByTestId('priority-heatmap')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /view data for priority by status/i }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Plan to Read' })).toHaveAttribute(
      'href',
      '/books?query=created%3A%3E%3D2026-01-01%20created%3A%3C2026-02-01%20status%3A%22Plan%20to%20Read%22',
    )
    expect(screen.getByRole('columnheader', { name: 'Unset' })).toHaveClass(
      'analytics-priority-heading',
    )
    const unsetLink = screen.getByRole('link', { name: '3' })
    expect(unsetLink).toHaveAttribute(
      'href',
      '/books?query=created%3A%3E%3D2026-01-01%20created%3A%3C2026-02-01%20status%3A%22Plan%20to%20Read%22%20priority%3Anone',
    )
    expect(unsetLink).toHaveClass('analytics-heat-value')
    expect(screen.getByText('75%')).toHaveClass('text-current/85')
  })

  it('shows rating and priority empty states when all analytics rows are zero', async () => {
    vi.mocked(api.getBookAnalytics).mockResolvedValue(createAnalytics({ totalBooks: 0 }))

    renderWithProviders(<AnalyticsPage />, { route: '/analytics?from=2026-01-01&to=2026-02-01' })

    expect(await screen.findByText('No rating data for this analytics scope.')).toBeInTheDocument()
    expect(screen.getByText('No priority data for this analytics scope.')).toBeInTheDocument()
  })

  it('renders chapter volume with separate count and chapter sections', async () => {
    vi.mocked(api.getBookAnalytics).mockResolvedValue(
      createAnalytics({
        progress: {
          typeVolumes: [
            {
              type: 'Novel',
              bookCount: 2,
              currentChapters: 120.5,
              averageCurrentChapter: 60.25,
              medianCurrentChapter: 55,
            },
            {
              type: 'Manga',
              bookCount: 1,
              currentChapters: 0,
              averageCurrentChapter: null,
              medianCurrentChapter: null,
            },
          ],
        },
      }),
    )

    renderWithProviders(<AnalyticsPage />, { route: '/analytics?from=2026-01-01&to=2026-02-01' })

    expect(await screen.findByText('Book count by type')).toBeInTheDocument()
    expect(screen.getByText('Current chapters by type')).toBeInTheDocument()
    expect(document.querySelectorAll('.analytics-drilldown-chart').length).toBeGreaterThanOrEqual(2)
    expect(screen.queryByText(/Current chapters: 120.5/)).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /open manga books by count/i })).toHaveAttribute(
      'href',
      '/books?query=created%3A%3E%3D2026-01-01%20created%3A%3C2026-02-01%20type%3AManga',
    )
    expect(
      screen.getByRole('link', { name: /open manga books by current chapters/i }),
    ).toHaveAttribute(
      'href',
      '/books?query=created%3A%3E%3D2026-01-01%20created%3A%3C2026-02-01%20type%3AManga',
    )
  })

  it('exposes status by type drill-down links for chart segments', async () => {
    vi.mocked(api.getBookAnalytics).mockResolvedValue(
      createAnalytics({
        composition: {
          statusByType: [
            {
              type: 'Manga',
              totalBooks: 3,
              statuses: [
                { status: 'Reading', bookCount: 2 },
                { status: 'Completed', bookCount: 1 },
              ],
            },
          ],
        },
      }),
    )

    renderWithProviders(<AnalyticsPage />, { route: '/analytics?from=2026-01-01&to=2026-02-01' })

    expect(await screen.findByText('Manga')).toBeInTheDocument()
    expect(screen.getByTestId('status-by-type-chart')).toHaveClass('analytics-drilldown-chart')
    expect(screen.queryByRole('link', { name: 'Manga' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /open manga books$/i })).toHaveAttribute(
      'href',
      '/books?query=created%3A%3E%3D2026-01-01%20created%3A%3C2026-02-01%20type%3AManga',
    )
    expect(screen.getByRole('link', { name: /open manga reading books/i })).toHaveAttribute(
      'href',
      '/books?query=created%3A%3E%3D2026-01-01%20created%3A%3C2026-02-01%20type%3AManga%20status%3AReading',
    )
    expect(screen.getByRole('link', { name: /open manga completed books/i })).toHaveAttribute(
      'href',
      '/books?query=created%3A%3E%3D2026-01-01%20created%3A%3C2026-02-01%20type%3AManga%20status%3ACompleted',
    )
  })

  it('estimates reading time from account settings and saves only after editing is done', async () => {
    vi.mocked(api.getReadingTimeSettings).mockResolvedValue([
      { contentType: 'Novel', minutesPerChapter: 2 },
    ])
    vi.mocked(api.updateReadingTimeSettings).mockResolvedValue([
      { contentType: 'Novel', minutesPerChapter: 0 },
    ])
    vi.mocked(api.getBookAnalytics).mockResolvedValue(
      createAnalytics({
        progress: {
          typeVolumes: [
            {
              type: 'Novel',
              bookCount: 1,
              currentChapters: 468,
              averageCurrentChapter: 468,
              medianCurrentChapter: 468,
            },
          ],
        },
      }),
    )
    const user = userEvent.setup()

    renderWithProviders(<AnalyticsPage />, { route: '/analytics?from=2026-01-01&to=2026-02-01' })

    expect(await screen.findByText('15.6 h')).toBeInTheDocument()
    expect(screen.getByText(/0\.0 years based on known current chapters/i)).toBeInTheDocument()
    const requestCount = vi.mocked(api.getBookAnalytics).mock.calls.length
    expect(screen.getByText('2 minutes per chapter')).toBeInTheDocument()
    expect(
      screen.queryByRole('spinbutton', { name: /novel minutes per chapter/i }),
    ).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /edit estimates/i }))
    const input = screen.getByRole('spinbutton', { name: /novel minutes per chapter/i })

    await user.clear(input)
    await user.type(input, '0')

    expect(await screen.findByText('0.0 h')).toBeInTheDocument()
    expect(api.updateReadingTimeSettings).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: /done/i }))
    await waitFor(() =>
      expect(vi.mocked(api.updateReadingTimeSettings).mock.calls[0]?.[0]).toEqual({
        settings: [{ contentType: 'Novel', minutesPerChapter: 0 }],
      }),
    )
    expect(vi.mocked(api.getBookAnalytics).mock.calls.length).toBe(requestCount)
  })

  it('shows chapter volume and estimated time empty states when no chapter rows exist', async () => {
    vi.mocked(api.getBookAnalytics).mockResolvedValue(
      createAnalytics({
        progress: {
          typeVolumes: [],
        },
      }),
    )

    renderWithProviders(<AnalyticsPage />, { route: '/analytics?from=2026-01-01&to=2026-02-01' })

    expect(
      await screen.findByText('No chapter volume data for this analytics scope.'),
    ).toBeInTheDocument()
    expect(screen.getByText('No chapter data to estimate reading time.')).toBeInTheDocument()
  })

  it('renders reading activity and library growth trends for empty buckets, one point, and import jumps', async () => {
    vi.mocked(api.getBookAnalytics).mockResolvedValue(
      createAnalytics({
        activity: {
          baselineChapters: 0,
          points: [
            { date: '2026-01-01', progressEvents: 0, booksTouched: 0, chaptersAdvanced: 0 },
            { date: '2026-01-08', progressEvents: 0, booksTouched: 0, chaptersAdvanced: 0 },
            {
              date: '2026-01-15',
              progressEvents: 1,
              booksTouched: 1,
              chaptersAdvanced: 9_999,
            },
          ],
        },
        libraryGrowth: {
          openingCount: 1,
          points: [
            { date: '2026-01-01', booksAdded: 0, cumulativeBooks: 1, byType: [] },
            { date: '2026-01-08', booksAdded: 0, cumulativeBooks: 1, byType: [] },
            {
              date: '2026-01-15',
              booksAdded: 1_000_000,
              cumulativeBooks: 1_000_001,
              byType: [{ type: 'Novel', bookCount: 1_000_000 }],
            },
          ],
        },
      }),
    )
    const user = userEvent.setup()

    renderWithProviders(<AnalyticsPage />, {
      route: '/analytics?from=2026-01-01&to=2026-02-01&bucket=week',
    })

    expect(await screen.findByText(/Cumulative: 9,999 chapters/i)).toBeInTheDocument()
    expect(screen.getAllByText('January 1–14, 2026').length).toBeGreaterThan(1)
    expect(screen.getByText(/\+1,000,000 added/i)).toBeInTheDocument()
    expect(screen.getByText(/No additions by type/i)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /January 15/i })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Novel: 1,000,000/i })).toHaveAttribute(
      'href',
      '/books?query=created%3A%3E%3D2026-01-01%20created%3A%3C2026-02-01%20type%3ANovel%20created%3A%3E%3D2026-01-15%20created%3A%3C2026-01-22',
    )

    await user.click(screen.getByRole('button', { name: /view data for library growth/i }))
    expect(screen.getByRole('cell', { name: 'January 1–14, 2026' })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: 'No additions' })).toBeInTheDocument()
  })

  it('does not show the obsolete reading activity note', async () => {
    vi.mocked(api.getBookAnalytics).mockResolvedValue(createAnalytics())

    renderWithProviders(<AnalyticsPage />, { route: '/analytics?from=2026-01-01&to=2026-02-01' })

    expect(await screen.findByLabelText('Reading activity trend')).toBeInTheDocument()
    expect(screen.queryByText(/activity periods are informational/i)).not.toBeInTheDocument()
  })

  it('keeps daily chart points while compacting newest-first trend summaries', async () => {
    const activityPoints = [
      { date: '2026-07-10', progressEvents: 0, booksTouched: 0, chaptersAdvanced: 0 },
      { date: '2026-07-11', progressEvents: 0, booksTouched: 0, chaptersAdvanced: 0 },
      { date: '2026-07-12', progressEvents: 2, booksTouched: 1, chaptersAdvanced: 7 },
      { date: '2026-07-13', progressEvents: 0, booksTouched: 0, chaptersAdvanced: 0 },
    ]
    const growthPoints = [
      { date: '2026-07-10', booksAdded: 0, cumulativeBooks: 5, byType: [] },
      { date: '2026-07-11', booksAdded: 0, cumulativeBooks: 5, byType: [] },
      {
        date: '2026-07-12',
        booksAdded: 1,
        cumulativeBooks: 6,
        byType: [{ type: 'Novel', bookCount: 1 }],
      },
      { date: '2026-07-13', booksAdded: 0, cumulativeBooks: 6, byType: [] },
    ]
    vi.mocked(api.getBookAnalytics).mockResolvedValue(
      createAnalytics({
        scope: {
          from: '2026-07-10',
          to: '2026-07-14',
          bucket: 'day',
        },
        activity: { points: activityPoints },
        libraryGrowth: { openingCount: 5, points: growthPoints },
      }),
    )

    expect(readingActivityChartPoints(activityPoints, 'day')).toHaveLength(4)
    expect(
      readingActivityChartPoints(activityPoints, 'day').map((point) => point.cumulativeChapters),
    ).toEqual([0, 0, 7, 7])
    expect(
      readingActivityChartPoints(activityPoints, 'day', 150_000).map(
        (point) => point.cumulativeChapters,
      ),
    ).toEqual([150_000, 150_000, 150_007, 150_007])
    expect(libraryGrowthChartPoints(growthPoints, 'day')).toHaveLength(4)

    renderWithProviders(<AnalyticsPage />, {
      route: '/analytics?from=2026-07-10&to=2026-07-14&bucket=day',
    })

    expect((await screen.findAllByText(/Cumulative: 7 chapters/i)).length).toBeGreaterThan(0)

    const readingActivitySection = screen
      .getByRole('heading', { name: 'Reading activity' })
      .closest('section')
    const libraryGrowthSection = screen
      .getByRole('heading', { name: 'Library growth' })
      .closest('section')
    expect(readingActivitySection).not.toBeNull()
    expect(libraryGrowthSection).not.toBeNull()

    const readingText = readingActivitySection!.textContent
    expect(readingText).toContain('Jul 13, 2026')
    expect(readingText).toContain('July 10\u201311, 2026')
    expect(readingText.indexOf('Jul 13, 2026')).toBeLessThan(
      readingText.indexOf('July 10\u201311, 2026'),
    )

    const growthText = libraryGrowthSection!.textContent
    expect(growthText).toContain('Jul 13, 2026')
    expect(growthText).toContain('July 10\u201311, 2026')
    expect(growthText.indexOf('Jul 13, 2026')).toBeLessThan(
      growthText.indexOf('July 10\u201311, 2026'),
    )
  })

  it('renders quality charts with zero, full, unknown, and long-label buckets', async () => {
    vi.mocked(api.getBookAnalytics).mockResolvedValue(
      createAnalytics({
        totalBooks: 10,
        quality: {
          fieldCompleteness: [
            { field: 'author', bookCount: 10, shareOfBooks: 100 },
            { field: 'description', bookCount: 0, shareOfBooks: 0 },
            { field: 'alternateTitle', bookCount: 0, shareOfBooks: 0 },
            { field: 'usableCover', bookCount: 0, shareOfBooks: 0 },
          ],
          linkSources: [
            {
              source: 'Very Long Source Name With Symbols ~!@#$%^&*() And Spaces',
              linkCount: 99,
              bookCount: 4,
              shareOfBooks: 40,
            },
            { source: '', linkCount: 1, bookCount: 1, shareOfBooks: 10 },
          ],
          coverStatuses: [
            { status: 'Found', bookCount: 3, shareOfBooks: 30 },
            { status: 'Uploaded', bookCount: 2, shareOfBooks: 20 },
            { status: 'Failed', bookCount: 1, shareOfBooks: 10 },
            { status: 'NotFound', bookCount: 1, shareOfBooks: 10 },
            { status: 'Pending', bookCount: 1, shareOfBooks: 10 },
            { status: 'Mystery', bookCount: 2, shareOfBooks: 20 },
          ],
          coverSources: [
            { source: 'NovelUpdates', bookCount: 5, shareOfBooks: 50 },
            { source: '', bookCount: 1, shareOfBooks: 10 },
          ],
        },
      }),
    )
    const user = userEvent.setup()

    renderWithProviders(<AnalyticsPage />, { route: '/analytics?from=2026-01-01&to=2026-02-01' })

    expect(await screen.findByText(/Cleanup queue/i)).toBeInTheDocument()
    expect(screen.getByText(/Usable covers are counted only/i)).toBeInTheDocument()
    expect(
      screen.getByTitle(
        'Open books filtered by created:>=2026-01-01 created:<2026-02-01 cover:none',
      ),
    ).toBeInTheDocument()
    expect(screen.getByText(/Unknown status bucket: 2 books/i)).toBeInTheDocument()
    expect(screen.getByText(/Very Long Source Name/i)).toBeInTheDocument()
    const authorCompleteness = screen.getByLabelText('Author completeness 100%')
    expect(authorCompleteness.firstElementChild).toHaveStyle({ width: '100%' })

    const analyticsLinks = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'))
    expect(analyticsLinks.some((link) => link.href.includes('description%3Anone'))).toBe(true)
    expect(analyticsLinks.some((link) => link.href.includes('alternateTitle%3Anone'))).toBe(true)
    expect(analyticsLinks.some((link) => link.href.includes('cover%3Anone'))).toBe(true)
    expect(analyticsLinks.some((link) => link.href.includes('coverStatus'))).toBe(false)
    expect(analyticsLinks.some((link) => link.href.includes('coverSource'))).toBe(false)

    await user.click(screen.getByRole('button', { name: /view data for link sources/i }))
    expect(screen.getByRole('cell', { name: '99' })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: '4' })).toBeInTheDocument()
  })

  it('links every searchable metadata completeness field to its missing-value filter', async () => {
    vi.mocked(api.getBookAnalytics).mockResolvedValue(
      createAnalytics({
        totalBooks: 10,
        quality: {
          fieldCompleteness: [
            { field: 'author', bookCount: 0, shareOfBooks: 0 },
            { field: 'description', bookCount: 0, shareOfBooks: 0 },
            { field: 'genre', bookCount: 0, shareOfBooks: 0 },
            { field: 'tag', bookCount: 0, shareOfBooks: 0 },
            { field: 'rating', bookCount: 0, shareOfBooks: 0 },
            { field: 'priority', bookCount: 0, shareOfBooks: 0 },
            { field: 'totalChapters', bookCount: 0, shareOfBooks: 0 },
            { field: 'link', bookCount: 0, shareOfBooks: 0 },
            { field: 'alternateTitle', bookCount: 0, shareOfBooks: 0 },
            { field: 'usableCover', bookCount: 0, shareOfBooks: 0 },
          ],
          linkSources: [],
          coverStatuses: [],
          coverSources: [],
        },
      }),
    )

    renderWithProviders(<AnalyticsPage />, { route: '/analytics?from=2026-01-01&to=2026-02-01' })
    await screen.findByText(/Cleanup queue/i)

    for (const query of [
      'author:none',
      'description:none',
      'genre:none',
      'tag:none',
      'rating:none',
      'priority:none',
      'total:none',
      'link:none',
      'alternateTitle:none',
      'cover:none',
    ]) {
      const scopedQuery = `created:>=2026-01-01 created:<2026-02-01 ${query}`
      const expectedHref = `/books?query=${encodeURIComponent(scopedQuery)}`
      expect(
        screen
          .getAllByTitle(`Open books filtered by ${scopedQuery}`)
          .some((link) => link.getAttribute('href') === expectedHref),
      ).toBe(true)
    }
  })

  it('keeps analytics type labels readable against their calculated background', async () => {
    vi.mocked(api.getBookAnalytics).mockResolvedValue(createAnalytics())

    renderWithProviders(<AnalyticsPage />, { route: '/analytics?from=2026-01-01&to=2026-02-01' })

    expectReadableTextContrast(firstOf(await screen.findAllByText('Novel')))
  })
})

function firstOf<T>(items: readonly T[]): T {
  const item = items[0]
  if (item === undefined) {
    throw new Error('Expected at least one matching element')
  }
  return item
}

type AnalyticsOverrides = Partial<BookAnalyticsDto['overview']> & {
  scope?: Partial<BookAnalyticsDto['scope']>
  composition?: Partial<BookAnalyticsDto['composition']>
  planning?: Partial<BookAnalyticsDto['planning']>
  progress?: Partial<BookAnalyticsDto['progress']>
  ratings?: Partial<BookAnalyticsDto['ratings']>
  activity?: Partial<BookAnalyticsDto['activity']>
  libraryGrowth?: Partial<BookAnalyticsDto['libraryGrowth']>
  quality?: Partial<BookAnalyticsDto['quality']>
}

function getTodayForTest() {
  const date = new Date()
  date.setHours(0, 0, 0, 0)
  return date
}

function toDateInputValueForTest(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function dayButtonName(date: Date) {
  return format(date, 'EEEE, MMMM do, yyyy')
}

function dayButtonMatcher(date: Date) {
  return new RegExp(`^${escapeRegExp(dayButtonName(date))}`)
}

function getDayCell(button: HTMLElement) {
  const cell = button.closest('td')
  if (!cell) {
    throw new Error('Expected date button to be rendered inside a day cell.')
  }

  return cell
}

function expectNoClassContaining(element: HTMLElement, classNamePart: string) {
  const matchingClass = Array.from(element.classList).find((className) =>
    className.includes(classNamePart),
  )
  expect(matchingClass).toBeUndefined()
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function createAnalytics(overrides: AnalyticsOverrides = {}): BookAnalyticsDto {
  const overview = {
    totalBooks: 10,
    ratedBooks: 8,
    unratedBooks: 2,
    averageRating: 8.4,
    currentChapters: 468,
    booksWithKnownCurrentChapter: 9,
    booksWithoutKnownCurrentChapter: 1,
    ...overrides,
  }
  const composition = {
    statusByType:
      overview.totalBooks > 0
        ? [
            {
              type: 'Novel',
              totalBooks: 6,
              statuses: [
                { status: 'Reading', bookCount: 4 },
                { status: 'Completed', bookCount: 2 },
              ],
            },
          ]
        : [],
    genres: overview.totalBooks > 0 ? [{ name: 'Fantasy', bookCount: 6, shareOfBooks: 60 }] : [],
    tags: overview.totalBooks > 0 ? [{ name: 'favorite', bookCount: 4, shareOfBooks: 40 }] : [],
    ...overrides.composition,
  }
  const ratings = {
    ratedBooks: overview.ratedBooks,
    unratedBooks: overview.unratedBooks,
    averageRating: overview.averageRating,
    counts: Array.from({ length: 10 }, (_unused, index) => ({
      rating: index + 1,
      bookCount: index === 8 ? 1 : 0,
    })),
    ...overrides.ratings,
  }
  const planning = {
    prioritiesByStatus:
      overview.totalBooks > 0
        ? [
            {
              status: 'Reading',
              totalBooks: 6,
              priorities: [
                { priority: '1', bookCount: 2 },
                { priority: 'Unset', bookCount: 4 },
              ],
            },
          ]
        : [],
    ...overrides.planning,
  }
  const progress = {
    typeVolumes:
      overview.totalBooks > 0
        ? [
            {
              type: 'Novel',
              bookCount: 6,
              currentChapters: 468,
              averageCurrentChapter: 78,
              medianCurrentChapter: 64,
            },
          ]
        : [],
    ...overrides.progress,
  }

  return {
    generatedAt: '2026-07-15T12:00:00Z',
    scope: {
      query: null,
      from: '2026-01-01',
      to: '2026-02-01',
      bucket: 'week',
      ...overrides.scope,
    },
    overview,
    composition,
    ratings,
    planning,
    progress,
    activity: {
      baselineChapters: 0,
      points:
        overview.totalBooks > 0
          ? [
              {
                date: '2026-01-05',
                progressEvents: 3,
                booksTouched: 2,
                chaptersAdvanced: 18,
              },
            ]
          : [],
      ...overrides.activity,
    },
    libraryGrowth: {
      openingCount: 0,
      points:
        overview.totalBooks > 0
          ? [
              { date: '2026-01-01', booksAdded: 0, cumulativeBooks: 4, byType: [] },
              {
                date: '2026-01-08',
                booksAdded: 6,
                cumulativeBooks: 10,
                byType: [{ type: 'Novel', bookCount: 6 }],
              },
            ]
          : [],
      ...overrides.libraryGrowth,
    },
    quality: {
      fieldCompleteness:
        overview.totalBooks > 0
          ? [
              { field: 'author', bookCount: 9, shareOfBooks: 90 },
              { field: 'genre', bookCount: 6, shareOfBooks: 60 },
              { field: 'usableCover', bookCount: 4, shareOfBooks: 40 },
            ]
          : [],
      linkSources:
        overview.totalBooks > 0
          ? [{ source: 'NovelUpdates', linkCount: 8, bookCount: 6, shareOfBooks: 60 }]
          : [],
      coverStatuses:
        overview.totalBooks > 0
          ? [
              { status: 'Found', bookCount: 4, shareOfBooks: 40 },
              { status: 'Pending', bookCount: 2, shareOfBooks: 20 },
            ]
          : [],
      coverSources:
        overview.totalBooks > 0 ? [{ source: 'NovelUpdates', bookCount: 4, shareOfBooks: 40 }] : [],
      ...overrides.quality,
    },
  }
}
