import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { apiRequest } from '@/api/http'
import { renderWithProviders } from '@/test/render'
import { CrawlerSourcesPanel } from './CrawlerSourcesPanel'

vi.mock('@/api/http', () => ({ apiRequest: vi.fn() }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

it('shows source rates and lets admin disable search or pin a source', async () => {
  const user = userEvent.setup()
  vi.mocked(apiRequest).mockResolvedValue({
    processingEnabled: false,
    sources: [
      {
        domain: 'dobytranslations.com',
        url: 'https://dobytranslations.com',
        language: 'en',
        canSearch: true,
        enabled: true,
        alwaysInclude: false,
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
  })
  renderWithProviders(<CrawlerSourcesPanel />)
  expect(await screen.findByText('dobytranslations.com')).toBeInTheDocument()
  expect(screen.getByText(/80%/)).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Always include' }))
  await waitFor(() =>
    expect(apiRequest).toHaveBeenCalledWith('/admin/crawler/sources/dobytranslations.com', {
      method: 'PUT',
      body: { enabled: true, alwaysInclude: true },
    }),
  )
  await waitFor(() => expect(screen.getByRole('button', { name: 'Disable search' })).toBeEnabled())
  await user.click(screen.getByRole('button', { name: 'Disable search' }))
  await waitFor(() =>
    expect(apiRequest).toHaveBeenCalledWith('/admin/crawler/sources/dobytranslations.com', {
      method: 'PUT',
      body: { enabled: false, alwaysInclude: false },
    }),
  )
})
