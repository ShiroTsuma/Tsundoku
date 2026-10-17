import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Link, Route, Routes } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import { renderWithProviders } from '@/test/render'
import { EpubSearchClientContext } from './clientContext'
import { createMockEpubSearchClient } from './mockClient'
import { EpubDownloadNotifications } from './EpubDownloadNotifications'
import { epubSearchKeys } from './queries'
import type { EpubDownloadJob } from './types'

vi.mock('@/api/http', () => ({ getStoredSessionUserId: () => 'owner-1' }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
})

it('notifies from Library after leaving the book and opens the book from the toast', async () => {
  const user = userEvent.setup()
  const client = createMockEpubSearchClient()
  const job: EpubDownloadJob = {
    id: 'download-1',
    bookId: 'book-1',
    bookTitle: 'Blood Servant',
    sourceName: 'Doby',
    status: 'crawling',
    chaptersDone: 0,
    chaptersTotal: 100,
    files: [],
    startedAt: new Date().toISOString(),
    error: null,
  }
  client.listOwnerDownloads = vi.fn().mockResolvedValue([job])
  const { queryClient } = renderWithProviders(
    <EpubSearchClientContext value={client}>
      <EpubDownloadNotifications />
      <Link to="/books">Library</Link>
      <Routes>
        <Route path="/books" element={<div>Library screen</div>} />
        <Route path="/books/book-1" element={<div>Book screen</div>} />
      </Routes>
    </EpubSearchClientContext>,
    { route: '/books/book-1' },
  )
  await waitFor(() =>
    expect(localStorage.getItem('tsundoku.epub-notifications.owner-1')).toContain('download-1'),
  )
  await user.click(screen.getByRole('link', { name: 'Library' }))
  expect(screen.getByText('Library screen')).toBeInTheDocument()
  const completed: EpubDownloadJob = {
    ...job,
    status: 'completed',
    files: [
      {
        title: 'Volume 1',
        firstChapter: 1,
        lastChapter: 100,
        chaptersDone: 100,
        status: 'added',
      },
    ],
  }
  queryClient.setQueryData(epubSearchKeys.ownerDownloads('owner-1'), [completed])
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith(
      'EPUB download completed',
      expect.objectContaining({
        description: 'Blood Servant · 1 file added to the book',
      }),
    ),
  )
  const options = vi.mocked(toast.success).mock.calls[0]?.[1]
  const action = options?.action
  if (action && typeof action === 'object' && 'onClick' in action) {
    action.onClick({} as never)
  }
  await waitFor(() => expect(screen.getByText('Book screen')).toBeInTheDocument())
  queryClient.setQueryData(epubSearchKeys.ownerDownloads('owner-1'), [completed])
  expect(toast.success).toHaveBeenCalledTimes(1)
})
