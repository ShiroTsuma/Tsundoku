import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { EpubSearchClientContext } from './clientContext'
import { EpubSearchDialog, type EpubSearchBook } from './EpubSearchDialog'
import { createMockEpubSearchClient } from './mockClient'

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
