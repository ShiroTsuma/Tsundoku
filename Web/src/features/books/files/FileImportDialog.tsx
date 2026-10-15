import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { api } from '@/api/client'
import {
  bookFilesApi,
  formatFileSize,
  type FileJob,
  type ImportEntry,
  type ImportSelection,
} from '@/api/bookFiles'
import { useDebouncedValue } from '@/lib/useDebouncedValue'
import { FileJobProgress, FileModal } from './FileDialogs'
import { fileError, isJobWorking, useFileJob } from './fileJobs'
import { FileContents } from './FileContents'
import { buttonStyles } from '@/components/ui/buttonStyles'
import { fieldClass } from '@/components/ui/fieldStyles'

export function FileImportDialog({
  bookId,
  initialJob,
  onClose,
  onImported,
}: {
  bookId?: string | undefined
  initialJob?: FileJob | undefined
  onClose: () => void
  onImported: () => void
}) {
  const client = useQueryClient()
  const [initial, setInitial] = useState<FileJob | null>(initialJob ?? null)
  const jobQuery = useFileJob(initial?.id, initial)
  const job = jobQuery.data ?? initial
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState('')
  const [dragging, setDragging] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [drafts, setDrafts] = useState<Record<string, ImportSelection>>({})
  const [visible, setVisible] = useState(50)
  const [search, setSearch] = useState('')
  const [knownBooks, setKnownBooks] = useState<Record<string, string>>({})
  const debouncedSearch = useDebouncedValue(search, 250)
  const input = useRef<HTMLInputElement>(null)
  const abort = useRef<AbortController | null>(null)
  const previewId = useRef<string | null>(null)
  const completedId = useRef<string | null>(null)
  const limits = useQuery({ queryKey: ['epub-limits'], queryFn: bookFilesApi.limits })
  const resumable = useQuery({
    queryKey: ['epub-jobs'],
    queryFn: bookFilesApi.jobs,
    enabled: !job,
    retry: false,
  })
  const targets = useQuery({
    queryKey: ['epub-targets', debouncedSearch],
    queryFn: () => api.getBooks({ query: debouncedSearch, take: 50 }),
    enabled: !bookId && job?.status === 'Ready',
    retry: false,
  })
  const [knownBooksSource, setKnownBooksSource] = useState(targets.data)
  if (knownBooksSource !== targets.data) {
    setKnownBooksSource(targets.data)
    const loaded = targets.data
    if (loaded)
      setKnownBooks((current) => ({
        ...current,
        ...Object.fromEntries(
          loaded.data.map((b) => [b.id, `${b.primaryTitle} · ${b.contentType}`]),
        ),
      }))
  }
  useEffect(() => () => abort.current?.abort(), [])
  useEffect(() => {
    if (job?.status !== 'Ready' || job.entries.length === 0 || previewId.current === job.id) return
    previewId.current = job.id
    setSelected(new Set(job.entries.filter((e) => !e.error && !e.isDuplicate).map((e) => e.id)))
    setDrafts(Object.fromEntries(job.entries.map((e) => [e.id, initialDraft(e)])))
  }, [job])
  useEffect(() => {
    if (
      !job ||
      !['Completed', 'Failed', 'Cancelled'].includes(job.status) ||
      completedId.current === job.id
    )
      return
    completedId.current = job.id
    void client.invalidateQueries({ queryKey: ['book-files'] })
    void client.invalidateQueries({ queryKey: ['epub-jobs'] })
    onImported()
  }, [client, job, onImported])

  async function upload(files: File[]) {
    if (busy || job || files.length === 0) return
    setError('')
    const max = bookId ? limits.data?.maxUploadBytes : limits.data?.maxLibraryArchiveBytes
    if (
      (!bookId && (files.length !== 1 || !files[0]?.name.toLowerCase().endsWith('.zip'))) ||
      files.some((f) => !/\.(epub|zip)$/i.test(f.name))
    ) {
      setError(
        bookId ? 'Choose EPUB or ZIP files.' : 'Choose one ZIP made by the EPUB files export.',
      )
      return
    }
    if (max && files.reduce((sum, f) => sum + f.size, 0) > max) {
      setError(`Upload limit: ${formatFileSize(max)}.`)
      return
    }
    if (
      bookId &&
      limits.data &&
      (files.length > limits.data.maxFilesPerImport ||
        files.some((f) => /\.epub$/i.test(f.name) && f.size > limits.data.maxFileBytes))
    ) {
      setError(
        `Choose up to ${limits.data.maxFilesPerImport} files; each EPUB must be at most ${formatFileSize(limits.data.maxFileBytes)}.`,
      )
      return
    }
    abort.current = new AbortController()
    setBusy(true)
    setProgress(0)
    try {
      const next = await bookFilesApi.upload(bookId, files, setProgress, abort.current.signal)
      setInitial(next)
      void client.invalidateQueries({ queryKey: ['epub-jobs'] })
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) setError(fileError(e))
    } finally {
      setBusy(false)
    }
  }
  async function close() {
    abort.current?.abort()
    if (job && !['Completed', 'Failed', 'Cancelled'].includes(job.status)) {
      try {
        await bookFilesApi.cancel(job.id)
        await client.invalidateQueries({ queryKey: ['epub-jobs'] })
        onImported()
      } catch (e) {
        setError(fileError(e))
        return
      }
    }
    onClose()
  }
  async function confirm() {
    if (!job) return
    setBusy(true)
    setError('')
    try {
      const next = await bookFilesApi.confirm(
        job.id,
        Array.from(selected).flatMap((id) => {
          const draft = drafts[id]
          return draft ? [draft] : []
        }),
      )
      client.setQueryData(['epub-job', job.id], next)
    } catch (e) {
      setError(fileError(e))
    } finally {
      setBusy(false)
    }
  }
  function updateDraft(entry: ImportEntry, patch: Partial<ImportSelection>) {
    setDrafts((current) => ({
      ...current,
      [entry.id]: { ...(current[entry.id] ?? initialDraft(entry)), ...patch },
    }))
  }
  const selectionInvalid =
    selected.size === 0 ||
    Array.from(selected).some((id) => {
      const draft = drafts[id]
      return (
        !draft?.bookId ||
        !draft.title.trim() ||
        draft.title.trim().length > 250 ||
        !Number.isInteger(draft.sortOrder) ||
        draft.sortOrder < 0 ||
        draft.sortOrder > 1_000_000
      )
    })
  const resume = resumable.data?.find(
    (j) =>
      j.kind === (bookId ? 'BookImport' : 'LibraryImport') &&
      j.bookId === (bookId ?? null) &&
      !['Completed', 'Failed', 'Cancelled'].includes(j.status),
  )
  return (
    <FileModal
      title={bookId ? 'Add EPUB / ZIP' : 'Import EPUB archive'}
      onClose={() => void close()}
      footer={
        <>
          <button
            type="button"
            className={buttonStyles({ size: 'sm' })}
            onClick={() => void close()}
          >
            {busy || isJobWorking(job)
              ? 'Cancel operation'
              : job?.status === 'Ready'
                ? 'Cancel import'
                : 'Close'}
          </button>
          {job?.status === 'Ready' && (
            <button
              type="button"
              className={buttonStyles({ variant: 'primary', size: 'sm' })}
              disabled={busy || selectionInvalid}
              onClick={() => void confirm()}
            >
              Import selected ({selected.size})
            </button>
          )}
        </>
      }
    >
      <p className="file-hint">
        {bookId
          ? 'EPUBs in ZIP subfolders become separate files of this book. Review them before saving.'
          : 'Restore EPUBs and their order to existing books. Import book data first if needed; EPUB files are restored as private.'}
      </p>
      {error && (
        <p className="file-error" role="alert">
          {error}
        </p>
      )}
      {jobQuery.isError && (
        <p className="file-error" role="alert">
          {fileError(jobQuery.error)}{' '}
          <button className={buttonStyles({ size: 'sm' })} onClick={() => void jobQuery.refetch()}>
            Retry status
          </button>
        </p>
      )}
      {!job && (
        <>
          {resume && (
            <button
              className={buttonStyles({ size: 'sm' })}
              type="button"
              onClick={() => {
                setInitial(resume)
                void client.invalidateQueries({ queryKey: ['epub-job', resume.id] })
              }}
            >
              Resume existing import
            </button>
          )}
          <div
            className={`file-dropzone ${dragging ? 'file-dropzone--active' : ''}`}
            onDragOver={(e) => {
              e.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragging(false)
              void upload(Array.from(e.dataTransfer.files))
            }}
          >
            <input
              ref={input}
              type="file"
              className="sr-only"
              aria-label="Choose EPUB or ZIP files"
              accept={bookId ? '.epub,.zip' : '.zip'}
              multiple={Boolean(bookId)}
              disabled={busy || Boolean(resume)}
              onChange={(e) => {
                void upload(Array.from(e.target.files ?? []))
                e.target.value = ''
              }}
            />
            <button
              className={buttonStyles({ variant: 'primary', size: 'sm' })}
              type="button"
              disabled={busy || Boolean(resume) || limits.isPending || limits.isError}
              onClick={() => input.current?.click()}
            >
              {busy
                ? `Uploading ${progress}%`
                : bookId
                  ? 'Choose EPUB / ZIP'
                  : 'Choose EPUB archive'}
            </button>
            <p className="file-hint">
              {maxLabel(bookId, limits.data)} Drag files here or use file selection.
            </p>
            {busy && <progress aria-label="Upload progress" value={progress} max={100} />}
            {limits.isError && (
              <p role="alert">
                Could not load upload limits.{' '}
                <button
                  onClick={() => void limits.refetch()}
                  className={buttonStyles({ size: 'sm' })}
                >
                  Retry
                </button>
              </p>
            )}
          </div>
        </>
      )}
      {job && <FileJobProgress job={job} />}
      {job?.warnings.map((warning, index) => (
        <p className="file-hint" key={index}>
          {warning}
        </p>
      ))}
      {job?.status === 'Ready' && (
        <>
          <div className="file-selection-bar">
            <strong>{selected.size} selected</strong>
            <button
              className={buttonStyles({ size: 'sm' })}
              type="button"
              onClick={() =>
                setSelected(
                  new Set(job.entries.filter((e) => !e.error && !e.isDuplicate).map((e) => e.id)),
                )
              }
            >
              Select valid files
            </button>
            <button
              className={buttonStyles({ variant: 'ghost', size: 'sm' })}
              type="button"
              onClick={() => setSelected(new Set())}
            >
              Clear selection
            </button>
          </div>
          {!bookId && (
            <label className="file-hint">
              Find target books
              <input
                className={fieldClass}
                value={search}
                placeholder="Search your library for an existing book"
                onChange={(e) => setSearch(e.target.value)}
              />
              {targets.isError && (
                <span role="alert">
                  Could not load books.{' '}
                  <button
                    className={buttonStyles({ size: 'sm' })}
                    onClick={() => void targets.refetch()}
                  >
                    Retry
                  </button>
                </span>
              )}
            </label>
          )}
          <div className="file-import-list">
            {job.entries.slice(0, visible).map((entry) => {
              const targetBookId = selectedTargetBookId(drafts[entry.id], entry.bookId)
              return (
                <div className="file-import-row" key={entry.id}>
                  <label className="file-check">
                    <input
                      type="checkbox"
                      disabled={Boolean(entry.error)}
                      checked={selected.has(entry.id)}
                      aria-label={`Import ${entry.originalFileName}`}
                      onChange={(e) =>
                        setSelected((current) => {
                          const next = new Set(current)
                          if (e.target.checked) next.add(entry.id)
                          else next.delete(entry.id)
                          return next
                        })
                      }
                    />
                    <span className="min-w-0 break-words">{entry.originalFileName}</span>
                  </label>
                  <div className="file-hint">
                    {formatFileSize(entry.sizeBytes)}
                    {entry.isDuplicate
                      ? ' · Identical EPUB already present; it will be skipped for that book.'
                      : ''}
                  </div>
                  <FileContents file={entry} />
                  {entry.error ? (
                    <p className="file-error">{entry.error}</p>
                  ) : (
                    <>
                      <label className="file-hint">
                        Title
                        <input
                          className={fieldClass}
                          maxLength={250}
                          value={drafts[entry.id]?.title ?? entry.title}
                          onChange={(e) => updateDraft(entry, { title: e.target.value })}
                        />
                      </label>
                      <div className="file-import-fields">
                        <label className="file-hint">
                          Order
                          <input
                            className={fieldClass}
                            type="number"
                            min={0}
                            max={1000000}
                            value={drafts[entry.id]?.sortOrder ?? entry.sortOrder}
                            onChange={(e) =>
                              updateDraft(entry, { sortOrder: Math.max(0, Number(e.target.value)) })
                            }
                          />
                        </label>
                        {!bookId && (
                          <label className="file-hint">
                            Target book
                            <select
                              className={fieldClass}
                              aria-label={`Target book for ${entry.originalFileName}`}
                              value={drafts[entry.id]?.bookId ?? entry.bookId ?? ''}
                              onChange={(e) => updateDraft(entry, { bookId: e.target.value })}
                            >
                              <option value="">Choose an existing book</option>
                              {targetBookId &&
                                !targets.data?.data.some((b) => b.id === targetBookId) && (
                                  <option value={targetBookId}>
                                    {knownBooks[targetBookId] ??
                                      `${entry.bookTitle} · ${entry.contentType}`}
                                  </option>
                                )}
                              {targets.data?.data.map((book) => (
                                <option key={book.id} value={book.id}>
                                  {book.primaryTitle} · {book.contentType}
                                </option>
                              ))}
                            </select>
                          </label>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )
            })}
          </div>
          {job.entries.length > visible && (
            <button
              className={buttonStyles({ size: 'sm' })}
              onClick={() => setVisible((v) => v + 50)}
            >
              Show more files ({job.entries.length - visible} remaining)
            </button>
          )}
          {selectionInvalid && selected.size > 0 && (
            <p className="file-hint">
              Every selected file needs a title and a target book before importing.
            </p>
          )}
        </>
      )}
      {job && ['Failed', 'Cancelled'].includes(job.status) && (
        <button
          className={buttonStyles({ size: 'sm' })}
          onClick={() => {
            previewId.current = null
            setInitial(null)
            setError('')
            void client.invalidateQueries({ queryKey: ['epub-jobs'] })
            onImported()
          }}
        >
          Choose files again
        </button>
      )}
    </FileModal>
  )
}

function maxLabel(
  bookId: string | undefined,
  limits:
    { maxFileBytes: number; maxUploadBytes: number; maxLibraryArchiveBytes: number } | undefined,
) {
  if (!limits) return ''
  return bookId
    ? `${formatFileSize(limits.maxFileBytes)} per EPUB · ${formatFileSize(limits.maxUploadBytes)} per upload.`
    : `${formatFileSize(limits.maxLibraryArchiveBytes)} per exported archive.`
}

function initialDraft(entry: ImportEntry): ImportSelection {
  return {
    entryId: entry.id,
    bookId: entry.bookId ?? '',
    title: entry.title,
    sortOrder: entry.sortOrder,
  }
}

// An empty draft value means "not chosen yet", so fall back to the book suggested by the server.
function selectedTargetBookId(draft: ImportSelection | undefined, entryBookId: string | null) {
  const draftBookId = draft?.bookId
  return draftBookId === undefined || draftBookId === '' ? entryBookId : draftBookId
}
