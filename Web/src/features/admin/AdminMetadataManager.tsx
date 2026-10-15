import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { toast } from 'sonner'
import { api } from '@/api/client'
import { HttpError } from '@/api/http'
import type { DictionaryMutationRequest, TagDto } from '@/api/types'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { fieldClass, textareaClass } from '@/components/ui/fieldStyles'
import { listRowClass, ListBox, SearchField, StateBox } from '@/components/ui/ListParts'
import { SegmentButton } from '@/features/books/BookListControls'

type MetadataKind = 'statuses' | 'types' | 'genres' | 'tags'
type MetadataItem = { id: string; name: string; description?: string | null | undefined }

type MetadataSection = {
  kind: MetadataKind
  label: string
  singular: string
}

const sections: MetadataSection[] = [
  { kind: 'statuses', label: 'Statuses', singular: 'status' },
  { kind: 'types', label: 'Types', singular: 'type' },
  { kind: 'genres', label: 'Genres', singular: 'genre' },
  { kind: 'tags', label: 'Global tags', singular: 'global tag' },
]

const sectionsByKind = Object.fromEntries(sections.map((item) => [item.kind, item])) as Record<
  MetadataKind,
  MetadataSection
>

export function AdminMetadataManager() {
  const [kind, setKind] = useState<MetadataKind>('statuses')
  const [search, setSearch] = useState('')
  const [editor, setEditor] = useState<MetadataItem | 'create' | null>(null)
  const query = useQuery({
    queryKey: ['admin-metadata', kind],
    queryFn: () => loadItems(kind),
  })
  const section = sectionsByKind[kind]
  const normalizedSearch = search.trim().toLocaleLowerCase()
  const items = (query.data ?? []).filter(
    (item) =>
      !normalizedSearch ||
      item.name.toLocaleLowerCase().includes(normalizedSearch) ||
      item.description?.toLocaleLowerCase().includes(normalizedSearch),
  )

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div
        aria-label="Dictionary"
        className="flex w-fit flex-wrap gap-0.5 rounded-field border border-line bg-surface p-[3px]"
        role="group"
      >
        {sections.map((item) => (
          <SegmentButton
            key={item.kind}
            pressed={kind === item.kind}
            onClick={() => {
              setKind(item.kind)
              setSearch('')
            }}
          >
            {item.label}
          </SegmentButton>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <SearchField
          label={`Search ${section.label}`}
          placeholder={`Search ${section.label.toLocaleLowerCase()}…`}
          value={search}
          onChange={setSearch}
        />
        <span className="text-[13px] text-ink-3 tabular-nums" role="status">
          {items.length.toLocaleString()} shown
        </span>
        <Button variant="primary" onClick={() => setEditor('create')}>
          <Plus aria-hidden="true" className="size-4" />
          Add {section.singular}
        </Button>
      </div>
      <p className="m-0 text-[13px] text-ink-3">
        Shared by every account. Double-click a row to edit it, or use Edit.
      </p>

      {query.isPending ? (
        <StateBox>Loading {section.label.toLocaleLowerCase()}…</StateBox>
      ) : query.isError ? (
        <StateBox tone="error">Could not load metadata.</StateBox>
      ) : items.length === 0 ? (
        <StateBox>No matching items.</StateBox>
      ) : (
        <ListBox label={section.label}>
          {items.map((item) => (
            <div
              className={listRowClass}
              key={item.id}
              role="group"
              onDoubleClick={() => setEditor(item)}
            >
              <div className="min-w-0 flex-[1_1_16rem]">
                <div className="truncate font-semibold">{item.name}</div>
                <div className="line-clamp-2 text-[13px] text-ink-3">
                  {item.description?.length ? item.description : 'No description'}
                </div>
              </div>
              <Button
                aria-label={`Edit ${section.singular} ${item.name}`}
                size="row"
                variant="ghost"
                onClick={() => setEditor(item)}
              >
                Edit
              </Button>
            </div>
          ))}
        </ListBox>
      )}
      {editor ? (
        <MetadataDialog
          key={editor === 'create' ? 'create' : editor.id}
          item={editor}
          kind={kind}
          singular={section.singular}
          onClose={() => setEditor(null)}
        />
      ) : null}
    </div>
  )
}

function MetadataDialog({
  item,
  kind,
  singular,
  onClose,
}: {
  item: MetadataItem | 'create'
  kind: MetadataKind
  singular: string
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const formId = useId()
  const nameRef = useRef<HTMLInputElement>(null)
  // The dialog is mounted per edited item (keyed by the parent), so initial state comes from props.
  const [name, setName] = useState(item === 'create' ? '' : item.name)
  const [description, setDescription] = useState(item === 'create' ? '' : (item.description ?? ''))
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    window.setTimeout(() => nameRef.current?.focus(), 0)
  }, [])

  const isCreate = item === 'create'

  async function save(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    try {
      const trimmedDescription = description.trim()
      const request = {
        name: name.trim(),
        description: trimmedDescription ? trimmedDescription : null,
      }
      if (item === 'create') await createItem(kind, request)
      else await updateItem(kind, item.id, request)
      await queryClient.invalidateQueries({ queryKey: ['admin-metadata', kind] })
      toast.success(`${capitalize(singular)} ${isCreate ? 'created' : 'updated'}.`)
      onClose()
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    if (item === 'create') return
    setSaving(true)
    try {
      await deleteItem(kind, item.id)
      await queryClient.invalidateQueries({ queryKey: ['admin-metadata', kind] })
      toast.success(`${capitalize(singular)} deleted.`)
      onClose()
    } catch (error) {
      toast.error(errorMessage(error))
      setConfirmDelete(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      open
      description={isCreate ? undefined : `Edit ${singular}`}
      dismissible={!saving}
      footer={
        <>
          {!isCreate ? (
            <Button disabled={saving} variant="danger" onClick={() => void remove()}>
              <Trash2 aria-hidden="true" className="size-4" />
              {confirmDelete ? 'Confirm delete' : `Delete ${singular}`}
            </Button>
          ) : null}
          <span className="flex-1" />
          <Button disabled={saving} variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={saving || !name.trim()} form={formId} type="submit" variant="primary">
            {saving ? 'Saving…' : isCreate ? `Create ${singular}` : 'Save changes'}
          </Button>
        </>
      }
      title={item === 'create' ? `New ${singular}` : item.name}
      widthClassName="max-w-[560px]"
      onClose={onClose}
    >
      <form
        className="flex flex-col gap-4 px-6 pt-4 pb-6"
        id={formId}
        onSubmit={(event) => void save(event)}
      >
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-ink-2">Name</span>
          <input
            ref={nameRef}
            aria-label="Name"
            className={fieldClass}
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-ink-2">Description</span>
          <textarea
            aria-label="Description"
            className={textareaClass}
            maxLength={500}
            rows={6}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
          <small className="text-xs text-ink-3 tabular-nums">
            {description.length}/500 characters
          </small>
        </label>
        {confirmDelete ? (
          <p className="m-0 text-[13px] text-danger-ink" role="alert">
            This cannot be undone. Items still used by books cannot be deleted.
          </p>
        ) : null}
      </form>
    </Dialog>
  )
}

async function loadItems(kind: MetadataKind): Promise<MetadataItem[]> {
  if (kind === 'statuses') return (await api.getStatuses()).data
  if (kind === 'types') return (await api.getTypes()).data
  if (kind === 'genres') return (await api.getGenres()).data
  return (await api.searchAdminGlobalTags()).map(fromTag)
}

function createItem(kind: MetadataKind, request: DictionaryMutationRequest) {
  if (kind === 'statuses') return api.createAdminStatus(request)
  if (kind === 'types') return api.createAdminType(request)
  if (kind === 'genres') return api.createAdminGenre(request)
  return api.createAdminGlobalTag(request)
}

function updateItem(kind: MetadataKind, id: string, request: DictionaryMutationRequest) {
  if (kind === 'statuses') return api.updateAdminStatus(id, request)
  if (kind === 'types') return api.updateAdminType(id, request)
  if (kind === 'genres') return api.updateAdminGenre(id, request)
  return api.updateAdminGlobalTag(id, request)
}

function deleteItem(kind: MetadataKind, id: string) {
  if (kind === 'statuses') return api.deleteAdminStatus(id)
  if (kind === 'types') return api.deleteAdminType(id)
  if (kind === 'genres') return api.deleteAdminGenre(id)
  return api.deleteAdminGlobalTag(id)
}

function fromTag(tag: TagDto): MetadataItem {
  return { id: tag.id, name: tag.name, description: tag.description }
}
function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1)
}
function errorMessage(error: unknown) {
  return error instanceof HttpError
    ? error.apiError.detail
    : error instanceof Error
      ? error.message
      : 'Operation failed.'
}
