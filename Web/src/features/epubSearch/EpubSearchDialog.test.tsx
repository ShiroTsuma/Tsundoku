import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { EpubSearchClientContext } from './clientContext'
import { EpubSearchDialog, type EpubSearchBook } from './EpubSearchDialog'
import { createMockEpubSearchClient } from './mockClient'
import type { EpubDownloadJob } from './types'

const book: EpubSearchBook = {
  id: 'book-1',
  title: 'My Entire Class Was Summoned to Another World except for Me',
  alternativeTitles: ['Class ga Isekai Shoukan Sareta Naka Ore dake Nokottan Desu ga'],
  chaptersRead: 167,
  chapterLabel: '166',
  existingFileCount: 3,
}

function renderDialog(onDownloadFinished = vi.fn()) {
  const client = createMockEpubSearchClient({ wait: () => Promise.resolve(), msPerChapter: 0 })
  renderWithProviders(
    <EpubSearchClientContext value={client}>
      <EpubSearchDialog
        book={book}
        open
        onClose={vi.fn()}
        onDownloadFinished={onDownloadFinished}
      />
    </EpubSearchClientContext>,
  )
  return { onDownloadFinished }
}

describe('EpubSearchDialog', () => {
  it('previews replacement of volume 6 with 501–592 instead of appending six new volumes', async () => {
    const user = userEvent.setup()
    const client = createMockEpubSearchClient()
    vi.spyOn(client, 'search').mockResolvedValue({
      status: 'completed',
      searchedSourceCount: 1,
      durationMs: 1,
      candidates: [
        {
          id: 'novel',
          title: book.title,
          match: 'title',
          sources: [
            {
              id: 'source',
              sourceName: 'Source A',
              url: 'https://example.com/novel',
              language: 'en',
              chapterCount: 592,
              latestChapterLabel: '592',
              updatedAt: null,
              existingVolumes: Array.from({ length: 6 }, (_, i) => ({
                fileId: `file-${i}`,
                title: `Volume ${i + 1}`,
                firstChapter: i * 100 + 1,
                lastChapter: i === 5 ? 527 : (i + 1) * 100,
              })),
            },
          ],
        },
      ],
    })
    renderWithProviders(
      <EpubSearchClientContext value={client}>
        <EpubSearchDialog book={{ ...book, existingFileCount: 6 }} open onClose={vi.fn()} />
      </EpubSearchClientContext>,
    )
    await user.click(screen.getByRole('button', { name: 'Search' }))
    await user.click(await screen.findByRole('radio', { name: /Source A/ }))
    await user.click(screen.getByRole('button', { name: 'Use this source' }))
    await user.click(screen.getByRole('radio', { name: /Everything/ }))
    await user.click(screen.getByRole('checkbox', { name: /Regenerate affected volumes/ }))
    expect(screen.getByText('92 chapters')).toBeInTheDocument()
    expect(screen.getByText(/501–592/)).toHaveTextContent('1 EPUB file: Volume 6')
    expect(screen.getByRole('button', { name: 'Start download' })).toBeEnabled()
  })

  it('refreshes only the selected source in the download step and retries with the same options', async () => {
    const user = userEvent.setup()
    const client = createMockEpubSearchClient({ wait: () => Promise.resolve() })
    const search = vi.spyOn(client, 'search')
    const failed: EpubDownloadJob = {
      id: 'failed-job',
      bookId: book.id,
      sourceName: 'Source A',
      status: 'failed',
      chaptersDone: 0,
      chaptersTotal: 300,
      files: [],
      startedAt: new Date().toISOString(),
      error: 'The source chapter list changed.',
    }
    const start = vi.spyOn(client, 'startDownload').mockResolvedValue(failed)
    vi.spyOn(client, 'getDownload').mockResolvedValue(failed)
    renderWithProviders(
      <EpubSearchClientContext value={client}>
        <EpubSearchDialog book={book} open onClose={vi.fn()} />
      </EpubSearchClientContext>,
    )
    await user.click(screen.getByRole('button', { name: 'Search' }))
    await user.click(await screen.findByRole('radio', { name: /Source A/ }))
    await user.click(screen.getByRole('button', { name: 'Use this source' }))
    await user.click(screen.getByRole('radio', { name: /Everything/ }))
    expect(screen.queryByRole('checkbox', { name: /Add finished files/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: /Regenerate affected volumes/ }))
    await user.click(screen.getByRole('button', { name: 'Start download' }))
    await screen.findByText('Download failed')
    await user.click(screen.getByRole('button', { name: /^Refresh$/ }))
    expect(await screen.findByText(/refreshed: .* chapters/)).toBeInTheDocument()
    expect(search).toHaveBeenLastCalledWith(
      expect.objectContaining({
        sourceId: start.mock.calls[0]![0].sourceId,
        forceRefresh: true,
      }),
      expect.any(AbortSignal),
    )
    expect(screen.getByLabelText('Steps').querySelector('[aria-current="step"]')).toHaveTextContent(
      'Download',
    )
    expect(screen.queryByRole('button', { name: 'Use this source' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Start download' }))
    expect(start.mock.calls[1]![0]).toEqual(start.mock.calls[0]![0])
    expect(start.mock.calls[1]![0]).toMatchObject({
      range: { kind: 'all' },
      regenerateAffectedVolumes: true,
    })
  })

  it('reads current saved metadata when reopening a completed search', async () => {
    const user = userEvent.setup()
    const client = createMockEpubSearchClient()
    const search = vi.spyOn(client, 'search').mockResolvedValue({
      candidates: [],
      searchedSourceCount: 1,
      durationMs: 1,
      status: 'completed',
    })
    const dialog = (open: boolean) => (
      <EpubSearchClientContext value={client}>
        <EpubSearchDialog book={book} open={open} onClose={vi.fn()} />
      </EpubSearchClientContext>
    )
    const { rerender } = renderWithProviders(dialog(true))
    await user.click(screen.getByRole('button', { name: 'Search' }))
    await waitFor(() => expect(search).toHaveBeenCalledTimes(1))
    rerender(dialog(false))
    rerender(dialog(true))
    await waitFor(() => expect(search).toHaveBeenCalledTimes(2))
  })

  it('shows an automatic retry deadline while keeping cancellation available', async () => {
    const client = createMockEpubSearchClient()
    vi.spyOn(client, 'getDownload').mockResolvedValue({
      id: 'retry-job',
      bookId: book.id,
      sourceName: 'Dobytranslations',
      status: 'queued',
      chaptersDone: 10,
      chaptersTotal: 100,
      files: [],
      startedAt: new Date().toISOString(),
      error: null,
      nextRetryAt: new Date(Date.now() + 600000).toISOString(),
      retryAttempt: 2,
    })
    renderWithProviders(
      <EpubSearchClientContext value={client}>
        <EpubSearchDialog book={book} open onClose={vi.fn()} initialJobId="retry-job" />
      </EpubSearchClientContext>,
    )
    expect(
      await screen.findByText(/Source temporarily unavailable\. Retry 2\/5 in 10 min/),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Cancel download/ })).toBeEnabled()
  })

  it('searches, picks a source, plans the files and starts a download', async () => {
    const user = userEvent.setup()
    renderDialog()

    expect(screen.getByRole('searchbox')).toHaveValue(book.title)
    await user.click(
      screen.getByRole('button', {
        name: 'Class ga Isekai Shoukan Sareta Naka Ore dake Nokottan Desu ga',
      }),
    )
    expect(screen.getByRole('searchbox')).toHaveValue(book.alternativeTitles[0])
    await user.click(screen.getByRole('button', { name: 'Search' }))

    const useSource = screen.getByRole('button', { name: 'Use this source' })
    expect(useSource).toBeDisabled()
    await user.click(await screen.findByRole('radio', { name: /Source A/ }))
    expect(screen.getByRole('radio', { name: /Source A/ })).toHaveAttribute('aria-checked', 'true')
    await user.click(useSource)

    expect(screen.getByRole('radio', { name: /Continue from my progress/ })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    expect(screen.getByText(/Volume 4, Volume 5/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Start download' }))
    expect(
      await screen.findByRole('progressbar', { name: 'Download progress' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Volume 4')).toBeInTheDocument()
  })

  it('reports a finished download once', async () => {
    const user = userEvent.setup()
    const { onDownloadFinished } = renderDialog()
    await user.click(screen.getByRole('button', { name: 'Search' }))
    await user.click(await screen.findByRole('radio', { name: /Source A/ }))
    await user.click(screen.getByRole('button', { name: 'Use this source' }))
    await user.click(screen.getByRole('button', { name: 'Start download' }))

    expect(
      await screen.findByText('All files added to the book', {}, { timeout: 4000 }),
    ).toBeInTheDocument()
    expect(onDownloadFinished).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument()
  })

  it('marks sources that are behind the reader', async () => {
    const user = userEvent.setup()
    renderDialog()
    await user.click(screen.getByRole('button', { name: 'Search' }))
    expect(await screen.findAllByText('Behind you')).not.toHaveLength(0)
    expect(screen.getAllByText('Covers Ch. 168+')).not.toHaveLength(0)
  })

  it('opens the fetched novel through its title without selecting a source', async () => {
    const user = userEvent.setup()
    renderDialog()
    await user.click(screen.getByRole('button', { name: 'Search' }))
    const title = await screen.findByRole('link', { name: book.title })
    expect(title).toHaveAttribute('target', '_blank')
    expect(title).toHaveAttribute('rel', 'noopener noreferrer')
    expect(title.getAttribute('href')).toMatch(/^https?:\/\//)
    expect(screen.getByRole('button', { name: 'Use this source' })).toBeDisabled()
  })
})
