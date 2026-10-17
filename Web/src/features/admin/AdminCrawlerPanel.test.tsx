import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { AdminCrawlerPanel } from './AdminCrawlerPanel'
import { useAdminCrawlerActivity } from '@/features/epubSearch/crawlerMonitor'
import type * as CrawlerMonitorModule from '@/features/epubSearch/crawlerMonitor'

vi.mock('./CrawlerSourcesPanel', () => ({ CrawlerSourcesPanel: () => <div>Source settings</div> }))
vi.mock('./CrawlerProcessingControl', () => ({ CrawlerProcessingControl: () => null }))

vi.mock('@/features/epubSearch/crawlerMonitor', async (original) => ({
  ...(await original<typeof CrawlerMonitorModule>()),
  useAdminCrawlerActivity: vi.fn(),
}))

beforeEach(() => vi.clearAllMocks())

it('shows cross-account progress, retry details and scrollable job filters', async () => {
  const user = userEvent.setup()
  vi.mocked(useAdminCrawlerActivity).mockReturnValue({
    data: {
      pages: [
        {
          enabled: true,
          checkedBooks: 12,
          totalBooks: 142,
          pendingBooks: 130,
          runningJobs: 1,
          waitingJobs: 2,
          trackedSources: 78,
          totalJobs: 1,
          skip: 0,
          take: 20,
          observedAtUtc: new Date().toISOString(),
          jobs: [
            {
              id: 'job-1',
              bookId: 'book-1',
              bookTitle: 'Blood Servant',
              username: 'ShiroTsuma',
              kind: 'discovery',
              status: 'queued',
              retryAttempt: 1,
              nextRetryAt: new Date(Date.now() + 540000).toISOString(),
              createdAtUtc: new Date().toISOString(),
              nextAttemptAtUtc: new Date().toISOString(),
              currentSource: 'readwebnovels.net',
              searchedSourceCount: 28,
              totalSourceCount: 35,
              checkedLinkCount: 3,
              totalLinkCount: 3,
              chaptersDone: 0,
              chaptersTotal: 0,
              readyFiles: 0,
              totalFiles: 0,
              warnings: ['Source connection interrupted'],
              error: null,
            },
          ],
        },
      ],
      pageParams: [0],
    },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useAdminCrawlerActivity>)
  renderWithProviders(<AdminCrawlerPanel />)
  expect(screen.getByText('12/142 books checked')).toBeInTheDocument()
  expect(screen.getByText(/ShiroTsuma/)).toBeInTheDocument()
  expect(screen.getByText('Waiting to retry')).toBeInTheDocument()
  const warning = screen.getByText('Source connection interrupted')
  expect(warning).not.toBeVisible()
  await user.click(screen.getByText(/Job details/))
  expect(warning).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Failed jobs' }))
  expect(useAdminCrawlerActivity).toHaveBeenLastCalledWith('failed')
})

it('separates source settings from job activity', async () => {
  renderWithProviders(<AdminCrawlerPanel />)
  expect(screen.queryByText('Source settings')).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Sources' }))
  expect(screen.getByText('Source settings')).toBeInTheDocument()
  expect(screen.queryByText('12/142 books checked')).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Activity' }))
  expect(screen.queryByText('Source settings')).not.toBeInTheDocument()
})
