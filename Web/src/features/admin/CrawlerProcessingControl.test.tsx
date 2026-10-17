import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import { apiRequest } from '@/api/http'
import { renderWithProviders } from '@/test/render'
import { CrawlerProcessingControl } from './CrawlerProcessingControl'

vi.mock('@/api/http', () => ({ apiRequest: vi.fn() }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
beforeEach(() => vi.clearAllMocks())

it('starts and pauses actual processing through the admin API', async () => {
  let processingEnabled = false
  vi.mocked(apiRequest).mockImplementation((_url, options) => {
    if (options?.method === 'PUT')
      processingEnabled = (options.body as { processingEnabled: boolean }).processingEnabled
    return Promise.resolve({ processingEnabled })
  })
  renderWithProviders(<CrawlerProcessingControl />)
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: 'Start processing' }))
  expect(await screen.findByText('Processing active')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Pause processing' }))
  expect(await screen.findByText('Processing paused')).toBeInTheDocument()
  expect(apiRequest).toHaveBeenCalledWith('/admin/crawler/processing', {
    method: 'PUT',
    body: { processingEnabled: true },
  })
  expect(apiRequest).toHaveBeenCalledWith('/admin/crawler/processing', {
    method: 'PUT',
    body: { processingEnabled: false },
  })
})

it('preserves the shown state when the control request fails', async () => {
  vi.mocked(apiRequest).mockImplementation((_url, options) => {
    if (options?.method === 'PUT') return Promise.reject(new Error('offline'))
    return Promise.resolve({ processingEnabled: false })
  })
  renderWithProviders(<CrawlerProcessingControl />)
  await userEvent.click(await screen.findByRole('button', { name: 'Start processing' }))
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Start processing' })).toBeEnabled(),
  )
  expect(screen.getByText('Processing paused')).toBeInTheDocument()
})
