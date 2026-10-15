import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, Download, Pencil, RotateCcw, Search, Trash2 } from 'lucide-react'
import { useCallback, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  bookFilesApi,
  formatFileSize,
  startFileDownload,
  type BookFile,
  type BookFileList,
  type FileJob,
} from '@/api/bookFiles'
import { Button } from '@/components/ui/Button'
import { EpubSearchDialog, type EpubSearchBook } from '@/features/epubSearch/EpubSearchDialog'
import { useEpubDownload } from '@/features/epubSearch/queries'
import { isDownloadFinished, type EpubDownloadJob } from '@/features/epubSearch/types'
import { FileModal } from './files/FileDialogs'
import { fileError } from './files/fileJobs'
import { FileDownloadDialog } from './files/FileDownloadDialog'
import { FileImportDialog } from './files/FileImportDialog'
import { FileContents } from './files/FileContents'
import { buttonStyles } from '@/components/ui/buttonStyles'
import { fieldClass } from '@/components/ui/fieldStyles'

function useBookFiles(bookId?: string, snapshotId?: string) {
  return useQuery<BookFileList | BookFile[]>({
    queryKey: ['book-files', bookId ?? snapshotId],
    queryFn: () => {
      if (bookId) {
        return bookFilesApi.list(bookId)
      }
      if (snapshotId) {
        return bookFilesApi.publicList(snapshotId)
      }
      return Promise.reject(new Error('A book or snapshot is required to list EPUBs.'))
    },
  })
}

/** Files added within this many days get a NEW badge in the panel. */
const newFileDays = 7

export function BookFilesPanel({
  bookId,
  searchBook,
  searchOpen: controlledSearchOpen,
  onSearchOpenChange,
}: {
  bookId: string
  /** Book details for "Find & download"; the button is hidden without them. */
  searchBook?: Omit<EpubSearchBook, 'existingFileCount'> | undefined
  /** Lets the page open Find EPUB from elsewhere (the details hero). */
  searchOpen?: boolean | undefined
  onSearchOpenChange?: ((open: boolean) => void) | undefined
}) {
  const queryClient = useQueryClient()
  const query = useBookFiles(bookId)
  const [manageOpen, setManageOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [downloadOpen, setDownloadOpen] = useState(false)
  const [ownSearchOpen, setOwnSearchOpen] = useState(false)
  const searchOpen = controlledSearchOpen ?? ownSearchOpen
  // The search dialog stays mounted once opened, so a download keeps running
  // (and reports back) after "Run in background".
  const [searchMounted, setSearchMounted] = useState(false)
  const [downloadJobId, setDownloadJobId] = useState<string | null>(null)
  const job = useEpubDownload(downloadJobId).data ?? null
  const [downloading, setDownloading] = useState<string>()
  const [error, setError] = useState('')
  const list = query.data && 'files' in query.data ? query.data : undefined
  const files = list ? list.files.filter((f) => !f.deletedAtUtc) : []
  const totalBytes = files.reduce((sum, f) => sum + f.sizeBytes, 0)
  const storagePercent =
    list && list.maxStorageBytes > 0
      ? Math.min(100, (list.usedStorageBytes / list.maxStorageBytes) * 100)
      : 0
  const headingId = `epub-heading-${bookId}`
  const [now] = useState(() => Date.now())

  if (searchOpen && !searchMounted) {
    setSearchMounted(true)
  }

  function setSearchOpen(open: boolean) {
    setOwnSearchOpen(open)
    onSearchOpenChange?.(open)
  }

  function refreshFiles() {
    void queryClient.invalidateQueries({ queryKey: ['book-files'] })
    void queryClient.invalidateQueries({ queryKey: ['epub-jobs'] })
  }

  async function downloadOne(file: BookFile) {
    setDownloading(file.id)
    setError('')
    try {
      const [ticket] = await bookFilesApi.downloads([file.id], undefined)
      if (!ticket) {
        throw new Error('The download could not be prepared.')
      }
      startFileDownload(ticket)
    } catch (e) {
      setError(fileError(e))
    } finally {
      setDownloading(undefined)
    }
  }

  let summary = 'No EPUBs'
  if (query.isPending) summary = 'Loading…'
  else if (query.isError) summary = 'Unavailable'
  else if (files.length > 0)
    summary = `${files.length} ${files.length === 1 ? 'file' : 'files'} · ${formatFileSize(totalBytes)}`

  const runningJob = job && !isDownloadFinished(job.status) ? job : null

  return (
    <>
      <section
        aria-labelledby={headingId}
        className="overflow-hidden rounded-panel border border-line bg-surface"
      >
        <div className="flex items-center gap-2.5 px-4 pt-4 pb-3">
          <h2 id={headingId} className="m-0 flex-1 text-base font-semibold">
            EPUB files
          </h2>
          <span className="text-[13px] text-ink-3 tabular-nums">{summary}</span>
        </div>

        {runningJob ? (
          <RunningDownload job={runningJob} onDetails={() => setSearchOpen(true)} />
        ) : null}

        {files.length > 0 ? (
          <ul className="m-0 list-none border-t border-line p-0">
            {files.map((file) => {
              const isNew = now - new Date(file.createdAt).getTime() < newFileDays * 86_400_000
              return (
                <li
                  key={file.id}
                  className="flex items-center gap-3 border-b border-line-soft px-4 py-3 last:border-b-0"
                >
                  <span
                    aria-hidden="true"
                    className="flex h-10 w-8 shrink-0 items-center justify-center rounded border border-line-strong bg-raised text-[10px] font-bold tracking-wide text-ink-2"
                  >
                    EPUB
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-2 font-semibold">
                      <span className="truncate">{file.title}</span>
                      {isNew ? (
                        <span className="shrink-0 rounded bg-status-finished-soft px-1.5 text-[11px] font-bold tracking-[0.04em] text-status-finished-ink">
                          NEW
                        </span>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-baseline gap-x-1.5 text-[13px] text-ink-3 tabular-nums">
                      <FileContents className="m-0 font-mono text-xs" file={file} suffix=" ·" />
                      <span className="whitespace-nowrap">
                        {formatFileSize(file.sizeBytes)}
                        {file.isShared ? ' · Shared' : null}
                      </span>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="iconSm"
                    aria-label={`Download ${file.title}`}
                    disabled={downloading === file.id}
                    onClick={() => void downloadOne(file)}
                  >
                    <Download aria-hidden="true" className="size-4" />
                  </Button>
                </li>
              )
            })}
          </ul>
        ) : null}
        {query.isSuccess && files.length === 0 ? (
          <p className="m-0 border-t border-line px-4 py-4 text-ink-3">
            No EPUB files yet. Find one online or upload your own.
          </p>
        ) : null}

        {error ? (
          <p role="alert" className="m-0 px-4 pt-3 text-[13px] text-danger-ink">
            {error}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3">
          {searchBook ? (
            <Button variant="primary" size="sm" onClick={() => setSearchOpen(true)}>
              <Search aria-hidden="true" className="size-4" />
              Find &amp; download
            </Button>
          ) : null}
          <Button variant="secondary" size="sm" onClick={() => setImportOpen(true)}>
            Upload EPUB / ZIP
          </Button>
          <span className="flex-1" />
          {files.length > 1 ? (
            <Button variant="ghost" size="sm" onClick={() => setDownloadOpen(true)}>
              Download all
            </Button>
          ) : null}
          <Button variant="ghost" size="sm" onClick={() => setManageOpen(true)}>
            Manage
          </Button>
        </div>

        {list ? (
          <div className="px-4 pb-3.5">
            <div className="flex justify-between text-xs text-ink-3 tabular-nums">
              <span>Storage</span>
              <span>
                {formatFileSize(list.usedStorageBytes)} of {formatFileSize(list.maxStorageBytes)} ·
                incl. trash
              </span>
            </div>
            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-line">
              <div className="h-full bg-ink-3" style={{ width: `${storagePercent}%` }} />
            </div>
          </div>
        ) : null}
      </section>

      {manageOpen ? (
        <BookFilesDialog bookId={bookId} initialManage onClose={() => setManageOpen(false)} />
      ) : null}
      {importOpen ? (
        <FileImportDialog
          bookId={bookId}
          onClose={() => setImportOpen(false)}
          onImported={refreshFiles}
        />
      ) : null}
      {downloadOpen ? (
        <FileDownloadDialog files={files} onClose={() => setDownloadOpen(false)} />
      ) : null}
      {searchBook && searchMounted ? (
        <EpubSearchDialog
          open={searchOpen}
          book={{ ...searchBook, existingFileCount: files.length }}
          onClose={() => setSearchOpen(false)}
          onDownloadStarted={setDownloadJobId}
          onDownloadFinished={refreshFiles}
        />
      ) : null}
    </>
  )
}

/** A Find EPUB download still running after its dialog was closed. */
function RunningDownload({ job, onDetails }: { job: EpubDownloadJob; onDetails: () => void }) {
  const percent = job.chaptersTotal > 0 ? (job.chaptersDone / job.chaptersTotal) * 100 : 0
  const current = job.files.find((file) => file.status !== 'added') ?? job.files.at(-1)
  return (
    <div className="mx-4 mb-3 flex flex-col gap-2 rounded-field border border-line bg-sunk p-3">
      <div className="flex items-center gap-2">
        <Download aria-hidden="true" className="size-4 shrink-0 text-ink-2" />
        <span className="min-w-0 flex-1 truncate font-medium">
          Downloading from {job.sourceName}
        </span>
        <button
          type="button"
          className="border-0 bg-transparent p-0 text-[13px] text-ink-2 underline decoration-line-focus underline-offset-[3px] hover:text-ink"
          onClick={onDetails}
        >
          Details
        </button>
      </div>
      <div className="text-[13px] text-ink-3 tabular-nums">
        {[
          current
            ? `${current.title} · chapters ${current.firstChapter}–${current.lastChapter}`
            : null,
          `${job.chaptersDone} of ${job.chaptersTotal}`,
          'new files appear here when built',
        ]
          .filter(Boolean)
          .join(' · ')}
      </div>
      <div
        role="progressbar"
        aria-label="EPUB download"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(percent)}
        className="h-1.5 overflow-hidden rounded-full bg-line"
      >
        <div
          className="progress-working h-full rounded-full bg-accent"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  )
}

export function BookFilesDialog({
  bookId,
  snapshotId,
  initialManage = false,
  onClose,
}: {
  bookId?: string
  snapshotId?: string
  /** Open straight into management (rename, reorder, share, trash). */
  initialManage?: boolean
  onClose: () => void
}) {
  const client = useQueryClient()
  const query = useBookFiles(bookId, snapshotId)
  const [manage, setManage] = useState(initialManage)
  const [trashOpen, setTrashOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [resume, setResume] = useState<FileJob>()
  const [downloadOpen, setDownloadOpen] = useState(false)
  const [downloading, setDownloading] = useState<string>()
  const [deleting, setDeleting] = useState<BookFile>()
  const [editing, setEditing] = useState<string>()
  const [title, setTitle] = useState('')
  const [error, setError] = useState('')
  const [visible, setVisible] = useState(50)
  const files = query.data ? ('files' in query.data ? query.data.files : query.data) : []
  const own = query.data && 'files' in query.data ? query.data : undefined
  const active = files.filter((f) => !f.deletedAtUtc)
  const trash = files.filter((f) => f.deletedAtUtc)
  const rows = trashOpen ? trash : active
  const limits = useQuery({
    queryKey: ['epub-limits'],
    queryFn: bookFilesApi.limits,
    enabled: manage,
  })
  const jobs = useQuery({
    queryKey: ['epub-jobs'],
    queryFn: bookFilesApi.jobs,
    enabled: Boolean(bookId),
    retry: false,
  })
  const resumable = jobs.data?.find(
    (j) =>
      j.bookId === bookId &&
      j.kind === 'BookImport' &&
      !['Completed', 'Failed', 'Cancelled'].includes(j.status),
  )
  function imported() {
    void client.invalidateQueries({ queryKey: ['book-files'] })
    void client.invalidateQueries({ queryKey: ['epub-jobs'] })
  }
  const mutation = useMutation({
    mutationFn: (operation: () => Promise<unknown>) => operation(),
    onSuccess: async () => {
      setError('')
      setEditing(undefined)
      setDeleting(undefined)
      await Promise.all([
        client.invalidateQueries({ queryKey: ['book-files'] }),
        client.invalidateQueries({ queryKey: ['public-books'] }),
      ])
    },
    onError: (e) => setError(fileError(e)),
  })
  const focusOnMount = useCallback((element: HTMLInputElement | null) => {
    element?.focus()
  }, [])
  function mutateBook(operation: (id: string) => Promise<unknown>) {
    if (!bookId) {
      return
    }
    mutation.mutate(() => operation(bookId))
  }
  function move(index: number, offset: number) {
    const ids = active.map((f) => f.id)
    const current = ids[index]
    const target = ids[index + offset]
    if (current === undefined || target === undefined) {
      return
    }
    ids[index] = target
    ids[index + offset] = current
    mutateBook((id) => bookFilesApi.reorder(id, ids))
  }
  function add() {
    setResume(resumable)
    setImportOpen(true)
  }
  async function downloadOne(file: BookFile) {
    setDownloading(file.id)
    setError('')
    try {
      const [ticket] = await bookFilesApi.downloads([file.id], snapshotId)
      if (!ticket) {
        throw new Error('The download could not be prepared.')
      }
      startFileDownload(ticket)
    } catch (e) {
      setError(fileError(e))
    } finally {
      setDownloading(undefined)
    }
  }
  return (
    <>
      <FileModal
        title={manage ? 'Manage EPUBs' : 'EPUBs'}
        onClose={onClose}
        footer={
          <>
            {bookId && (
              <button
                className={buttonStyles({ variant: 'ghost', size: 'sm' })}
                type="button"
                disabled={mutation.isPending}
                onClick={() => {
                  setManage(!manage)
                  setTrashOpen(false)
                  setEditing(undefined)
                  setVisible(50)
                  setError('')
                }}
              >
                {manage ? 'Done' : 'Manage'}
              </button>
            )}
            <button className={buttonStyles({ size: 'sm' })} type="button" onClick={onClose}>
              Close
            </button>
            {!manage && active.length > 0 && (
              <button
                className={buttonStyles({ variant: 'primary', size: 'sm' })}
                type="button"
                onClick={() => setDownloadOpen(true)}
              >
                Download
              </button>
            )}
            {bookId && manage && (
              <button
                className={buttonStyles({ variant: 'primary', size: 'sm' })}
                type="button"
                onClick={add}
              >
                {resumable ? 'Resume import' : 'Add EPUB / ZIP'}
              </button>
            )}
          </>
        }
      >
        {manage && (
          <div className="epub-manage-bar">
            <span className="file-hint">
              {own &&
                `${formatFileSize(own.usedStorageBytes)} / ${formatFileSize(own.maxStorageBytes)} storage (including trash)`}
            </span>
            <button
              className={buttonStyles({ size: 'sm' })}
              type="button"
              aria-pressed={trashOpen}
              onClick={() => {
                setTrashOpen(!trashOpen)
                setVisible(50)
                setEditing(undefined)
              }}
            >
              {trashOpen ? 'Active files' : `Trash (${trash.length})`}
            </button>
          </div>
        )}
        {error && (
          <p role="alert" className="file-error">
            {error}
          </p>
        )}
        {query.isPending ? (
          <p className="file-hint">Loading EPUBs…</p>
        ) : query.isError ? (
          <p role="alert" className="file-error">
            Could not load EPUBs.{' '}
            <button className={buttonStyles({ size: 'sm' })} onClick={() => void query.refetch()}>
              Retry
            </button>
          </p>
        ) : (
          <>
            {trashOpen && (
              <p className="file-hint">
                Restore within {limits.data?.retentionDays ?? 30} days. Restored EPUBs are private.
              </p>
            )}
            {rows.length === 0 && (
              <p className="file-empty">{trashOpen ? 'Trash is empty.' : 'No EPUBs.'}</p>
            )}
            <div className="epub-browser-list">
              {rows.slice(0, visible).map((file, index) => (
                <div className="epub-browser-row" key={file.id}>
                  <div className="min-w-0">
                    {editing === file.id ? (
                      <form
                        className="file-rename"
                        onSubmit={(e) => {
                          e.preventDefault()
                          mutateBook((id) => bookFilesApi.rename(id, file.id, title))
                        }}
                      >
                        <input
                          className={fieldClass}
                          aria-label="File title"
                          maxLength={250}
                          value={title}
                          ref={focusOnMount}
                          onChange={(e) => setTitle(e.target.value)}
                        />
                        <button
                          className={buttonStyles({ variant: 'primary', size: 'sm' })}
                          disabled={mutation.isPending || !title.trim()}
                        >
                          Save
                        </button>
                        <button
                          className={buttonStyles({ size: 'sm' })}
                          type="button"
                          onClick={() => setEditing(undefined)}
                        >
                          Cancel
                        </button>
                      </form>
                    ) : (
                      <strong className="block break-words">{file.title}</strong>
                    )}
                    <FileContents file={file} />
                    <span className="file-hint">
                      {formatFileSize(file.sizeBytes)}
                      {!manage && file.isShared && bookId ? ' · Shared' : ''}
                    </span>
                    {manage && <p className="file-hint break-words">{file.originalFileName}</p>}
                  </div>
                  {!manage && (
                    <button
                      className={buttonStyles({ size: 'sm' })}
                      type="button"
                      aria-label={`Download ${file.title}`}
                      disabled={Boolean(downloading)}
                      onClick={() => void downloadOne(file)}
                    >
                      <Download size={16} />
                      {downloading === file.id ? 'Starting…' : 'Download'}
                    </button>
                  )}
                  {manage && (
                    <div className="book-file-actions">
                      {trashOpen ? (
                        <button
                          className={buttonStyles({ size: 'sm' })}
                          disabled={mutation.isPending}
                          onClick={() => mutateBook((id) => bookFilesApi.restore(id, file.id))}
                        >
                          <RotateCcw size={16} />
                          Restore
                        </button>
                      ) : (
                        <>
                          {own?.snapshotId && (
                            <label className="file-check">
                              <input
                                type="checkbox"
                                aria-label={`Share ${file.title}`}
                                checked={file.isShared}
                                disabled={mutation.isPending}
                                onChange={(e) => {
                                  const ids = e.target.checked
                                    ? [
                                        ...active.filter((f) => f.isShared).map((f) => f.id),
                                        file.id,
                                      ]
                                    : active
                                        .filter((f) => f.isShared && f.id !== file.id)
                                        .map((f) => f.id)
                                  mutateBook((id) => bookFilesApi.share(id, ids))
                                }}
                              />
                              Shared
                            </label>
                          )}
                          <button
                            className={buttonStyles({ variant: 'ghost', size: 'sm' })}
                            disabled={mutation.isPending}
                            aria-label={`Rename ${file.title}`}
                            onClick={() => {
                              setEditing(file.id)
                              setTitle(file.title)
                            }}
                          >
                            <Pencil size={16} />
                          </button>
                          <button
                            className={buttonStyles({ variant: 'ghost', size: 'sm' })}
                            disabled={mutation.isPending || index === 0}
                            aria-label={`Move ${file.title} up`}
                            onClick={() => move(index, -1)}
                          >
                            <ArrowUp size={16} />
                          </button>
                          <button
                            className={buttonStyles({ variant: 'ghost', size: 'sm' })}
                            disabled={mutation.isPending || index === active.length - 1}
                            aria-label={`Move ${file.title} down`}
                            onClick={() => move(index, 1)}
                          >
                            <ArrowDown size={16} />
                          </button>
                          <button
                            className={buttonStyles({ variant: 'ghost', size: 'sm' })}
                            disabled={mutation.isPending}
                            aria-label={`Remove ${file.title}`}
                            onClick={() => setDeleting(file)}
                          >
                            <Trash2 size={16} />
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
            {rows.length > visible && (
              <button
                className={buttonStyles({ size: 'sm' })}
                onClick={() => setVisible((v) => v + 50)}
              >
                Show more ({rows.length - visible} remaining)
              </button>
            )}
            {manage && !trashOpen && active.length > 0 && !own?.snapshotId && (
              <p className="file-hint">
                To share EPUBs, publish the book in{' '}
                <Link to="/manage" className="ui-inline-link">
                  Manage
                </Link>
                .
              </p>
            )}
          </>
        )}
      </FileModal>
      {importOpen && (
        <FileImportDialog
          {...(bookId !== undefined ? { bookId } : {})}
          {...(resume !== undefined ? { initialJob: resume } : {})}
          onClose={() => setImportOpen(false)}
          onImported={imported}
        />
      )}
      {downloadOpen && (
        <FileDownloadDialog
          files={active}
          {...(snapshotId !== undefined ? { snapshotId } : {})}
          onClose={() => setDownloadOpen(false)}
        />
      )}
      {deleting && (
        <FileModal
          title="Move EPUB to trash?"
          onClose={() => setDeleting(undefined)}
          footer={
            <>
              <button
                className={buttonStyles({ size: 'sm' })}
                disabled={mutation.isPending}
                onClick={() => setDeleting(undefined)}
              >
                Cancel
              </button>
              <button
                className={buttonStyles({ variant: 'danger', size: 'sm' })}
                disabled={mutation.isPending}
                onClick={() => mutateBook((id) => bookFilesApi.remove(id, deleting.id))}
              >
                Move to trash
              </button>
            </>
          }
        >
          <p className="break-words">{deleting.title}</p>
          <p className="file-hint">
            Restore within {limits.data?.retentionDays ?? 30} days. Sharing stops immediately.
          </p>
          {error && (
            <p role="alert" className="file-error">
              {error}
            </p>
          )}
        </FileModal>
      )}
    </>
  )
}
