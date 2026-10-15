import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { api } from '@/api/client'
import type { BookImportFinalizeResult, BookImportSessionDto } from '@/api/types'
import { toast } from 'sonner'
import { renderWithProviders } from '@/test/render'
import { getImportSessionStats } from './bookImportStats'
import { ImportBooksDialog } from './ImportBooksDialog'

vi.mock('@/api/client', () => ({
  api: {
    createBookImportSession: vi.fn(),
    createFullBookImportSession: vi.fn(),
    downloadBookImportTemplate: vi.fn(),
    updateBookImportRow: vi.fn(),
    deleteBookImportRow: vi.fn(),
    deleteInvalidBookImportRows: vi.fn(),
    finalizeBookImport: vi.fn(),
    cancelBookImport: vi.fn(),
  },
}))

vi.mock('react-virtuoso', () => ({
  Virtuoso: ({
    data,
    itemContent,
  }: {
    data: unknown[]
    itemContent: (index: number, item: unknown) => ReactNode
  }) => (
    <div>
      {data.map((item, index) => (
        <div key={(item as { rowId: string }).rowId}>{itemContent(index, item)}</div>
      ))}
    </div>
  ),
}))

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}))

describe('ImportBooksDialog', () => {
  function uploadCsv(container: HTMLElement) {
    fireEvent.change(container.querySelector('input[type="file"]')!, {
      target: {
        files: [new File(['primaryTitle,contentType,status'], 'books.csv', { type: 'text/csv' })],
      },
    })
  }

  it('calculates import session stats without dividing empty sessions by zero', () => {
    const stats = getImportSessionStats({
      ...importSessionWithFieldErrors,
      invalidRows: 0,
      rows: [],
      totalRows: 0,
      validRows: 0,
    })

    expect(stats.invalidRows).toEqual([])
    expect(stats.invalidRowsCount).toBe(0)
    expect(stats.progressPercent).toBe(0)
  })

  it('creates an import session when a csv file is dropped into the dialog', async () => {
    vi.mocked(api.createBookImportSession).mockResolvedValue(importSessionWithFieldErrors)

    renderWithProviders(<ImportBooksDialog open onClose={vi.fn()} onImported={vi.fn()} />)

    expect(screen.getByText('Drop a CSV file here')).toBeInTheDocument()
    fireEvent.drop(screen.getByTestId('import-dropzone'), {
      dataTransfer: {
        files: [new File(['primaryTitle,contentType,status'], 'books.csv', { type: 'text/csv' })],
      },
    })

    await waitFor(() => {
      expect(api.createBookImportSession).toHaveBeenCalledTimes(1)
    })
  })

  it('rejects dropped files that are not csv', () => {
    renderWithProviders(<ImportBooksDialog open onClose={vi.fn()} onImported={vi.fn()} />)

    fireEvent.drop(screen.getByTestId('import-dropzone'), {
      dataTransfer: {
        files: [new File(['not,csv'], 'books.txt', { type: 'text/plain' })],
      },
    })

    expect(api.createBookImportSession).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('Choose a .csv file.')
  })

  it('lists the CSV columns with the required ones marked', () => {
    renderWithProviders(<ImportBooksDialog open onClose={vi.fn()} onImported={vi.fn()} />)

    expect(screen.getByText('primaryTitle')).toHaveTextContent('primaryTitle (required)')
    expect(screen.getByText('authorName')).not.toHaveTextContent('required')
    expect(screen.getByText(/50,000 rows and 10 MB/)).toBeInTheDocument()
  })

  it('creates a full import session from a zip backup', async () => {
    vi.mocked(api.createFullBookImportSession).mockResolvedValue(importSessionWithFieldErrors)

    renderWithProviders(
      <ImportBooksDialog mode="full" open onClose={vi.fn()} onImported={vi.fn()} />,
    )

    expect(screen.getByText('Drop a backup ZIP here')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /download template/i })).not.toBeInTheDocument()
    const file = new File(['zip-content'], 'books-full-export.zip', { type: 'application/zip' })
    fireEvent.drop(screen.getByTestId('import-dropzone'), { dataTransfer: { files: [file] } })

    await waitFor(() => {
      expect(api.createFullBookImportSession).toHaveBeenCalledWith(file)
    })
  })

  it('switches the source between CSV, full backup and the EPUB archive import', () => {
    const onChooseEpubArchive = vi.fn()
    renderWithProviders(
      <ImportBooksDialog
        open
        onChooseEpubArchive={onChooseEpubArchive}
        onClose={vi.fn()}
        onImported={vi.fn()}
      />,
    )

    const source = screen.getByRole('group', { name: 'Import source' })
    expect(within(source).getByRole('button', { name: 'CSV' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    fireEvent.click(within(source).getByRole('button', { name: 'Full backup (ZIP)' }))
    expect(screen.getByText('Drop a backup ZIP here')).toBeInTheDocument()

    fireEvent.click(within(source).getByRole('button', { name: 'EPUB archive' }))
    expect(onChooseEpubArchive).toHaveBeenCalledTimes(1)
  })

  it('asks for confirmation before dismissing an active import session', async () => {
    vi.mocked(api.createBookImportSession).mockResolvedValue(importSessionWithFieldErrors)

    const onClose = vi.fn()
    const { container } = renderWithProviders(
      <ImportBooksDialog open onClose={onClose} onImported={vi.fn()} />,
    )

    uploadCsv(container)

    await screen.findByText('Line 2')
    fireEvent.click(screen.getByRole('button', { name: /^close$/i }))

    expect(screen.getByRole('alertdialog', { name: /cancel import\?/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /keep editing/i })).toHaveFocus()
    expect(api.cancelBookImport).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: /keep editing/i }))

    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('cancels the import session after confirmation', async () => {
    vi.mocked(api.createBookImportSession).mockResolvedValue(importSessionWithFieldErrors)
    vi.mocked(api.cancelBookImport).mockResolvedValue(undefined)

    const onClose = vi.fn()
    const { container } = renderWithProviders(
      <ImportBooksDialog open onClose={onClose} onImported={vi.fn()} />,
    )

    uploadCsv(container)

    await screen.findByText('Line 2')
    fireEvent.click(screen.getByRole('button', { name: /^cancel import$/i }))
    fireEvent.click(screen.getByRole('button', { name: /discard draft/i }))

    await waitFor(() => {
      expect(api.cancelBookImport).toHaveBeenCalledWith('session-1')
      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })

  it('downloads the CSV template from the import dialog', async () => {
    const createObjectUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:template')
    const revokeObjectUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined)
    vi.mocked(api.downloadBookImportTemplate).mockResolvedValue(
      new Blob(['primaryTitle,contentType,status\n'], { type: 'text/csv' }),
    )

    renderWithProviders(<ImportBooksDialog open onClose={vi.fn()} onImported={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: /download template/i }))

    await waitFor(() => {
      expect(api.downloadBookImportTemplate).toHaveBeenCalledTimes(1)
      expect(clickSpy).toHaveBeenCalledTimes(1)
      expect(createObjectUrl).toHaveBeenCalledTimes(1)
      expect(revokeObjectUrl).toHaveBeenCalledWith('blob:template')
    })

    createObjectUrl.mockRestore()
    revokeObjectUrl.mockRestore()
    clickSpy.mockRestore()
  })

  it('keeps row actions visible for long invalid row titles', async () => {
    vi.mocked(api.createBookImportSession).mockResolvedValue(importSessionWithLongTitle)

    const { container } = renderWithProviders(
      <ImportBooksDialog open onClose={vi.fn()} onImported={vi.fn()} />,
    )

    uploadCsv(container)

    const title = await screen.findByTitle(importSessionWithLongTitle.rows[0]!.primaryTitle!)
    expect(title).toHaveClass('truncate')
    expect(screen.getByRole('button', { name: 'Fix' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove line 2' })).toBeInTheDocument()
  })

  it('mounts import row form controls only after opening a row', async () => {
    vi.mocked(api.createBookImportSession).mockResolvedValue(importSessionWithFieldErrors)

    const { container } = renderWithProviders(
      <ImportBooksDialog open onClose={vi.fn()} onImported={vi.fn()} />,
    )

    uploadCsv(container)

    expect(await screen.findByRole('button', { name: 'Fix' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    expect(screen.queryByLabelText(/^Title/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Fix' }))

    expect(screen.getByRole('button', { name: /collapse/i })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    expect(screen.getByLabelText(/^Title/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /save row/i })).toBeEnabled()
  })

  it('shows the summary and splits rows into Needs fixing, Ready and All rows', async () => {
    vi.mocked(api.createBookImportSession).mockResolvedValue(importSessionWithMixedRows)

    const { container } = renderWithProviders(
      <ImportBooksDialog open onClose={vi.fn()} onImported={vi.fn()} />,
    )

    uploadCsv(container)

    expect(await screen.findByRole('progressbar')).toHaveAccessibleName('1 of 2 rows ready')
    expect(screen.getByRole('tab', { name: /needs fixing 1/i })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(screen.getByText('Line 3')).toBeInTheDocument()
    expect(screen.queryByText('Line 2')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: /ready 1/i }))
    expect(screen.getByText('Line 2')).toBeInTheDocument()
    expect(screen.getByText('Novel · Reading')).toBeInTheDocument()
    expect(screen.queryByText('Line 3')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: /all rows 2/i }))
    expect(screen.getByText('Line 2')).toBeInTheDocument()
    expect(screen.getByText('Line 3')).toBeInTheDocument()
  })

  it('fixes a misspelt status in every row of an issue group', async () => {
    const statusError = 'Status is required and must exist. Allowed values: Reading, Completed.'
    const misspelt = {
      ...importSessionWithFieldErrors.rows[0]!,
      contentType: 'Novel',
      status: 'Readin',
      errors: [statusError],
      fieldErrors: { status: [statusError] },
    }
    const session: BookImportSessionDto = {
      ...importSessionWithFieldErrors,
      totalRows: 2,
      invalidRows: 2,
      rows: [misspelt, { ...misspelt, rowId: 'row-2', lineNumber: 3, primaryTitle: 'Other' }],
    }
    vi.mocked(api.createBookImportSession).mockResolvedValue(session)
    vi.mocked(api.updateBookImportRow).mockResolvedValue(importSessionAfterDiscardInvalid)

    const { container } = renderWithProviders(
      <ImportBooksDialog open onClose={vi.fn()} onImported={vi.fn()} />,
    )

    uploadCsv(container)

    expect(await screen.findByText(/2 rows · Status “Readin” does not exist/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Replace with “Reading”' }))

    await waitFor(() => expect(api.updateBookImportRow).toHaveBeenCalledTimes(2))
    expect(api.updateBookImportRow).toHaveBeenCalledWith(
      'session-1',
      'row-1',
      expect.objectContaining({ status: 'Reading', primaryTitle: 'Book' }),
    )
    expect(api.updateBookImportRow).toHaveBeenCalledWith(
      'session-1',
      'row-2',
      expect.objectContaining({ status: 'Reading', primaryTitle: 'Other' }),
    )
  })

  it('marks import row fields with field errors and links the message to the input', async () => {
    vi.mocked(api.createBookImportSession).mockResolvedValue(importSessionWithFieldErrors)

    const { container } = renderWithProviders(
      <ImportBooksDialog open onClose={vi.fn()} onImported={vi.fn()} />,
    )

    uploadCsv(container)

    fireEvent.click(await screen.findByRole('button', { name: 'Fix' }))

    const typeInput = screen.getByLabelText(/^Type/)
    const titleInput = screen.getByLabelText(/^Title/)

    expect(typeInput).toHaveAttribute('aria-invalid', 'true')
    expect(typeInput).toHaveAccessibleDescription('Content type is required and must exist.')
    expect(titleInput).not.toHaveAttribute('aria-invalid')
  })

  it('keeps row genres when saving an edited import row', async () => {
    const sessionWithGenres: BookImportSessionDto = {
      ...importSessionWithFieldErrors,
      rows: [
        { ...importSessionWithFieldErrors.rows[0]!, genres: 'Fantasy; Action', tags: 'favorite' },
      ],
    }
    vi.mocked(api.createBookImportSession).mockResolvedValue(sessionWithGenres)
    vi.mocked(api.updateBookImportRow).mockResolvedValue(sessionWithGenres)

    const { container } = renderWithProviders(
      <ImportBooksDialog open onClose={vi.fn()} onImported={vi.fn()} />,
    )

    uploadCsv(container)

    fireEvent.click(await screen.findByRole('button', { name: 'Fix' }))
    expect(screen.getByLabelText(/^Genres/)).toHaveValue('Fantasy; Action')

    fireEvent.change(screen.getByLabelText(/^Type/), { target: { value: 'Novel' } })
    fireEvent.click(screen.getByRole('button', { name: /save row/i }))

    await waitFor(() =>
      expect(api.updateBookImportRow).toHaveBeenCalledWith(
        'session-1',
        'row-1',
        expect.objectContaining({
          contentType: 'Novel',
          genres: 'Fantasy; Action',
          tags: 'favorite',
        }),
      ),
    )
  })

  it('shows type and status suggestions for invalid import rows', async () => {
    vi.mocked(api.createBookImportSession).mockResolvedValue(importSessionWithFieldErrors)

    const { container } = renderWithProviders(
      <ImportBooksDialog open onClose={vi.fn()} onImported={vi.fn()} />,
    )

    uploadCsv(container)

    fireEvent.click(await screen.findByRole('button', { name: 'Fix' }))

    const typeInput = await screen.findByRole('combobox', { name: /^Type/ })
    const statusInput = screen.getByRole('combobox', { name: /^Status/ })

    fireEvent.focus(typeInput)
    expect(await screen.findByRole('listbox')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Novel' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Manga' })).toBeInTheDocument()

    fireEvent.focus(statusInput)
    expect(screen.getByRole('option', { name: 'Reading' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Completed' })).toBeInTheDocument()
  })

  it('drops all invalid rows and enables finalize', async () => {
    vi.mocked(api.createBookImportSession).mockResolvedValue(importSessionWithMixedRows)
    vi.mocked(api.deleteInvalidBookImportRows).mockResolvedValue(importSessionAfterDiscardInvalid)

    const { container } = renderWithProviders(
      <ImportBooksDialog open onClose={vi.fn()} onImported={vi.fn()} />,
    )

    uploadCsv(container)

    const dropInvalidButton = await screen.findByRole('button', { name: 'Drop 1 invalid row' })
    const cancelButton = screen.getByRole('button', { name: /^cancel import$/i })
    const finalizeButton = screen.getByRole('button', { name: /finalize import/i })

    expect(finalizeButton).toBeDisabled()
    expect(
      cancelButton.compareDocumentPosition(dropInvalidButton) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(
      dropInvalidButton.compareDocumentPosition(finalizeButton) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()

    fireEvent.click(dropInvalidButton)

    await waitFor(() => {
      expect(api.deleteInvalidBookImportRows).toHaveBeenCalledWith('session-mixed')
    })

    expect(screen.queryByRole('button', { name: /invalid row/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /finalize import/i })).toBeEnabled()
    expect(screen.getByText('Every row is ready')).toBeInTheDocument()
  })

  it('shows imported titles with type and list-formatted progress after finalizing', async () => {
    vi.mocked(api.createBookImportSession).mockResolvedValue(importSessionAfterDiscardInvalid)
    vi.mocked(api.finalizeBookImport).mockResolvedValue(importFinalizeFullSuccess)
    const onClose = vi.fn()
    const onImported = vi.fn()

    const { container } = renderWithProviders(
      <ImportBooksDialog open onClose={onClose} onImported={onImported} />,
    )

    uploadCsv(container)

    fireEvent.click(await screen.findByRole('button', { name: /finalize import/i }))

    expect(await screen.findByText('Import finished.')).toBeInTheDocument()
    expect(screen.getByText('Imported')).toBeInTheDocument()
    expect(screen.getByText('Skipped')).toBeInTheDocument()
    expect(screen.getByText('The Novel')).toBeInTheDocument()
    expect(screen.getByText('Novel')).toBeInTheDocument()
    expect(screen.getByText('Progress: 49 / 200')).toBeInTheDocument()
    expect(onImported).toHaveBeenCalledWith(importFinalizeFullSuccess)
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: /go to library/i }))

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('goes back to the upload step to import another file', async () => {
    vi.mocked(api.createBookImportSession).mockResolvedValue(importSessionAfterDiscardInvalid)
    vi.mocked(api.finalizeBookImport).mockResolvedValue(importFinalizeFullSuccess)

    const { container } = renderWithProviders(
      <ImportBooksDialog open onClose={vi.fn()} onImported={vi.fn()} />,
    )

    uploadCsv(container)
    fireEvent.click(await screen.findByRole('button', { name: /finalize import/i }))
    fireEvent.click(await screen.findByRole('button', { name: /import another file/i }))

    expect(screen.getByText('Drop a CSV file here')).toBeInTheDocument()
  })

  it('keeps the imported books summary table scrollable for large imports', async () => {
    vi.mocked(api.createBookImportSession).mockResolvedValue(importSessionAfterDiscardInvalid)
    vi.mocked(api.finalizeBookImport).mockResolvedValue({
      ...importFinalizeFullSuccess,
      importedCount: 1_000,
      importedBooks: Array.from({ length: 30 }, (_unused, index) => ({
        ...importFinalizeFullSuccess.importedBooks[0]!,
        primaryTitle: `Imported Book ${index + 1}`,
      })),
    })

    const { container } = renderWithProviders(
      <ImportBooksDialog open onClose={vi.fn()} onImported={vi.fn()} />,
    )

    uploadCsv(container)

    fireEvent.click(await screen.findByRole('button', { name: /finalize import/i }))

    expect(await screen.findByText('1,000')).toBeInTheDocument()
    expect(screen.getByText('Imported Book 30')).toBeInTheDocument()
    expect(screen.getByTestId('import-result-scroll')).toHaveClass('overflow-auto')
  })

  it('keeps partial finalize messages visible on the success screen', async () => {
    vi.mocked(api.createBookImportSession).mockResolvedValue(importSessionAfterDiscardInvalid)
    vi.mocked(api.finalizeBookImport).mockResolvedValue(importFinalizePartialSuccess)

    const { container } = renderWithProviders(
      <ImportBooksDialog open onClose={vi.fn()} onImported={vi.fn()} />,
    )

    uploadCsv(container)

    fireEvent.click(await screen.findByRole('button', { name: /finalize import/i }))

    expect(
      await screen.findByText(
        "Line 3: title 'Existing Book' already exists for content type 'Novel'.",
      ),
    ).toBeInTheDocument()
    expect(screen.getByText('Skipped')).toBeInTheDocument()
  })

  it('shows an empty imported list when finalize imports zero books', async () => {
    vi.mocked(api.createBookImportSession).mockResolvedValue(importSessionAfterDiscardInvalid)
    vi.mocked(api.finalizeBookImport).mockResolvedValue(importFinalizeEmptySuccess)

    const { container } = renderWithProviders(
      <ImportBooksDialog open onClose={vi.fn()} onImported={vi.fn()} />,
    )

    uploadCsv(container)

    fireEvent.click(await screen.findByRole('button', { name: /finalize import/i }))

    expect(await screen.findByText('No books were imported.')).toBeInTheDocument()
    expect(screen.getByText('Skipped')).toBeInTheDocument()
  })
})

const importSessionWithFieldErrors: BookImportSessionDto = {
  sessionId: 'session-1',
  fileName: 'books.csv',
  totalRows: 1,
  validRows: 0,
  invalidRows: 1,
  canFinalize: false,
  availableContentTypes: ['Novel', 'Manga'],
  availableStatuses: ['Reading', 'Completed'],
  rows: [
    {
      rowId: 'row-1',
      lineNumber: 2,
      isValid: false,
      primaryTitle: 'Book',
      authorName: null,
      contentType: 'Wrong',
      status: 'Reading',
      tags: null,
      totalChapters: null,
      currentChapterNumber: null,
      currentChapterLabel: null,
      rating: null,
      priority: null,
      description: null,
      notes: null,
      rawImportedLine: null,
      errors: ['Content type is required and must exist.'],
      fieldErrors: {
        contentType: ['Content type is required and must exist.'],
      },
    },
  ],
}

const importSessionWithLongTitle: BookImportSessionDto = {
  ...importSessionWithFieldErrors,
  rows: [
    {
      ...importSessionWithFieldErrors.rows[0]!,
      primaryTitle:
        'A Very Long Imported Book Title That Should Stay Inside Its Header Without Pushing The Action Buttons Below Or Off The Right Edge',
    },
  ],
}

const importSessionWithMixedRows: BookImportSessionDto = {
  sessionId: 'session-mixed',
  fileName: 'books.csv',
  totalRows: 2,
  validRows: 1,
  invalidRows: 1,
  canFinalize: false,
  availableContentTypes: ['Novel', 'Manga'],
  availableStatuses: ['Reading', 'Completed'],
  rows: [
    {
      rowId: 'row-valid',
      lineNumber: 2,
      isValid: true,
      primaryTitle: 'Valid book',
      authorName: null,
      contentType: 'Novel',
      status: 'Reading',
      tags: null,
      totalChapters: null,
      currentChapterNumber: null,
      currentChapterLabel: null,
      rating: null,
      priority: null,
      description: null,
      notes: null,
      rawImportedLine: null,
      errors: [],
      fieldErrors: {},
    },
    {
      ...importSessionWithFieldErrors.rows[0]!,
      rowId: 'row-invalid',
      lineNumber: 3,
    },
  ],
}

const importSessionAfterDiscardInvalid: BookImportSessionDto = {
  ...importSessionWithMixedRows,
  totalRows: 1,
  validRows: 1,
  invalidRows: 0,
  canFinalize: true,
  rows: [importSessionWithMixedRows.rows[0]!],
}

const importFinalizeFullSuccess: BookImportFinalizeResult = {
  importedCount: 1,
  skippedCount: 0,
  importedBooks: [
    {
      primaryTitle: 'The Novel',
      contentType: 'Novel',
      status: 'Reading',
      currentChapterNumber: 49,
      currentChapterLabel: 'Progress: 49',
      totalChapters: 200,
    },
  ],
  errors: [],
}

const importFinalizePartialSuccess: BookImportFinalizeResult = {
  importedCount: 1,
  skippedCount: 1,
  importedBooks: importFinalizeFullSuccess.importedBooks,
  errors: ["Line 3: title 'Existing Book' already exists for content type 'Novel'."],
}

const importFinalizeEmptySuccess: BookImportFinalizeResult = {
  importedCount: 0,
  skippedCount: 1,
  importedBooks: [],
  errors: ["Line 2: title 'Existing Book' already exists for content type 'Novel'."],
}
