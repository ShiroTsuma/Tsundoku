import { useEffect, useRef, useState } from 'react'
import {
  bookFilesApi,
  formatFileSize,
  startFileDownload,
  type BookFile,
  type FileJob,
} from '@/api/bookFiles'
import { FileContents } from './FileContents'
import { FileJobProgress, FileModal } from './FileDialogs'
import { fileError, isJobWorking, useFileJob } from './fileJobs'
import { buttonStyles } from '@/components/ui/buttonStyles'

export function FileDownloadDialog({
  files,
  snapshotId,
  onClose,
}: {
  files: BookFile[]
  snapshotId?: string | undefined
  onClose: () => void
}) {
  const [selected, setSelected] = useState(() => new Set(files.map((f) => f.id)))
  const [mode, setMode] = useState<'zip' | 'separate'>(files.length === 1 ? 'separate' : 'zip')
  const [separate, setSeparate] = useState(false)
  const [jobId, setJobId] = useState<string>()
  const [visible, setVisible] = useState(50)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [started, setStarted] = useState<Set<string>>(new Set())
  const job = useFileJob(jobId)
  const creating = useRef<Promise<FileJob> | null>(null)
  const closing = useRef(false)
  const latestJob = useRef({ id: jobId, data: job.data })
  useEffect(() => {
    latestJob.current = { id: jobId, data: job.data }
  })
  useEffect(() => {
    closing.current = false
    return () => {
      closing.current = true
      if (creating.current)
        void creating.current
          .then((result) => bookFilesApi.cancel(result.id))
          .catch(ignoreCleanupFailure)
      else if (
        latestJob.current.id &&
        (!latestJob.current.data || isJobWorking(latestJob.current.data))
      )
        void bookFilesApi.cancel(latestJob.current.id).catch(ignoreCleanupFailure)
    }
  }, [])
  const [selectionFiles, setSelectionFiles] = useState(files)
  if (selectionFiles !== files) {
    setSelectionFiles(files)
    setSelected((current) => new Set([...current].filter((id) => files.some((f) => f.id === id))))
  }
  const chosen = files.filter((f) => selected.has(f.id))
  async function prepare() {
    if (mode === 'separate') {
      setSeparate(true)
      return
    }
    setBusy(true)
    setError('')
    try {
      creating.current = bookFilesApi.export(
        chosen.map((f) => f.id),
        snapshotId,
      )
      const result = await creating.current
      if (!closing.current) setJobId(result.id)
    } catch (e) {
      setError(fileError(e))
    } finally {
      creating.current = null
      if (!closing.current) setBusy(false)
    }
  }
  async function download(fileId?: string) {
    setBusy(true)
    setError('')
    try {
      const ticket = fileId
        ? (await bookFilesApi.downloads([fileId], snapshotId))[0]
        : jobId
          ? await bookFilesApi.jobDownload(jobId)
          : undefined
      if (!ticket) throw new Error('The download could not be prepared. Please try again.')
      startFileDownload(ticket)
      setStarted((current) => new Set(current).add(fileId ?? 'zip'))
    } catch (e) {
      setError(fileError(e))
    } finally {
      setBusy(false)
    }
  }
  async function back() {
    setBusy(true)
    setError('')
    try {
      if (jobId) await bookFilesApi.cancel(jobId)
      setJobId(undefined)
      setSeparate(false)
      setStarted(new Set())
    } catch (e) {
      setError(fileError(e))
    } finally {
      setBusy(false)
    }
  }
  async function close() {
    if (closing.current) return
    closing.current = true
    setBusy(true)
    try {
      const id = creating.current ? (await creating.current).id : jobId
      if (id && (!job.data || isJobWorking(job.data))) await bookFilesApi.cancel(id)
      onClose()
    } catch (e) {
      setError(fileError(e))
      closing.current = false
      setBusy(false)
    }
  }
  const selection = !jobId && !separate
  return (
    <FileModal
      title="Download EPUBs"
      onClose={() => void close()}
      footer={
        <>
          {!selection && (
            <button
              className={buttonStyles({ variant: 'ghost', size: 'sm' })}
              disabled={busy}
              onClick={() => void back()}
            >
              Back to selection
            </button>
          )}
          <button className={buttonStyles({ size: 'sm' })} onClick={() => void close()}>
            {isJobWorking(job.data) ? 'Cancel' : 'Close'}
          </button>
          {selection && (
            <button
              className={buttonStyles({ variant: 'primary', size: 'sm' })}
              disabled={busy || chosen.length === 0}
              onClick={() => void prepare()}
            >
              {busy ? 'Preparing…' : mode === 'zip' ? 'Create ZIP' : 'Continue'}
            </button>
          )}
          {job.data?.status === 'Ready' && (
            <button
              className={buttonStyles({ variant: 'primary', size: 'sm' })}
              disabled={busy}
              onClick={() => void download()}
            >
              {started.has('zip') ? 'Download ZIP again' : 'Download ZIP'}
            </button>
          )}
        </>
      }
    >
      {error && (
        <p role="alert" className="file-error">
          {error}
        </p>
      )}
      {job.isError && (
        <p className="file-error" role="alert">
          {fileError(job.error)}{' '}
          <button className={buttonStyles({ size: 'sm' })} onClick={() => void job.refetch()}>
            Retry
          </button>
        </p>
      )}
      {selection ? (
        <>
          <fieldset className="file-selection-bar">
            <legend className="sr-only">Download format</legend>
            <label className="file-check">
              <input
                type="radio"
                name="download-format"
                checked={mode === 'zip'}
                onChange={() => setMode('zip')}
              />
              ZIP archive
            </label>
            <label className="file-check">
              <input
                type="radio"
                name="download-format"
                checked={mode === 'separate'}
                onChange={() => setMode('separate')}
              />
              Separate EPUBs
            </label>
          </fieldset>
          <div className="file-selection-bar">
            <label className="file-check">
              <input
                type="checkbox"
                aria-label="Select all EPUB files"
                checked={files.length > 0 && chosen.length === files.length}
                ref={(node) => {
                  if (node) node.indeterminate = chosen.length > 0 && chosen.length < files.length
                }}
                onChange={(e) =>
                  setSelected(new Set(e.target.checked ? files.map((f) => f.id) : []))
                }
              />
              Select all
            </label>
            <span className="file-hint">
              {chosen.length} selected ·{' '}
              {formatFileSize(chosen.reduce((total, f) => total + f.sizeBytes, 0))}
            </span>
          </div>
          <div>
            {files.slice(0, visible).map((file) => (
              <label className="file-check file-download-choice" key={file.id}>
                <input
                  type="checkbox"
                  aria-label={`Select ${file.title}`}
                  checked={selected.has(file.id)}
                  onChange={(e) => {
                    const checked = e.target.checked
                    setSelected((current) => {
                      const next = new Set(current)
                      if (checked) next.add(file.id)
                      else next.delete(file.id)
                      return next
                    })
                  }}
                />
                <span className="min-w-0">
                  <strong className="block break-words">{file.title}</strong>
                  <FileContents file={file} />
                  <span className="file-hint">{formatFileSize(file.sizeBytes)}</span>
                </span>
              </label>
            ))}
          </div>
          {files.length > visible && (
            <button
              className={buttonStyles({ size: 'sm' })}
              onClick={() => setVisible((v) => v + 50)}
            >
              Show more files
            </button>
          )}
        </>
      ) : separate ? (
        <div>
          {chosen.map((file) => (
            <div className="file-download-row" key={file.id}>
              <div className="min-w-0">
                <strong className="block break-words">{file.title}</strong>
                <FileContents file={file} />
                {started.has(file.id) && <span className="file-hint">Download started</span>}
              </div>
              <button
                className={buttonStyles({ size: 'sm' })}
                disabled={busy}
                onClick={() => void download(file.id)}
              >
                Download
              </button>
            </div>
          ))}
        </div>
      ) : (
        <>
          {job.data && <FileJobProgress job={job.data} />}
          {job.data?.status === 'Failed' && (
            <button className={buttonStyles({ size: 'sm' })} onClick={() => void back()}>
              Change selection and retry
            </button>
          )}
        </>
      )}
    </FileModal>
  )
}

function ignoreCleanupFailure() {
  // Best-effort cleanup after the dialog unmounted; there is no UI left to report to.
}
