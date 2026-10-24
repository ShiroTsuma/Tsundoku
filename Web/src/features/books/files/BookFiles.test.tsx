import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { bookFilesApi, startFileDownload, type BookFile, type FileJob } from '@/api/bookFiles'
import type * as BookFilesModule from '@/api/bookFiles'
import { api } from '@/api/client'
import { renderWithProviders } from '@/test/render'
import { BookFilesDialog, BookFilesPanel } from '../BookFilesPanel'
import { FileExportDialog } from './FileExportDialog'
import { FileImportDialog } from './FileImportDialog'
import { FileDownloadDialog } from './FileDownloadDialog'
import { FileContents } from './FileContents'

vi.mock('@/api/bookFiles', async (importOriginal) => ({
  ...(await importOriginal<typeof BookFilesModule>()),
  startFileDownload: vi.fn(),
  bookFilesApi: Object.fromEntries(
    [
      'limits',
      'list',
      'publicList',
      'jobs',
      'job',
      'rename',
      'reorder',
      'share',
      'remove',
      'restore',
      'upload',
      'confirm',
      'cancel',
      'candidates',
      'export',
      'downloads',
      'jobDownload',
    ].map((name) => [name, vi.fn()]),
  ),
}))
vi.mock('@/api/client', () => ({ api: { getBooks: vi.fn() } }))

const files: BookFile[] = ['Volume 1', 'Volume 2'].map((title, i) => ({
  id: `file-${i}`,
  bookId: 'book-1',
  title,
  originalFileName: `${i}.epub`,
  sortOrder: i,
  sizeBytes: 1024,
  createdAt: '2026-10-13T10:00:00Z',
  deletedAtUtc: null,
  isShared: false,
}))
const ready: FileJob = {
  id: 'job-1',
  bookId: null,
  kind: 'LibraryExport',
  status: 'Ready',
  processedFiles: 2,
  totalFiles: 2,
  expiresAtUtc: '2099-01-01T00:00:00Z',
  error: null,
  entries: [],
  warnings: [],
  importedCount: 0,
  skippedCount: 0,
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(bookFilesApi.limits).mockResolvedValue({
    maxFileBytes: 104857600,
    maxUploadBytes: 314572800,
    maxFilesPerImport: 100,
    maxLibraryArchiveBytes: 12884901888,
    retentionDays: 30,
  })
  vi.mocked(bookFilesApi.jobs).mockResolvedValue([])
  vi.mocked(bookFilesApi.list).mockResolvedValue({
    files,
    snapshotId: 'public-1',
    usedStorageBytes: 2048,
    maxStorageBytes: 10737418240,
    maxFileBytes: 104857600,
    maxUploadBytes: 314572800,
  })
  vi.mocked(bookFilesApi.publicList).mockResolvedValue(files)
  vi.mocked(bookFilesApi.job).mockResolvedValue(ready)
  vi.mocked(bookFilesApi.export).mockResolvedValue(ready)
  vi.mocked(bookFilesApi.cancel).mockResolvedValue(undefined)
  vi.mocked(bookFilesApi.downloads).mockResolvedValue([
    {
      fileId: files[0]!.id,
      title: files[0]!.title,
      url: '/api/v1/book/files/download/ticket?token=secret',
    },
  ])
})

describe('EPUB file UX', () => {
  it('shows the next manual import position from one and allows clearing and editing it', async () => {
    const user = userEvent.setup()
    const job: FileJob = {
      ...ready,
      bookId: 'book-1',
      kind: 'BookImport',
      entries: [
        {
          id: 'next',
          bookId: 'book-1',
          bookTitle: 'Book',
          contentType: 'Novel',
          originalFileName: 'next.epub',
          title: 'Volume 4',
          sortOrder: 3,
          sizeBytes: 1024,
          isDuplicate: false,
          error: null,
        },
      ],
    }
    vi.mocked(bookFilesApi.job).mockResolvedValue(job)
    vi.mocked(bookFilesApi.confirm).mockResolvedValue({ ...job, status: 'CommitQueued' })
    renderWithProviders(
      <FileImportDialog bookId="book-1" initialJob={job} onClose={vi.fn()} onImported={vi.fn()} />,
    )
    const order = await screen.findByLabelText('Order')
    expect(order).toHaveValue(4)
    await user.clear(order)
    expect(screen.getByRole('button', { name: 'Import selected (1)' })).toBeDisabled()
    await user.type(order, '5')
    await user.click(screen.getByRole('button', { name: 'Import selected (1)' }))
    expect(bookFilesApi.confirm).toHaveBeenCalledWith('job-1', [
      { entryId: 'next', bookId: 'book-1', title: 'Volume 4', sortOrder: 4 },
    ])
  })

  it('downloads one EPUB directly from its browsing row', async () => {
    const user = userEvent.setup()
    renderWithProviders(<BookFilesPanel bookId="book-1" />)
    await user.click(await screen.findByRole('button', { name: 'Download Volume 1' }))
    expect(bookFilesApi.downloads).toHaveBeenCalledWith(['file-0'], undefined)
    await waitFor(() => expect(startFileDownload).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('dialog', { name: 'Download EPUBs' })).not.toBeInTheDocument()
  })
  it('preserves compact chapter identifiers even when the file title matches their prefix', () => {
    renderWithProviders(
      <FileContents file={{ title: 'V2', firstContentLabel: 'V2C1', lastContentLabel: 'V2C80' }} />,
    )
    expect(screen.getByText('V2C1 → V2C80')).toBeInTheDocument()
  })

  it('cancels a ZIP that finishes being created after the user asks to close', async () => {
    const user = userEvent.setup()
    let resolve!: (job: FileJob) => void
    vi.mocked(bookFilesApi.export).mockReturnValue(
      new Promise<FileJob>((done) => {
        resolve = done
      }),
    )
    const close = vi.fn()
    renderWithProviders(<FileDownloadDialog files={files} onClose={close} />)
    await user.click(screen.getByRole('button', { name: 'Create ZIP' }))
    await user.click(screen.getByRole('button', { name: /^Close$/ }))
    expect(close).not.toHaveBeenCalled()
    resolve({ ...ready, status: 'Queued' })
    await waitFor(() => expect(bookFilesApi.cancel).toHaveBeenCalledWith('job-1'))
    await waitFor(() => expect(close).toHaveBeenCalled())
  })

  it('cancels a known export even while its status request is pending', async () => {
    const user = userEvent.setup()
    vi.mocked(bookFilesApi.export).mockResolvedValue({ ...ready, status: 'Queued' })
    vi.mocked(bookFilesApi.job).mockReturnValue(
      new Promise(() => {
        // Never settles: keeps the status request pending for this test.
      }),
    )
    const close = vi.fn()
    renderWithProviders(<FileDownloadDialog files={files} onClose={close} />)
    await user.click(screen.getByRole('button', { name: 'Create ZIP' }))
    await waitFor(() => expect(bookFilesApi.job).toHaveBeenCalled())
    await user.click(screen.getByRole('button', { name: /^Close$/ }))
    await waitFor(() => expect(bookFilesApi.cancel).toHaveBeenCalledWith('job-1'))
    expect(close).toHaveBeenCalled()
  })
  it('lists files on the book page and keeps management behind Manage', async () => {
    const user = userEvent.setup()
    renderWithProviders(<BookFilesPanel bookId="book-1" />)
    expect(await screen.findByText('2 files · 2.0 KiB')).toBeInTheDocument()
    expect(screen.getByText('Volume 1')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Download Volume 1' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Share Volume 1')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Rename Volume 1' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Manage' }))
    expect(screen.getByRole('button', { name: 'Rename Volume 1' })).toBeInTheDocument()
  })
  it('refreshes the library when an import partially succeeds and then fails', async () => {
    const partial = {
      ...ready,
      kind: 'LibraryImport' as const,
      status: 'Failed',
      importedCount: 1,
      error: 'Storage unavailable',
    }
    vi.mocked(bookFilesApi.job).mockResolvedValue(partial)
    const imported = vi.fn()
    renderWithProviders(
      <FileImportDialog initialJob={partial} onClose={vi.fn()} onImported={imported} />,
    )
    await waitFor(() => expect(imported).toHaveBeenCalledTimes(1))
    expect(screen.getByText(/1 imported/)).toBeInTheDocument()
  })
  it('downloads only chosen EPUBs separately, issuing fresh tickets per click', async () => {
    const user = userEvent.setup()
    renderWithProviders(<BookFilesPanel bookId="book-1" />)
    await user.click(await screen.findByRole('button', { name: 'Download all' }))
    await user.click(screen.getByLabelText('Select Volume 2'))
    await user.click(screen.getByLabelText('Separate EPUBs'))
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    const dialog = screen.getAllByRole('dialog').at(-1)!
    expect(within(dialog).queryByText('Volume 2')).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Download' }))
    await waitFor(() => expect(bookFilesApi.downloads).toHaveBeenCalledWith(['file-0'], undefined))
    expect(startFileDownload).toHaveBeenCalledTimes(1)
    await user.click(within(dialog).getByRole('button', { name: 'Download' }))
    expect(bookFilesApi.downloads).toHaveBeenCalledTimes(2)
  })

  it('keeps public file browsing read-only and includes snapshot authorization', async () => {
    const user = userEvent.setup()
    renderWithProviders(<BookFilesDialog snapshotId="public-1" onClose={vi.fn()} />)
    await user.click(await screen.findByRole('button', { name: 'Download' }))
    await user.click(screen.getByLabelText('Select Volume 2'))
    await user.click(screen.getByLabelText('Separate EPUBs'))
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.click(
      within(screen.getAllByRole('dialog').at(-1)!).getByRole('button', { name: 'Download' }),
    )
    expect(bookFilesApi.downloads).toHaveBeenCalledWith(['file-0'], 'public-1')
    expect(screen.queryByRole('button', { name: 'Add EPUB / ZIP' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Share Volume 1')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Rename Volume 1' })).not.toBeInTheDocument()
  })

  it('shares an explicit set and reorders the full file list', async () => {
    const user = userEvent.setup()
    renderWithProviders(<BookFilesPanel bookId="book-1" />)
    await user.click(await screen.findByRole('button', { name: 'Manage' }))
    await user.click(await screen.findByLabelText('Share Volume 1'))
    await waitFor(() => expect(bookFilesApi.share).toHaveBeenCalledWith('book-1', ['file-0']))
    await user.click(screen.getByRole('button', { name: 'Move Volume 1 down' }))
    await waitFor(() =>
      expect(bookFilesApi.reorder).toHaveBeenCalledWith('book-1', ['file-1', 'file-0']),
    )
  })

  it('requires confirmation for trash and explains private restoration', async () => {
    const user = userEvent.setup()
    renderWithProviders(<BookFilesPanel bookId="book-1" />)
    await user.click(await screen.findByRole('button', { name: 'Manage' }))
    await user.click(await screen.findByRole('button', { name: 'Remove Volume 1' }))
    expect(bookFilesApi.remove).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Move to trash' }))
    await waitFor(() => expect(bookFilesApi.remove).toHaveBeenCalledWith('book-1', 'file-0'))
    await user.click(screen.getByRole('button', { name: 'Trash (0)' }))
    expect(screen.getByText(/restored EPUBs are private/i)).toBeInTheDocument()
  })

  it('exports current filters across pages and sends only selected file IDs with manifest', async () => {
    const user = userEvent.setup()
    vi.mocked(bookFilesApi.candidates).mockResolvedValue([
      { bookId: 'book-1', bookTitle: 'Novel', contentType: 'Novel', files },
    ])
    renderWithProviders(<FileExportDialog query="genre:Fantasy" onClose={vi.fn()} />)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Export selected (2)' })).toBeEnabled(),
    )
    expect(bookFilesApi.candidates).toHaveBeenCalledWith('genre:Fantasy')
    await user.click(screen.getByRole('button', { name: 'Choose files' }))
    await user.click(screen.getByLabelText('Export file Volume 2'))
    await user.click(screen.getByRole('button', { name: 'Export selected (1)' }))
    expect(bookFilesApi.export).toHaveBeenCalledWith(['file-0'], undefined, true)
    await user.click(
      await screen.findByRole('button', { name: 'Discard archive and choose again' }),
    )
    expect(bookFilesApi.cancel).toHaveBeenCalledWith('job-1')
  })

  it('requires an existing target for an unmatched library EPUB and preserves edited title/order', async () => {
    const user = userEvent.setup()
    const importJob: FileJob = {
      ...ready,
      kind: 'LibraryImport',
      entries: [
        {
          id: 'entry-1',
          bookId: null,
          bookTitle: 'Missing source',
          contentType: 'Novel',
          title: 'EPUB title',
          originalFileName: 'volume.epub',
          sortOrder: 0,
          sizeBytes: 1024,
          error: null,
          isDuplicate: false,
        },
      ],
    }
    vi.mocked(bookFilesApi.job).mockResolvedValue(importJob)
    vi.mocked(bookFilesApi.confirm).mockResolvedValue({ ...importJob, status: 'CommitQueued' })
    vi.mocked(api.getBooks).mockResolvedValue({
      skip: 0,
      take: 50,
      total: 1,
      data: [
        { id: 'existing-book', primaryTitle: 'Existing target', contentType: 'Novel' } as never,
      ],
    })
    renderWithProviders(
      <FileImportDialog initialJob={importJob} onClose={vi.fn()} onImported={vi.fn()} />,
    )
    expect(await screen.findByRole('button', { name: 'Import selected (1)' })).toBeDisabled()
    await user.selectOptions(
      await screen.findByLabelText('Target book for volume.epub'),
      'existing-book',
    )
    const title = screen.getByLabelText('Title')
    await user.clear(title)
    await user.type(title, 'Edited volume')
    const order = screen.getByLabelText('Order')
    await user.clear(order)
    await user.type(order, '4')
    await user.click(screen.getByRole('button', { name: 'Import selected (1)' }))
    expect(bookFilesApi.confirm).toHaveBeenCalledWith('job-1', [
      { entryId: 'entry-1', bookId: 'existing-book', title: 'Edited volume', sortOrder: 3 },
    ])
  })
})
