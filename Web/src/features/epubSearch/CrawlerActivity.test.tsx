import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { CrawlerActivity } from './CrawlerActivity'
import { useCrawlerMonitor, type CrawlerMonitorSnapshot } from './crawlerMonitor'

vi.mock('@/features/auth/useAuth', () => ({ useAuth: () => ({ isAdmin: true }) }))
vi.mock('./crawlerMonitor', () => ({
  useCrawlerMonitor: vi.fn(),
  jobProgress: vi.fn(),
  jobKindLabels: {},
}))

const idle: CrawlerMonitorSnapshot = {
  enabled: true,
  observedAtUtc: '',
  totalBooks: 10,
  checkedBooks: 10,
  pendingBooks: 0,
  runningJobs: 0,
  waitingJobs: 0,
  trackedSources: 0,
  totalJobs: 0,
  skip: 0,
  take: 10,
  jobs: [],
}

describe('CrawlerActivity', () => {
  it.each([
    ['idle', idle],
    ['disabled', { ...idle, enabled: false, runningJobs: 1 }],
    ['loading', undefined],
  ])('hides the header indicator when %s', (_, data) => {
    vi.mocked(useCrawlerMonitor).mockReturnValue({ data, isError: false } as ReturnType<
      typeof useCrawlerMonitor
    >)
    renderWithProviders(<CrawlerActivity />)
    expect(screen.queryByRole('button', { name: /crawler activity/i })).not.toBeInTheDocument()
  })

  it.each(['runningJobs', 'waitingJobs', 'pendingBooks'] as const)(
    'shows the indicator while there are %s',
    (field) => {
      vi.mocked(useCrawlerMonitor).mockReturnValue({
        data: { ...idle, [field]: 1 },
        isError: false,
      } as ReturnType<typeof useCrawlerMonitor>)
      renderWithProviders(<CrawlerActivity />)
      expect(screen.getByRole('button', { name: /crawler activity/i })).toBeInTheDocument()
    },
  )
})
