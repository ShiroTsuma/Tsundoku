import { useMutation } from '@tanstack/react-query'
import { Check, ChevronDown, FileUp, LoaderCircle, Trash2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Virtuoso } from 'react-virtuoso'
import { toast } from 'sonner'
import { api } from '@/api/client'
import { HttpError } from '@/api/http'
import type {
  BookImportFinalizeResult,
  BookImportRowDto,
  BookImportRowUpdateRequest,
  BookImportSessionDto,
} from '@/api/types'
import { Button } from '@/components/ui/Button'
import { buttonStyles } from '@/components/ui/buttonStyles'
import { Dialog } from '@/components/ui/Dialog'
import { fieldClass, textareaClass } from '@/components/ui/fieldStyles'
import { cn } from '@/lib/utils'
import { formatProgress } from './bookProgress'
import {
  getImportIssueGroups,
  getImportSessionStats,
  getRowIssueLabels,
  type ImportIssueGroup,
} from './bookImportStats'

type ImportSource = 'csv' | 'full'
type RowTab = 'fix' | 'ok' | 'all'

type ImportBooksDialogProps = {
  mode?: ImportSource
  open: boolean
  onClose: () => void
  onImported: (result: BookImportFinalizeResult) => void
  /** Switches to the EPUB archive import, which has its own dialog. */
  onChooseEpubArchive?: () => void
}

const templateColumns = [
  'primaryTitle',
  'alternativeTitles',
  'authorName',
  'contentType',
  'status',
  'genres',
  'tags',
  'totalChapters',
  'currentChapterNumber',
  'currentChapterLabel',
  'rating',
  'priority',
  'description',
  'notes',
  'rawImportedLine',
  'links',
  'progressHistory',
]
const requiredColumns = new Set(['primaryTitle', 'contentType', 'status'])

/** Above this many rows the list is virtualised inside a fixed-height box. */
const virtualiseFrom = 40

function errorMessage(error: unknown, fallback: string) {
  return error instanceof HttpError ? error.apiError.detail : fallback
}

export function ImportBooksDialog({
  mode = 'csv',
  open,
  onClose,
  onImported,
  onChooseEpubArchive,
}: ImportBooksDialogProps) {
  const [source, setSource] = useState<ImportSource>(mode)
  const [session, setSession] = useState<BookImportSessionDto | null>(null)
  const [openRowId, setOpenRowId] = useState<string | null>(null)
  const [tab, setTab] = useState<RowTab>('fix')
  const [confirmCancelOpen, setConfirmCancelOpen] = useState(false)
  const [dropzoneActive, setDropzoneActive] = useState(false)
  const [finalizeResult, setFinalizeResult] = useState<BookImportFinalizeResult | null>(null)
  const [trackedOpen, setTrackedOpen] = useState(open)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const stats = useMemo(() => getImportSessionStats(session), [session])
  const issueGroups = useMemo(() => getImportIssueGroups(session), [session])
  const isFullImport = source === 'full'
  const expectedExtension = isFullImport ? '.zip' : '.csv'

  const createSessionMutation = useMutation({
    mutationFn: (file: File) =>
      isFullImport ? api.createFullBookImportSession(file) : api.createBookImportSession(file),
    onSuccess: (nextSession) => {
      setSession(nextSession)
      setOpenRowId(null)
      setTab(nextSession.invalidRows > 0 ? 'fix' : 'all')
    },
    onError: (error) => {
      toast.error(
        errorMessage(
          error,
          isFullImport ? 'Could not read the full backup.' : 'Could not parse CSV.',
        ),
      )
    },
  })

  const finalizeMutation = useMutation({
    mutationFn: (sessionId: string) => api.finalizeBookImport(sessionId),
    onSuccess: (result) => {
      setSession(null)
      setFinalizeResult(result)
      onImported(result)
    },
    onError: (error) => toast.error(errorMessage(error, 'Could not finalize import.')),
  })

  const cancelMutation = useMutation({
    mutationFn: (sessionId: string) => api.cancelBookImport(sessionId),
  })

  const dropInvalidMutation = useMutation({
    mutationFn: (sessionId: string) => api.deleteInvalidBookImportRows(sessionId),
    onSuccess: (nextSession) => {
      setSession(nextSession)
      setOpenRowId(null)
      toast.success('Invalid rows dropped.')
    },
    onError: (error) => toast.error(errorMessage(error, 'Could not drop invalid rows.')),
  })

  const templateMutation = useMutation({
    mutationFn: () => api.downloadBookImportTemplate(),
    onSuccess: (blob) => {
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = 'book-import-template.csv'
      document.body.append(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
    },
    onError: (error) => toast.error(errorMessage(error, 'Could not download CSV template.')),
  })

  // Bulk fixes reuse the row endpoints one row at a time; the last response is the new session.
  const bulkMutation = useMutation({
    mutationFn: async ({ group, replace }: { group: ImportIssueGroup; replace: boolean }) => {
      if (!session) throw new Error('No import session.')
      let next = session
      for (const rowId of group.rowIds) {
        const row = session.rows.find((item) => item.rowId === rowId)
        if (!row) continue
        next =
          replace && group.field && group.suggestion
            ? await api.updateBookImportRow(session.sessionId, rowId, {
                ...createImportRowDraft(row),
                [group.field]: group.suggestion,
              })
            : await api.deleteBookImportRow(session.sessionId, rowId)
      }
      return next
    },
    onSuccess: (nextSession, { group, replace }) => {
      setSession(nextSession)
      setOpenRowId(null)
      const rows = `${String(group.rowIds.length)} ${group.rowIds.length === 1 ? 'row' : 'rows'}`
      toast.success(replace ? `${rows} updated.` : `${rows} dropped.`)
    },
    onError: (error) => toast.error(errorMessage(error, 'Could not update the rows.')),
  })

  if (trackedOpen !== open) {
    setTrackedOpen(open)
    setSession(null)
    setOpenRowId(null)
    setConfirmCancelOpen(false)
    setDropzoneActive(false)
    setFinalizeResult(null)
    setSource(mode)
  }

  if (openRowId !== null && !session?.rows.some((row) => row.rowId === openRowId)) {
    setOpenRowId(null)
  }

  if (!open) {
    return null
  }

  const step = finalizeResult ? 'done' : session ? 'review' : 'upload'
  const busy = finalizeMutation.isPending || dropInvalidMutation.isPending || bulkMutation.isPending

  function handleSelectedFile(file: File) {
    if (!file.name.toLowerCase().endsWith(expectedExtension)) {
      toast.error(`Choose a ${expectedExtension} file.`)
      return
    }
    createSessionMutation.mutate(file)
  }

  function handleDismiss() {
    if (confirmCancelOpen) {
      setConfirmCancelOpen(false)
      return
    }
    if (session) {
      setConfirmCancelOpen(true)
      return
    }
    onClose()
  }

  function handleDiscardDraft() {
    if (!session) {
      setConfirmCancelOpen(false)
      onClose()
      return
    }
    cancelMutation.mutate(session.sessionId, {
      onSuccess: () => {
        setConfirmCancelOpen(false)
        setSession(null)
        onClose()
      },
      onError: (error) => toast.error(errorMessage(error, 'Could not cancel import.')),
    })
  }

  const descriptions = {
    upload: 'Add many books at once from a CSV file or restore a backup.',
    review: 'Fix the flagged rows, then finalize. Nothing is saved yet.',
    done: 'Import finished.',
  }
  const hints = {
    upload: 'Draft sessions expire after 30 minutes idle.',
    review: 'Finalize is available once every row is ready, or after dropping the rest.',
    done: 'Imported books are private.',
  }

  return (
    <Dialog
      open
      actions={
        step === 'upload' ? (
          <SourceSwitch
            source={source}
            disabled={createSessionMutation.isPending}
            onChange={setSource}
            onChooseEpubArchive={onChooseEpubArchive}
          />
        ) : null
      }
      description={descriptions[step]}
      dismissible={!busy}
      footer={
        <>
          <span className="hidden text-[13px] text-ink-3 sm:inline">{hints[step]}</span>
          <div className="hidden flex-1 sm:block" />
          <div className="flex flex-wrap gap-2 max-sm:w-full max-sm:[&>button]:flex-1">
            {step === 'review' && session ? (
              <>
                <Button variant="outline" disabled={busy} onClick={handleDismiss}>
                  Cancel import
                </Button>
                {stats.invalidRowsCount > 0 ? (
                  <Button
                    variant="danger"
                    disabled={busy}
                    onClick={() => dropInvalidMutation.mutate(session.sessionId)}
                  >
                    {dropInvalidMutation.isPending
                      ? 'Dropping…'
                      : `Drop ${formatCount(stats.invalidRowsCount)} invalid ${stats.invalidRowsCount === 1 ? 'row' : 'rows'}`}
                  </Button>
                ) : null}
                <Button
                  variant="primary"
                  disabled={!session.canFinalize || busy}
                  onClick={() => finalizeMutation.mutate(session.sessionId)}
                >
                  {finalizeMutation.isPending ? 'Saving…' : 'Finalize import'}
                </Button>
              </>
            ) : null}
            {step === 'done' ? (
              <>
                <Button variant="outline" onClick={() => setFinalizeResult(null)}>
                  Import another file
                </Button>
                <Button variant="primary" onClick={onClose}>
                  Go to library
                </Button>
              </>
            ) : null}
          </div>
        </>
      }
      title="Import books"
      scrollBody
      widthClassName="max-w-[1080px]"
      onClose={handleDismiss}
    >
      <input
        accept={isFullImport ? '.zip,application/zip' : '.csv,text/csv'}
        className="hidden"
        data-testid="import-file-input"
        ref={fileInputRef}
        type="file"
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) handleSelectedFile(file)
        }}
      />

      {step === 'upload' ? (
        <div className="flex flex-col gap-4 border-t border-line px-6 py-6 mt-5">
          <div
            className={cn(
              'flex flex-col items-center gap-2.5 rounded-panel border-[1.5px] border-dashed px-6 py-12 text-center transition-colors',
              dropzoneActive ? 'border-ink bg-hover' : 'border-line-focus bg-sunk',
            )}
            data-testid="import-dropzone"
            onDragEnter={(event) => {
              event.preventDefault()
              setDropzoneActive(true)
            }}
            onDragLeave={(event) => {
              event.preventDefault()
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                setDropzoneActive(false)
              }
            }}
            onDragOver={(event) => {
              event.preventDefault()
              if (!dropzoneActive) setDropzoneActive(true)
            }}
            onDrop={(event) => {
              event.preventDefault()
              setDropzoneActive(false)
              const file = event.dataTransfer.files[0]
              if (file) handleSelectedFile(file)
            }}
          >
            {createSessionMutation.isPending ? (
              <LoaderCircle aria-hidden="true" className="size-7 animate-spin text-ink-2" />
            ) : (
              <FileUp aria-hidden="true" className="size-7 text-ink-2" strokeWidth={1.8} />
            )}
            <div className="text-[17px] font-semibold" role="status">
              {createSessionMutation.isPending
                ? isFullImport
                  ? 'Reading the backup…'
                  : 'Reading the CSV…'
                : isFullImport
                  ? 'Drop a backup ZIP here'
                  : 'Drop a CSV file here'}
            </div>
            <p className="m-0 max-w-[520px] text-ink-3">
              Nothing is written to your library until you press{' '}
              <strong className="text-ink-2">Finalize import</strong>.{' '}
              {isFullImport
                ? 'The backup restores books and covers; EPUB files come in through the EPUB archive import.'
                : 'Up to 50,000 rows and 10 MB, separated by commas or semicolons.'}
            </p>
            <Button
              variant="primary"
              className="mt-1.5"
              disabled={createSessionMutation.isPending}
              onClick={() => fileInputRef.current?.click()}
            >
              Choose file
            </Button>
          </div>

          {isFullImport ? null : (
            <div className="flex flex-wrap gap-4">
              <section className="min-w-0 flex-[2_1_420px] rounded-field border border-line px-4 py-3.5">
                <h3 className="m-0 text-sm font-semibold">Columns</h3>
                <ul className="m-0 mt-1.5 flex list-none flex-wrap gap-1.5 p-0">
                  {templateColumns.map((column) => {
                    const required = requiredColumns.has(column)
                    return (
                      <li
                        className={cn(
                          'rounded-pill border px-2 py-0.5 font-mono text-xs',
                          required
                            ? 'border-line-focus font-semibold text-ink'
                            : 'border-line text-ink-2',
                        )}
                        key={column}
                      >
                        {column}
                        {required ? <span className="sr-only"> (required)</span> : null}
                      </li>
                    )
                  })}
                </ul>
                <p className="m-0 mt-2 text-[13px] text-ink-3">
                  Bold columns are required. Separate genres and tags with{' '}
                  <span className="font-mono">;</span>. Alt titles, links and progress history are
                  JSON arrays.
                </p>
              </section>
              <section className="flex min-w-0 flex-[1_1_240px] flex-col items-start gap-2 rounded-field border border-line px-4 py-3.5">
                <h3 className="m-0 text-sm font-semibold">Start from the template</h3>
                <p className="m-0 text-[13px] text-ink-3">
                  A header-only CSV with every column in order.
                </p>
                <Button
                  size="sm"
                  disabled={templateMutation.isPending}
                  onClick={() => templateMutation.mutate()}
                >
                  {templateMutation.isPending ? 'Downloading…' : 'Download template'}
                </Button>
              </section>
            </div>
          )}
        </div>
      ) : null}

      {step === 'review' && session ? (
        <ImportReview
          busy={busy}
          issueGroups={issueGroups}
          openRowId={openRowId}
          session={session}
          stats={stats}
          tab={tab}
          onBulk={(group, replace) => bulkMutation.mutate({ group, replace })}
          onOpenRowChange={setOpenRowId}
          onSessionChange={setSession}
          onTabChange={setTab}
        />
      ) : null}

      {step === 'done' && finalizeResult ? <ImportResult result={finalizeResult} /> : null}

      {confirmCancelOpen ? (
        <CancelImportConfirm
          pending={cancelMutation.isPending}
          onDiscard={handleDiscardDraft}
          onKeep={() => setConfirmCancelOpen(false)}
        />
      ) : null}
    </Dialog>
  )
}

function CancelImportConfirm({
  pending,
  onDiscard,
  onKeep,
}: {
  pending: boolean
  onDiscard: () => void
  onKeep: () => void
}) {
  const keepRef = useRef<HTMLButtonElement | null>(null)
  useEffect(() => keepRef.current?.focus(), [])

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-overlay p-4">
      <div
        aria-describedby="import-cancel-text"
        aria-labelledby="import-cancel-title"
        aria-modal="true"
        className="flex max-w-[420px] flex-col gap-2.5 rounded-panel border border-line-strong bg-raised p-5 shadow-overlay"
        role="alertdialog"
      >
        <h3 className="m-0 text-lg font-semibold" id="import-cancel-title">
          Cancel import?
        </h3>
        <p className="m-0 text-ink-2" id="import-cancel-text">
          This discards the draft and your row fixes. Nothing has been added to your library.
        </p>
        <div className="mt-1.5 flex justify-end gap-2">
          <button
            className={buttonStyles({ variant: 'outline' })}
            disabled={pending}
            ref={keepRef}
            type="button"
            onClick={onKeep}
          >
            Keep editing
          </button>
          <Button variant="danger" disabled={pending} onClick={onDiscard}>
            {pending ? 'Discarding…' : 'Discard draft'}
          </Button>
        </div>
      </div>
    </div>
  )
}

function SourceSwitch({
  source,
  disabled,
  onChange,
  onChooseEpubArchive,
}: {
  source: ImportSource
  disabled: boolean
  onChange: (source: ImportSource) => void
  onChooseEpubArchive?: (() => void) | undefined
}) {
  const item = (on: boolean) =>
    cn(
      'h-8 rounded-[7px] border-0 px-3 text-sm whitespace-nowrap',
      on
        ? 'bg-selected font-semibold text-ink'
        : 'bg-transparent font-medium text-ink-2 hover:text-ink',
    )
  return (
    <div
      aria-label="Import source"
      className="flex w-fit flex-wrap gap-0.5 rounded-field border border-line bg-ground p-[3px]"
      role="group"
    >
      <button
        aria-pressed={source === 'csv'}
        className={item(source === 'csv')}
        disabled={disabled}
        type="button"
        onClick={() => onChange('csv')}
      >
        CSV
      </button>
      <button
        aria-pressed={source === 'full'}
        className={item(source === 'full')}
        disabled={disabled}
        type="button"
        onClick={() => onChange('full')}
      >
        Full backup (ZIP)
      </button>
      {onChooseEpubArchive ? (
        <button
          aria-pressed={false}
          className={item(false)}
          disabled={disabled}
          type="button"
          onClick={onChooseEpubArchive}
        >
          EPUB archive
        </button>
      ) : null}
    </div>
  )
}

function ImportReview({
  busy,
  issueGroups,
  openRowId,
  session,
  stats,
  tab,
  onBulk,
  onOpenRowChange,
  onSessionChange,
  onTabChange,
}: {
  busy: boolean
  issueGroups: ImportIssueGroup[]
  openRowId: string | null
  session: BookImportSessionDto
  stats: ReturnType<typeof getImportSessionStats>
  tab: RowTab
  onBulk: (group: ImportIssueGroup, replace: boolean) => void
  onOpenRowChange: (rowId: string | null) => void
  onSessionChange: (session: BookImportSessionDto) => void
  onTabChange: (tab: RowTab) => void
}) {
  const rows = session.rows.filter((row) =>
    tab === 'all' ? true : tab === 'fix' ? !row.isValid : row.isValid,
  )
  const tabs: { id: RowTab; label: string; count: number }[] = [
    { id: 'fix', label: 'Needs fixing', count: stats.invalidRowsCount },
    { id: 'ok', label: 'Ready', count: stats.validRows },
    { id: 'all', label: 'All rows', count: stats.totalRows },
  ]

  const renderRow = (row: BookImportRowDto) => (
    <ImportRow
      availableContentTypes={session.availableContentTypes}
      availableStatuses={session.availableStatuses}
      disabled={busy}
      expanded={openRowId === row.rowId}
      key={row.rowId}
      row={row}
      sessionId={session.sessionId}
      onSessionChange={onSessionChange}
      onToggle={() => onOpenRowChange(openRowId === row.rowId ? null : row.rowId)}
    />
  )

  return (
    <div className="mt-5 flex flex-col gap-4 border-t border-line px-6 py-5">
      <div className="flex flex-wrap items-center gap-4 tabular-nums">
        <span
          className="max-w-full truncate rounded-pill border border-line-strong bg-raised px-2 py-0.5 font-mono text-xs"
          title={session.fileName}
        >
          {session.fileName}
        </span>
        <span>
          <strong>{formatCount(stats.totalRows)}</strong> rows
        </span>
        <span className="text-status-finished-ink">
          <strong>{formatCount(stats.validRows)}</strong> ready
        </span>
        <span className={stats.invalidRowsCount ? 'text-danger-ink' : 'text-ink-3'}>
          <strong>{formatCount(stats.invalidRowsCount)}</strong> need fixing
        </span>
        <div
          aria-label={`${formatCount(stats.validRows)} of ${formatCount(stats.totalRows)} rows ready`}
          aria-valuemax={stats.totalRows}
          aria-valuemin={0}
          aria-valuenow={stats.validRows}
          className={cn(
            'flex h-1.5 min-w-32 flex-[1_1_200px] overflow-hidden rounded-full',
            stats.invalidRowsCount ? 'bg-status-dropped-soft' : 'bg-line',
          )}
          role="progressbar"
        >
          <div
            className="bg-status-finished transition-[width]"
            style={{ width: `${String(stats.progressPercent)}%` }}
          />
        </div>
      </div>

      {issueGroups.length ? (
        <section
          aria-labelledby="import-issues-title"
          className="overflow-hidden rounded-xl border border-danger-line bg-danger-soft/60"
        >
          <h3
            className="m-0 px-3.5 py-2.5 text-xs font-semibold tracking-[0.06em] text-danger-ink uppercase"
            id="import-issues-title"
          >
            Issues · fix many rows at once
          </h3>
          <ul className="m-0 max-h-60 list-none overflow-y-auto p-0">
            {issueGroups.map((group) => (
              <li
                className="flex flex-wrap items-center gap-3 border-t border-danger-line/60 px-3.5 py-2.5"
                key={group.key}
              >
                <span className="min-w-0 flex-[1_1_360px] tabular-nums">
                  {formatCount(group.rowIds.length)} {group.rowIds.length === 1 ? 'row' : 'rows'} ·{' '}
                  {group.label}
                </span>
                {group.suggestion ? (
                  <Button size="sm" disabled={busy} onClick={() => onBulk(group, true)}>
                    Replace with “{group.suggestion}”
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => onBulk(group, false)}
                >
                  {group.rowIds.length === 1 ? 'Drop this row' : 'Drop these rows'}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div aria-label="Rows" className="flex gap-0.5 border-b border-line" role="tablist">
        {tabs.map((item) => {
          const selected = tab === item.id
          return (
            <button
              aria-selected={selected}
              className={cn(
                '-mb-px h-10 border-0 border-b-2 bg-transparent px-3.5 text-sm',
                selected
                  ? 'border-accent font-semibold text-ink'
                  : 'border-transparent font-medium text-ink-2 hover:text-ink',
              )}
              key={item.id}
              role="tab"
              type="button"
              onClick={() => onTabChange(item.id)}
            >
              {item.label}{' '}
              <span className="text-ink-3 tabular-nums">{formatCount(item.count)}</span>
            </button>
          )
        })}
      </div>

      <div data-testid="import-rows" role="tabpanel">
        {rows.length === 0 ? (
          <div className="flex flex-col items-center gap-1.5 rounded-field border border-line px-4 py-10 text-center">
            <Check aria-hidden="true" className="size-6 text-status-finished" />
            <div className="font-semibold">
              {tab === 'fix' ? 'Every row is ready' : 'No rows here'}
            </div>
            {tab === 'fix' ? (
              <div className="text-ink-2">
                Finalize the import to add the books. Nothing is saved before that.
              </div>
            ) : null}
          </div>
        ) : rows.length < virtualiseFrom ? (
          <div className="flex flex-col gap-2">{rows.map(renderRow)}</div>
        ) : (
          <Virtuoso
            data={rows}
            increaseViewportBy={{ bottom: 160, top: 160 }}
            itemContent={(_, row) => <div className="pb-2">{renderRow(row)}</div>}
            style={{ height: 'min(32rem, 55vh)' }}
          />
        )}
      </div>
    </div>
  )
}

function ImportRow({
  availableContentTypes,
  availableStatuses,
  disabled,
  expanded,
  row,
  sessionId,
  onSessionChange,
  onToggle,
}: {
  availableContentTypes: string[]
  availableStatuses: string[]
  disabled: boolean
  expanded: boolean
  row: BookImportRowDto
  sessionId: string
  onSessionChange: (session: BookImportSessionDto) => void
  onToggle: () => void
}) {
  const title = (row.primaryTitle ?? '').trim() || 'Untitled row'
  const chapter = row.currentChapterLabel?.trim()
    ? row.currentChapterLabel
    : row.currentChapterNumber
  const summary = row.isValid
    ? [row.contentType, row.status, chapter ? `Ch. ${chapter}` : null].filter(Boolean).join(' · ')
    : getRowIssueLabels(row).join(' · ')

  const deleteMutation = useMutation({
    mutationFn: () => api.deleteBookImportRow(sessionId, row.rowId),
    onSuccess: (session) => {
      onSessionChange(session)
      toast.success(`Line ${String(row.lineNumber)} removed.`)
    },
    onError: (error) => toast.error(errorMessage(error, 'Could not remove import row.')),
  })

  return (
    <div
      className={cn(
        'rounded-field border',
        row.isValid ? 'border-line' : 'border-danger-line',
        expanded && 'bg-hover',
      )}
      data-testid={`import-row-${row.rowId}`}
    >
      <div className="flex flex-wrap items-center gap-3 px-3.5 py-3">
        <span className="w-16 flex-none font-mono text-xs text-ink-3 tabular-nums">
          Line {row.lineNumber}
        </span>
        <span className="min-w-0 flex-[1_1_280px]">
          <span className="block truncate font-semibold" title={title}>
            {title}
          </span>
          <span className={cn('block text-[13px]', row.isValid ? 'text-ink-3' : 'text-danger-ink')}>
            {summary}
          </span>
        </span>
        <Button aria-expanded={expanded} size="row" disabled={disabled} onClick={onToggle}>
          {expanded ? 'Collapse' : row.isValid ? 'Edit' : 'Fix'}
        </Button>
        <Button
          aria-label={`Remove line ${String(row.lineNumber)}`}
          variant="ghost"
          size="iconRow"
          disabled={disabled || deleteMutation.isPending}
          onClick={() => deleteMutation.mutate()}
        >
          <Trash2 aria-hidden="true" className="size-4" />
        </Button>
      </div>
      {expanded ? (
        <ImportRowEditor
          availableContentTypes={availableContentTypes}
          availableStatuses={availableStatuses}
          row={row}
          sessionId={sessionId}
          onSessionChange={onSessionChange}
        />
      ) : null}
    </div>
  )
}

function ImportRowEditor({
  availableContentTypes,
  availableStatuses,
  row,
  sessionId,
  onSessionChange,
}: {
  availableContentTypes: string[]
  availableStatuses: string[]
  row: BookImportRowDto
  sessionId: string
  onSessionChange: (session: BookImportSessionDto) => void
}) {
  const formRef = useRef<HTMLDivElement | null>(null)
  const [draft, setDraft] = useState<BookImportRowUpdateRequest>(() => createImportRowDraft(row))
  const [draftRow, setDraftRow] = useState(row)

  if (draftRow !== row) {
    setDraftRow(row)
    setDraft(createImportRowDraft(row))
  }

  useEffect(() => {
    const element = formRef.current
    // jsdom has no scrollIntoView.
    if (element && 'scrollIntoView' in element) element.scrollIntoView({ block: 'nearest' })
  }, [])

  const mutation = useMutation({
    mutationFn: () => api.updateBookImportRow(sessionId, row.rowId, draft),
    onSuccess: (session) => {
      onSessionChange(session)
      toast.success(`Line ${String(row.lineNumber)} saved.`)
    },
    onError: (error) => toast.error(errorMessage(error, 'Could not update import row.')),
  })

  const field = (key: keyof BookImportRowUpdateRequest) => ({
    error: row.fieldErrors[key] ?? [],
    value: draft[key] ?? '',
    onChange: (value: string) => setDraft((current) => ({ ...current, [key]: value })),
  })

  return (
    <div
      className="grid grid-cols-1 gap-3 px-3.5 pt-1 pb-3.5 sm:grid-cols-2 lg:grid-cols-4 lg:pl-[90px]"
      ref={formRef}
    >
      <LabeledInput className="sm:col-span-2" label="Title" {...field('primaryTitle')} />
      <LabeledInput label="Author" {...field('authorName')} />
      <LabeledInput label="Type" suggestions={availableContentTypes} {...field('contentType')} />
      <LabeledInput label="Status" suggestions={availableStatuses} {...field('status')} />
      <LabeledInput inputMode="decimal" label="Chapters read" {...field('currentChapterNumber')} />
      <LabeledInput label="Label in source" {...field('currentChapterLabel')} />
      <LabeledInput
        inputMode="numeric"
        label="Total chapters"
        placeholder="Unknown"
        {...field('totalChapters')}
      />
      <LabeledInput className="sm:col-span-2" label="Genres" {...field('genres')} />
      <LabeledInput className="sm:col-span-2" label="Tags" {...field('tags')} />
      <LabeledInput inputMode="numeric" label="Rating" {...field('rating')} />
      <LabeledInput inputMode="numeric" label="Priority" {...field('priority')} />
      <LabeledTextarea className="sm:col-span-2" label="Notes" {...field('notes')} />
      <LabeledTextarea className="sm:col-span-2" label="Description" {...field('description')} />
      <div className="flex justify-end sm:col-span-2 lg:col-span-4">
        <Button
          variant="primary"
          size="sm"
          disabled={mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          {mutation.isPending ? 'Saving…' : 'Save row'}
        </Button>
      </div>
    </div>
  )
}

function ImportResult({ result }: { result: BookImportFinalizeResult }) {
  return (
    <div className="mt-5 flex flex-col gap-4 border-t border-line px-6 py-6">
      <div className="flex flex-wrap gap-3">
        <div className="flex-[1_1_200px] rounded-xl bg-status-finished-soft p-4">
          <div className="text-xs font-semibold tracking-[0.06em] text-status-finished-ink uppercase">
            Imported
          </div>
          <div className="text-[32px] font-semibold text-status-finished-ink tabular-nums">
            {formatCount(result.importedCount)}
          </div>
        </div>
        <div className="flex-[1_1_200px] rounded-xl border border-line p-4">
          <div className="text-xs font-semibold tracking-[0.06em] text-ink-3 uppercase">
            Skipped
          </div>
          <div className="text-[32px] font-semibold tabular-nums">
            {formatCount(result.skippedCount)}
          </div>
        </div>
        <p className="m-0 flex-[2_1_320px] rounded-xl border border-line p-4 text-ink-2">
          New authors and tags were created. Covers are looked up in the background, so they appear
          over the next few minutes.
        </p>
      </div>

      {result.errors.length ? (
        <div
          className="flex flex-col gap-1 rounded-field border border-danger-line px-3.5 py-3 text-danger-ink tabular-nums"
          role="status"
        >
          {result.errors.map((error) => (
            <p className="m-0" key={error}>
              {error}
            </p>
          ))}
        </div>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-line">
        {result.importedBooks.length ? (
          <div className="max-h-[min(28rem,50vh)] overflow-auto" data-testid="import-result-scroll">
            <table className="w-full table-fixed border-collapse text-left tabular-nums">
              <thead className="sticky top-0 bg-sunk text-xs font-semibold tracking-[0.06em] text-ink-3 uppercase">
                <tr>
                  <th className="px-3.5 py-2.5">Title</th>
                  <th className="w-[20%] px-3.5 py-2.5">Type</th>
                  <th className="w-[20%] px-3.5 py-2.5">Progress</th>
                </tr>
              </thead>
              <tbody>
                {result.importedBooks.map((book) => (
                  <tr
                    className="border-t border-line-soft"
                    key={`${book.contentType}:${book.primaryTitle}`}
                  >
                    <td className="truncate px-3.5 py-2.5 font-medium" title={book.primaryTitle}>
                      {book.primaryTitle}
                    </td>
                    <td className="px-3.5 py-2.5 text-ink-2">{book.contentType}</td>
                    <td className="px-3.5 py-2.5">{formatProgress(book)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="px-4 py-6 text-center text-ink-3">No books were imported.</div>
        )}
      </div>
    </div>
  )
}

function formatCount(value: number) {
  return new Intl.NumberFormat('en-US').format(value)
}

function FieldShell({
  children,
  className,
  error,
  errorId,
  label,
  labelFor,
}: {
  children: ReactNode
  className?: string | undefined
  error: string[]
  errorId: string
  label: string
  labelFor: string
}) {
  return (
    <div className={cn('relative flex min-w-0 flex-col gap-1', className)}>
      <label className="text-[13px] font-medium text-ink-2" htmlFor={labelFor}>
        {label}
      </label>
      {children}
      {error.length ? (
        <span className="text-xs text-danger-ink" id={errorId}>
          {error.join(' ')}
        </span>
      ) : null}
    </div>
  )
}

function LabeledInput({
  className,
  error,
  inputMode,
  label,
  placeholder,
  suggestions = [],
  value,
  onChange,
}: {
  className?: string
  error: string[]
  inputMode?: 'numeric' | 'decimal'
  label: string
  placeholder?: string
  suggestions?: string[]
  value: string
  onChange: (value: string) => void
}) {
  const id = useId()
  const listboxId = useId()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [open, setOpen] = useState(false)
  const normalized = value.trim().toLowerCase()
  const matching = suggestions.filter((item) => item.toLowerCase().includes(normalized))
  const exact = suggestions.some((item) => item.toLowerCase() === normalized)
  const shown = normalized && matching.length && !exact ? matching : suggestions
  const showSuggestions = suggestions.length > 0 && open && shown.length > 0

  useEffect(() => {
    if (!open) return undefined
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  return (
    <FieldShell
      className={className}
      error={error}
      errorId={`${id}-error`}
      label={label}
      labelFor={id}
    >
      <div className="relative" ref={containerRef}>
        <input
          aria-autocomplete={suggestions.length ? 'list' : undefined}
          aria-controls={showSuggestions ? listboxId : undefined}
          aria-describedby={error.length ? `${id}-error` : undefined}
          aria-expanded={suggestions.length ? open : undefined}
          aria-invalid={error.length ? 'true' : undefined}
          className={cn(fieldClass, 'h-10 text-sm', suggestions.length && 'pr-10')}
          id={id}
          inputMode={inputMode}
          placeholder={placeholder}
          ref={inputRef}
          role={suggestions.length ? 'combobox' : undefined}
          value={value}
          onBlur={(event) => {
            if (!containerRef.current?.contains(event.relatedTarget)) setOpen(false)
          }}
          onChange={(event) => {
            onChange(event.target.value)
            if (suggestions.length) setOpen(true)
          }}
          onFocus={() => {
            if (suggestions.length) setOpen(true)
          }}
        />
        {suggestions.length ? (
          <button
            aria-label={`Show ${label.toLowerCase()} suggestions`}
            className="absolute inset-y-0 right-0 inline-flex w-10 items-center justify-center border-0 bg-transparent text-ink-3 hover:text-ink"
            tabIndex={-1}
            type="button"
            onClick={() => {
              inputRef.current?.focus()
              setOpen((current) => !current)
            }}
          >
            <ChevronDown
              aria-hidden="true"
              className={cn('size-4 transition-transform', open && 'rotate-180')}
            />
          </button>
        ) : null}
        {showSuggestions ? (
          <div
            aria-label={`${label} suggestions`}
            className="absolute top-full right-0 left-0 z-20 mt-1 flex flex-col rounded-field border border-line-strong bg-raised p-1 shadow-popover"
            id={listboxId}
            role="listbox"
          >
            {shown.map((suggestion) => (
              <button
                aria-selected={suggestion === value}
                className={cn(
                  'rounded-[6px] border-0 px-2.5 py-2 text-left text-sm',
                  suggestion === value
                    ? 'bg-selected text-ink'
                    : 'bg-transparent text-ink-2 hover:bg-selected hover:text-ink',
                )}
                key={suggestion}
                role="option"
                type="button"
                onClick={() => {
                  onChange(suggestion)
                  setOpen(false)
                  inputRef.current?.focus()
                }}
                onMouseDown={(event) => event.preventDefault()}
              >
                {suggestion}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </FieldShell>
  )
}

function LabeledTextarea({
  className,
  error,
  label,
  value,
  onChange,
}: {
  className?: string
  error: string[]
  label: string
  value: string
  onChange: (value: string) => void
}) {
  const id = useId()
  return (
    <FieldShell
      className={className}
      error={error}
      errorId={`${id}-error`}
      label={label}
      labelFor={id}
    >
      <textarea
        aria-describedby={error.length ? `${id}-error` : undefined}
        aria-invalid={error.length ? 'true' : undefined}
        className={cn(textareaClass, 'min-h-24 text-sm')}
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </FieldShell>
  )
}

function createImportRowDraft(row: BookImportRowDto): BookImportRowUpdateRequest {
  return {
    primaryTitle: row.primaryTitle ?? '',
    authorName: row.authorName ?? '',
    contentType: row.contentType ?? '',
    status: row.status ?? '',
    genres: row.genres ?? '',
    tags: row.tags ?? '',
    totalChapters: row.totalChapters ?? '',
    currentChapterNumber: row.currentChapterNumber ?? '',
    currentChapterLabel: row.currentChapterLabel ?? '',
    rating: row.rating ?? '',
    priority: row.priority ?? '',
    description: row.description ?? '',
    notes: row.notes ?? '',
    rawImportedLine: row.rawImportedLine ?? '',
  }
}
