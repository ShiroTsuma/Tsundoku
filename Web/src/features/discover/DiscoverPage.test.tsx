import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/api/client'
import { paginated } from '@/test/fixtures'
import { renderWithProviders } from '@/test/render'
import { DiscoverPage } from './DiscoverPage'

vi.mock('@/api/client', () => ({
  api: {
    searchPublicBooks: vi.fn(),
    copyPublicBook: vi.fn(),
  },
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

const snapshot = {
  id: 'snapshot-1',
  sourceBookId: 'source-1',
  primaryTitle: 'Lord of Mysteries',
  description: 'A mysterious public snapshot.',
  alternativeTitles: ['LOTM', 'Guimi Zhi Zhu'],
  author: 'Cuttlefish',
  authorOtherNames: ['Cuttlefish That Loves Diving'],
  contentType: 'Novel',
  totalChapters: 1432,
  genres: [{ name: 'Fantasy', description: 'Magic and the impossible' }],
  tags: [{ name: 'Mystery', description: 'Secrets and investigations' }],
  coverUrl: null,
  snapshotAt: '2026-07-18T12:00:00Z',
  isOwner: false,
}

describe('DiscoverPage', () => {
  beforeEach(() => {
    vi.mocked(api.searchPublicBooks)
      .mockReset()
      .mockResolvedValue(paginated([snapshot]))
    vi.mocked(api.copyPublicBook).mockReset().mockResolvedValue({ bookId: 'copied-book' })
  })

  it('searches shared snapshots and creates an independent library copy', async () => {
    const user = userEvent.setup()
    renderWithProviders(<DiscoverPage />)

    expect(
      await screen.findByRole('heading', { level: 2, name: /Lord of Mysteries/ }),
    ).toBeInTheDocument()
    // The page formats chapter counts with the runtime locale (e.g. "1,432" in en, "1432" in pl).
    expect(screen.getByText(`${(1432).toLocaleString()} chapters`)).toBeInTheDocument()
    // Described metadata pills must be keyboard-focusable so their tooltip is reachable.
    expect(screen.getByText('Mystery').closest('button, [tabindex="0"]')).toBeInTheDocument()
    await user.hover(screen.getByLabelText('2 alternative titles'))
    expect(screen.getByRole('tooltip')).toHaveTextContent('Alternative titles: LOTM Guimi Zhi Zhu')

    await user.type(screen.getByPlaceholderText(/exclude with -tag:/i), '-tag:romance')
    await waitFor(() =>
      expect(api.searchPublicBooks).toHaveBeenCalledWith({
        search: '-tag:romance',
        skip: 0,
        take: 40,
      }),
    )

    await user.click(screen.getByRole('button', { name: 'Add to library' }))
    await waitFor(() => expect(api.copyPublicBook).toHaveBeenCalledWith(snapshot.id))
  })
})
