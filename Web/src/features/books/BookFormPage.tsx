import { zodResolver } from '@hookform/resolvers/zod'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Link2, Upload, X } from 'lucide-react'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { api } from '@/api/client'
import { HttpError } from '@/api/http'
import type { AuthorDto, BookCoverDto, BookHtmlParseResult, BookMutationRequest } from '@/api/types'
import { Button } from '@/components/ui/Button'
import { buttonStyles } from '@/components/ui/buttonStyles'
import { fieldClass, textareaClass } from '@/components/ui/fieldStyles'
import { Dialog } from '@/components/ui/Dialog'
import { useDebouncedValue } from '@/lib/useDebouncedValue'
import { cn } from '@/lib/utils'
import { TypeCoverPlaceholder } from './BookListCells'
import { getProgressHistoryWithDeltas } from './bookProgressHistory'
import { getStatusTone, statusToneClasses } from './bookStatus'
import { setFieldFilter } from './queryTokens'
import { BookCoverArtwork, CoverLightbox } from './BookCoverSection'
import { useResolvedCoverImage } from './useResolvedCoverImage'
import {
  bookFormSchema,
  defaultBookFormValues,
  emptyBookFormLink,
  toBookMutationRequest,
  type BookFormLink,
  type BookFormValues,
} from './bookFormSchema'
import { getDisplayCoverFailure, getDisplayCoverStatus } from './coverFailure'
import { BookHtmlParseDialog, type BookHtmlParseField } from './BookHtmlParseDialog'
import { getBookListReturnTo } from './bookListNavigation'
import {
  bindPendingCoverUpload,
  discardPendingCoverUpload,
  stagePendingCoverUpload,
} from './coverUploadOutbox'

type BookFormPageProps = {
  mode: 'create' | 'edit'
  admin?: boolean
}

type DraftCoverState =
  | { kind: 'file'; file: File; previewUrl: string }
  | { kind: 'url'; imageUrl: string; previewUrl: string }
  | null

type SaveResult = {
  id: string
  coverError?: string | null
  coverQueued?: boolean
  publishError?: string | null
}

type SelectedAuthorDisplay = {
  id: string
  primaryName: string
  matchedAlias?: string | undefined
}

type CoverInfoItem = {
  text: string
  truncate?: boolean
}

type ExistingCoverChange = { kind: 'keep' } | { kind: 'remove' }

const allowedCoverMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp'])
const allowedCoverExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp'])
const suggestionSearchDelayMs = 150

export function BookFormPage({ mode, admin = false }: BookFormPageProps) {
  const { id } = useParams<{ id: string }>()
  const location = useLocation()
  const navigate = useNavigate()
  const bookListReturnTo = getBookListReturnTo(location.state)
  const queryClient = useQueryClient()
  const initializedBookIdRef = useRef<string | null>(null)
  const [authorSuggestionsOpen, setAuthorSuggestionsOpen] = useState(false)
  const [selectedAuthorDisplay, setSelectedAuthorDisplay] = useState<SelectedAuthorDisplay | null>(
    null,
  )
  const [coverPreviewOpen, setCoverPreviewOpen] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  /** Public snapshot choice; null keeps whatever the book has now. */
  const [publishChoice, setPublishChoice] = useState<boolean | null>(null)
  const [htmlParseDialogOpen, setHtmlParseDialogOpen] = useState(false)
  const [draftCover, setDraftCover] = useState<DraftCoverState>(null)
  const [existingCoverChange, setExistingCoverChange] = useState<ExistingCoverChange>({
    kind: 'keep',
  })
  const bookQueryKey = [admin ? 'adminBook' : 'book', id] as const
  const bookQuery = useQuery({
    queryKey: bookQueryKey,
    queryFn: () => {
      if (!id) {
        throw new Error('The book id is missing from the route.')
      }
      return admin ? api.getAdminBook(id) : api.getBook(id)
    },
    enabled: mode === 'edit' && Boolean(id),
  })
  const typesQuery = useQuery({ queryKey: ['types'], queryFn: api.getTypes, staleTime: 300_000 })
  const statusesQuery = useQuery({
    queryKey: ['statuses'],
    queryFn: api.getStatuses,
    staleTime: 300_000,
  })
  const genresQuery = useQuery({ queryKey: ['genres'], queryFn: api.getGenres, staleTime: 300_000 })

  const form = useForm<BookFormValues>({
    resolver: zodResolver(bookFormSchema),
    defaultValues: defaultBookFormValues(),
  })

  const authorName = useWatch({ control: form.control, name: 'authorName' }) ?? ''
  const trimmedAuthorName = authorName.trim()
  const debouncedAuthorSearch = useDebouncedValue(trimmedAuthorName, suggestionSearchDelayMs)
  const authorInputValue = selectedAuthorDisplay
    ? formatAuthorDisplay(selectedAuthorDisplay.primaryName, selectedAuthorDisplay.matchedAlias)
    : authorName
  const primaryTitle = useWatch({ control: form.control, name: 'primaryTitle' })
  const currentChapterNumber = useWatch({ control: form.control, name: 'currentChapterNumber' })
  const currentChapterLabel = useWatch({ control: form.control, name: 'currentChapterLabel' })
  const alternativeTitles = useWatch({ control: form.control, name: 'alternativeTitles' })
  const links = useWatch({ control: form.control, name: 'links' })
  const totalChapters = useWatch({ control: form.control, name: 'totalChapters' })
  const priority = useWatch({ control: form.control, name: 'priority' })
  const rating = useWatch({ control: form.control, name: 'rating' })
  const selectedGenreIds = useWatch({ control: form.control, name: 'genreIds' })
  const selectedTags = splitComma(useWatch({ control: form.control, name: 'tagsText' }))
  const selectedTypeId = useWatch({ control: form.control, name: 'contentTypeId' })
  const selectedStatusId = useWatch({ control: form.control, name: 'statusId' })
  const selectedType = typesQuery.data?.data.find((type) => type.id === selectedTypeId)
  const selectedStatus = statusesQuery.data?.data.find((status) => status.id === selectedStatusId)
  const resolvedCoverUrl = useResolvedCoverImage(bookQuery.data?.cover)
  const authorSuggestionsQuery = useQuery({
    queryKey: ['authorSuggestions', debouncedAuthorSearch],
    queryFn: () => api.searchAuthors(debouncedAuthorSearch, 8),
    enabled: debouncedAuthorSearch.length >= 2,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  })
  // The book's public listing lives in Manage; look it up by title and match the id.
  const listingQuery = useQuery({
    queryKey: ['manage-books', 'listing', id, bookQuery.data?.primaryTitle],
    queryFn: () =>
      api.getManagedBooks({
        take: 25,
        query: setFieldFilter('', 'title', bookQuery.data?.primaryTitle ?? ''),
      }),
    enabled: mode === 'edit' && !admin && Boolean(bookQuery.data?.primaryTitle),
    staleTime: 30_000,
  })
  const listing = listingQuery.data?.data.find((item) => item.book.id === id)?.listing ?? null
  const isListed = listing !== null
  const authorSearchPending =
    trimmedAuthorName !== debouncedAuthorSearch || authorSuggestionsQuery.isFetching

  const [trackedRoute, setTrackedRoute] = useState({ id, mode })
  if (trackedRoute.id !== id || trackedRoute.mode !== mode) {
    setTrackedRoute({ id, mode })
    setSelectedAuthorDisplay(null)
    setExistingCoverChange({ kind: 'keep' })
    setPublishChoice(null)
  }

  useEffect(() => {
    initializedBookIdRef.current = null
  }, [id, mode])

  useEffect(() => {
    return () => {
      if (draftCover?.kind === 'file') {
        URL.revokeObjectURL(draftCover.previewUrl)
      }
    }
  }, [draftCover])

  useEffect(() => {
    if (
      mode === 'edit' &&
      bookQuery.data &&
      typesQuery.data &&
      statusesQuery.data &&
      genresQuery.data &&
      initializedBookIdRef.current !== bookQuery.data.id
    ) {
      const matchingType = typesQuery.data.data.find(
        (item) => item.name === bookQuery.data.contentType,
      )
      const matchingStatus = statusesQuery.data.data.find(
        (item) => item.name === bookQuery.data.status,
      )
      const matchingGenres = genresQuery.data.data
        .filter((item) => bookQuery.data.genres.includes(item.name))
        .map((item) => item.id)
      form.reset({
        ...defaultBookFormValues(bookQuery.data),
        contentTypeId: matchingType?.id ?? '',
        statusId: matchingStatus?.id ?? '',
        genreIds: matchingGenres,
      })
      setSelectedAuthorDisplay(
        bookQuery.data.authorId && bookQuery.data.author
          ? { id: bookQuery.data.authorId, primaryName: bookQuery.data.author }
          : null,
      )
      initializedBookIdRef.current = bookQuery.data.id
    }
  }, [bookQuery.data, form, genresQuery.data, mode, statusesQuery.data, typesQuery.data])

  useEffect(() => {
    if (mode === 'create' && typesQuery.data && statusesQuery.data) {
      form.setValue('contentTypeId', typesQuery.data.data[0]?.id ?? '')
      form.setValue('statusId', statusesQuery.data.data[0]?.id ?? '')
    }
  }, [form, mode, statusesQuery.data, typesQuery.data])

  async function resolveAuthor(values: BookFormValues): Promise<BookFormValues> {
    const name = values.authorName?.trim()
    if (!name || values.authorId) {
      return values
    }

    const authors = await api.searchAuthors(name, 10)
    const exactAuthor = authors.find((author) => {
      const normalizedName = normalizeAuthorName(name)
      return (
        normalizeAuthorName(author.primaryName) === normalizedName ||
        author.otherNames.some((otherName) => normalizeAuthorName(otherName) === normalizedName)
      )
    })

    return exactAuthor
      ? (() => {
          const matchedAlias = findMatchingAlias(exactAuthor, name)
          setSelectedAuthorDisplay({
            id: exactAuthor.id,
            primaryName: exactAuthor.primaryName,
            matchedAlias,
          })
          return { ...values, authorId: exactAuthor.id, authorName: exactAuthor.primaryName }
        })()
      : values
  }

  async function saveCover(bookId: string, cover: DraftCoverState) {
    if (!cover) {
      return null
    }

    if (cover.kind === 'url') {
      return api.setBookCoverFromUrl(bookId, cover.imageUrl)
    }

    return api.uploadBookCover(bookId, cover.file)
  }

  async function saveBookWithCoverSourceLink(
    bookId: string,
    request: BookMutationRequest,
    savedCover: BookCoverDto | null,
  ) {
    const requestWithCoverSource = appendCoverSourceLink(request, savedCover)
    if (requestWithCoverSource === request) {
      return
    }

    await (admin
      ? api.updateAdminBook(bookId, requestWithCoverSource)
      : api.updateBook(bookId, requestWithCoverSource))
  }

  function replaceDraftCover(next: DraftCoverState) {
    setDraftCover((current) => {
      if (current?.kind === 'file') {
        URL.revokeObjectURL(current.previewUrl)
      }
      return next
    })
  }

  function selectAuthor(author: AuthorDto) {
    const matchedAlias = findMatchingAlias(author, authorName)
    form.setValue('authorId', author.id, { shouldDirty: true, shouldValidate: true })
    form.setValue('authorName', author.primaryName, { shouldDirty: true, shouldValidate: true })
    setSelectedAuthorDisplay({ id: author.id, primaryName: author.primaryName, matchedAlias })
    setAuthorSuggestionsOpen(false)
  }

  function handleAuthorBlur() {
    const normalizedName = normalizeAuthorName(authorName)
    const exactAuthor = authorSuggestionsQuery.data?.find(
      (author) =>
        normalizeAuthorName(author.primaryName) === normalizedName ||
        author.otherNames.some((otherName) => normalizeAuthorName(otherName) === normalizedName),
    )
    if (exactAuthor) {
      selectAuthor(exactAuthor)
      return
    }

    window.setTimeout(() => setAuthorSuggestionsOpen(false), 120)
  }

  function setAlternativeTitles(value: string[]) {
    form.setValue('alternativeTitles', value, { shouldDirty: true })
  }

  function setLinks(value: BookFormLink[]) {
    form.setValue('links', value, { shouldDirty: true })
  }

  function updateLink(index: number, change: Partial<BookFormLink>) {
    setLinks(links.map((link, position) => (position === index ? { ...link, ...change } : link)))
  }

  function setSelectedGenreIds(value: string[]) {
    form.setValue('genreIds', value, { shouldDirty: true, shouldValidate: true })
  }

  function setSelectedTags(value: string[]) {
    form.setValue('tagsText', value.join(', '), { shouldDirty: true, shouldValidate: true })
  }

  function setNumericFieldValue(field: 'totalChapters', rawValue: string) {
    form.setValue(field, sanitizeDecimalInput(rawValue), {
      shouldDirty: true,
      shouldValidate: true,
    })
  }

  function setIntegerFieldValue(field: 'currentChapterNumber', rawValue: string) {
    form.setValue(field, sanitizeIntegerInput(rawValue), {
      shouldDirty: true,
      shouldValidate: true,
    })
  }

  function storeDraftFile(file: File) {
    if (!isAllowedCoverFile(file)) {
      toast.error('Choose a JPG, PNG, or WebP image.')
      return
    }

    setExistingCoverChange({ kind: 'keep' })
    replaceDraftCover({ kind: 'file', file, previewUrl: URL.createObjectURL(file) })
    toast.success('Cover ready. It will be saved with the book.')
  }

  function storeDraftUrl(imageUrl: string) {
    setExistingCoverChange({ kind: 'keep' })
    replaceDraftCover({ kind: 'url', imageUrl, previewUrl: imageUrl })
    toast.success('Cover URL ready. It will be saved with the book.')
  }

  function applyParsedHtml(result: BookHtmlParseResult, selected: ReadonlySet<BookHtmlParseField>) {
    if (selected.has('primaryTitle') && result.primaryTitle) {
      form.setValue('primaryTitle', result.primaryTitle, {
        shouldDirty: true,
        shouldValidate: true,
      })
    }
    if (selected.has('authorName') && result.authorName) {
      form.setValue('authorName', result.authorName, { shouldDirty: true, shouldValidate: true })
      form.setValue('authorId', '', { shouldDirty: true, shouldValidate: true })
      setSelectedAuthorDisplay(null)
    }
    if (selected.has('contentType') && result.contentType?.id) {
      form.setValue('contentTypeId', result.contentType.id, {
        shouldDirty: true,
        shouldValidate: true,
      })
    }
    if (selected.has('alternativeTitles')) {
      form.setValue(
        'alternativeTitles',
        mergeValues(
          form.getValues('alternativeTitles').filter((title) => title.trim()),
          result.alternativeTitles,
        ),
        { shouldDirty: true, shouldValidate: true },
      )
    }
    if (selected.has('genres')) {
      form.setValue(
        'genreIds',
        mergeValues(
          form.getValues('genreIds'),
          result.genres.flatMap((genre) => (genre.id ? [genre.id] : [])),
        ),
        { shouldDirty: true, shouldValidate: true },
      )
    }
    if (selected.has('tags')) {
      form.setValue(
        'tagsText',
        mergeValues(splitComma(form.getValues('tagsText')), result.tags).join(', '),
        { shouldDirty: true, shouldValidate: true },
      )
    }
    if (selected.has('description') && result.description) {
      form.setValue('description', result.description, { shouldDirty: true, shouldValidate: true })
    }
    if (selected.has('canonicalUrl') && result.canonicalUrl) {
      const currentLinks = form.getValues('links')
      if (!currentLinks.some((link) => sameUrl(link.url, result.canonicalUrl ?? ''))) {
        form.setValue('links', [...currentLinks, emptyBookFormLink(result.canonicalUrl)], {
          shouldDirty: true,
          shouldValidate: true,
        })
      }
    }
    if (selected.has('coverUrl') && result.coverUrl) {
      setExistingCoverChange({ kind: 'keep' })
      replaceDraftCover({ kind: 'url', imageUrl: result.coverUrl, previewUrl: result.coverUrl })
    }
    toast.success(`Applied metadata from ${result.source}.`)
  }

  /** Lists or unlists the book in Discover; returns an error message or null. */
  async function applyPublishChoice(bookId: string, publish: boolean) {
    try {
      if (publish) {
        await api.publishBook(bookId)
      } else if (listing) {
        await api.unlistPublishedBook(listing.id)
      }
      return null
    } catch (error) {
      return error instanceof HttpError
        ? error.apiError.detail
        : error instanceof Error
          ? error.message
          : 'Unknown error.'
    }
  }

  const deleteMutation = useMutation({
    mutationFn: () => {
      if (!id) {
        throw new Error('The book id is missing from the route.')
      }
      return api.deleteBook(id)
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['books'] })
      toast.success('Book deleted.')
      void navigate(bookListReturnTo, { replace: true })
    },
    onError: (error) => {
      toast.error(error instanceof HttpError ? error.apiError.detail : 'Failed to delete the book.')
    },
  })

  const mutation = useMutation({
    mutationFn: async (values: BookFormValues): Promise<SaveResult> => {
      const resolvedValues = await resolveAuthor(values)
      const request = toBookMutationRequest(resolvedValues)

      if (mode === 'create') {
        const pendingCoverUploadToken =
          draftCover?.kind === 'file' ? await stagePendingCoverUpload(draftCover.file) : null
        let created: { id: string }
        try {
          const createRequest =
            draftCover?.kind === 'url'
              ? { ...request, initialCoverUrl: draftCover.imageUrl }
              : pendingCoverUploadToken
                ? { ...request, initialCoverUploadToken: pendingCoverUploadToken }
                : request
          created = await api.createBook(createRequest)
        } catch (error) {
          if (pendingCoverUploadToken) {
            await discardPendingCoverUpload(pendingCoverUploadToken)
          }
          throw error
        }

        if (pendingCoverUploadToken) {
          try {
            await bindPendingCoverUpload(pendingCoverUploadToken, created.id)
          } catch {
            // The global queue can recover the book from the durable token after a reload.
          }
        }
        return {
          id: created.id,
          coverQueued: draftCover?.kind === 'url' || pendingCoverUploadToken != null,
          publishError: publishChoice ? await applyPublishChoice(created.id, true) : null,
        }
      }

      if (!id) {
        throw new Error('The book id is missing from the route.')
      }
      await (admin ? api.updateAdminBook(id, request) : api.updateBook(id, request))
      let coverError: string | null = null
      try {
        if (draftCover) {
          const savedCover = await saveCover(id, draftCover)
          await saveBookWithCoverSourceLink(id, request, savedCover)
        } else if (existingCoverChange.kind === 'remove') {
          await api.deleteBookCover(id)
        }
      } catch (error) {
        coverError =
          error instanceof HttpError
            ? error.apiError.detail
            : error instanceof Error
              ? error.message
              : 'Failed to save cover.'
      }

      const publishError =
        publishChoice !== null && publishChoice !== isListed
          ? await applyPublishChoice(id, publishChoice)
          : null
      return { id, coverError, publishError }
    },
    onSuccess: async (response) => {
      if (response.publishError) {
        toast.warning(`Book saved, but the public snapshot failed: ${response.publishError}`)
      }
      const invalidateQueries = Promise.all([
        queryClient.invalidateQueries({ queryKey: ['manage-books'] }),
        queryClient.invalidateQueries({ queryKey: ['public-books'] }),
        queryClient.invalidateQueries({ queryKey: ['books'] }),
        queryClient.invalidateQueries({ queryKey: ['adminBooks'] }),
        queryClient.invalidateQueries({ queryKey: ['book', response.id] }),
        queryClient.invalidateQueries({ queryKey: ['adminBook', response.id] }),
      ])
      if (mode === 'create') {
        void invalidateQueries
        if (response.coverError) {
          toast.warning(`Book added, but cover failed: ${response.coverError}`)
        } else if (response.coverQueued) {
          toast.success('Book added. Cover is being saved in the background.')
        } else {
          toast.success('Book added.')
        }
        void navigate(admin ? '/admin' : `/books/${response.id}`, {
          replace: true,
          state: admin ? undefined : { bookListReturnTo },
        })
        return
      }

      await invalidateQueries
      if (response.coverError) {
        toast.warning(`Book saved, but cover failed: ${response.coverError}`)
      } else {
        toast.success('Book updated.')
      }
      void navigate(admin ? '/admin' : `/books/${response.id}`, {
        replace: true,
        state: admin ? undefined : { bookListReturnTo },
      })
    },
    onError: (error) => {
      toast.error(error instanceof HttpError ? error.apiError.detail : error.message)
    },
  })

  const errors = form.formState.errors
  const isLoadingDictionaries =
    typesQuery.isLoading || statusesQuery.isLoading || genresQuery.isLoading
  const isLoadingBook = mode === 'edit' && bookQuery.isLoading
  const formReady = !isLoadingDictionaries && !isLoadingBook

  useEffect(() => {
    if (!formReady) {
      return
    }
    // Links like "Rate it" or "Add one" on the details page open the form at a field.
    const target = location.hash ? document.getElementById(location.hash.slice(1)) : null
    if (target) {
      target.scrollIntoView({ block: 'center' })
      target.querySelector<HTMLElement>('button, textarea, input')?.focus()
      if (target instanceof HTMLTextAreaElement) target.focus()
      return
    }
    form.setFocus('primaryTitle')
  }, [form, formReady, location.hash])
  const currentCover = bookQuery.data?.cover
  const visibleCoverUrl =
    mode === 'create'
      ? (draftCover?.previewUrl ?? null)
      : (draftCover?.previewUrl ??
        (existingCoverChange.kind === 'remove' ? null : resolvedCoverUrl))
  const effectiveCurrentCover =
    mode === 'edit' && (existingCoverChange.kind === 'remove' || draftCover) ? null : currentCover
  const displayCoverFailure = getDisplayCoverFailure(effectiveCurrentCover?.failureReason)
  const coverInfo: CoverInfoItem[] =
    mode === 'create'
      ? [
          draftCover ? { text: 'Status: Ready to save' } : { text: 'Status: Missing' },
          draftCover?.kind === 'file'
            ? { text: 'Source: Upload' }
            : draftCover?.kind === 'url'
              ? { text: 'Source: URL' }
              : null,
          draftCover?.kind === 'url' ? { text: draftCover.imageUrl, truncate: true } : null,
        ].filter(isCoverInfoItem)
      : draftCover
        ? [
            { text: 'Status: Will replace on save' },
            draftCover.kind === 'file' ? { text: 'Source: Upload' } : { text: 'Source: URL' },
            draftCover.kind === 'url' ? { text: draftCover.imageUrl, truncate: true } : null,
          ].filter(isCoverInfoItem)
        : effectiveCurrentCover
          ? [
              {
                text: `Status: ${getDisplayCoverStatus(effectiveCurrentCover.status, effectiveCurrentCover.failureReason)}`,
              },
              effectiveCurrentCover.source
                ? { text: `Source: ${effectiveCurrentCover.source}` }
                : null,
              displayCoverFailure ? { text: displayCoverFailure } : null,
            ].filter(isCoverInfoItem)
          : existingCoverChange.kind === 'remove'
            ? [{ text: 'Status: Will be removed on save' }]
            : [{ text: 'Status: Missing' }]
  const backHref = admin ? '/admin' : mode === 'edit' && id ? `/books/${id}` : '/books'

  if (isLoadingDictionaries || isLoadingBook) {
    return (
      <div className="rounded-panel border border-line bg-surface p-6 text-ink-3">
        Loading form...
      </div>
    )
  }

  const typeName = selectedType?.name ?? typesQuery.data?.data[0]?.name ?? 'Novel'
  const statusTone = getStatusTone(selectedStatus?.name ?? '')
  const lastLogged = getProgressHistoryWithDeltas(bookQuery.data?.progressHistory ?? [])[0]
    ?.changedAt
  const isDirty =
    form.formState.isDirty ||
    draftCover !== null ||
    existingCoverChange.kind === 'remove' ||
    (publishChoice !== null && publishChoice !== isListed)
  const dirtyText = isDirty ? 'Unsaved changes' : mode === 'create' ? 'New book' : 'No changes yet'
  const saveText = mutation.isPending
    ? 'Saving…'
    : mode === 'create'
      ? 'Add to library'
      : 'Save changes'

  return (
    <>
      <form
        className="flex w-full flex-col gap-6"
        data-testid="book-form"
        noValidate
        onSubmit={(event) => void form.handleSubmit((values) => mutation.mutate(values))(event)}
      >
        <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-2">
          <Link
            className="inline-flex w-fit items-center gap-1.5 text-ink-2 hover:text-ink"
            state={admin ? undefined : { bookListReturnTo }}
            to={backHref}
          >
            <ArrowLeft aria-hidden="true" className="size-4" />
            {admin ? 'Administration' : mode === 'edit' ? 'Book' : 'Library'}
          </Link>
          <h1 className="m-0 font-display text-4xl leading-tight font-bold tracking-tight">
            {admin ? 'Admin edit' : mode === 'create' ? 'Add book' : 'Edit book'}
          </h1>
        </div>

        {mode === 'create' && !admin ? (
          <div className="mx-auto flex w-full max-w-[1440px] flex-wrap items-center gap-3 rounded-xl border border-dashed border-line-focus bg-surface px-4 py-3.5">
            <Link2 aria-hidden="true" className="size-5 shrink-0 text-ink" />
            <div className="min-w-[240px] flex-1">
              <div className="font-semibold">Fill from a page</div>
              <div className="text-[13px] text-ink-3">
                Paste a book page&apos;s HTML (NovelUpdates and similar), then pick which title, alt
                titles, author, genres, tags, description and cover to use.
              </div>
            </div>
            <Button variant="primary" onClick={() => setHtmlParseDialogOpen(true)}>
              Parse HTML
            </Button>
          </div>
        ) : null}

        <div className="mx-auto flex w-full max-w-[1440px] flex-wrap items-start gap-8">
          <div className="min-w-0 flex-[999_1_560px] rounded-panel border border-line bg-surface">
            <FormSection title="Identity">
              <Field error={errors.primaryTitle?.message} label="Title" required>
                <input
                  aria-label="Primary title"
                  aria-invalid={errors.primaryTitle ? 'true' : undefined}
                  className={cn(fieldClass, 'font-display text-lg font-semibold')}
                  {...form.register('primaryTitle')}
                />
              </Field>

              <Field label="Alternative titles">
                <div className="flex flex-col gap-1.5">
                  {alternativeTitles.map((title, index) => (
                    <div
                      className="flex items-center gap-2 rounded-control border border-line bg-sunk py-1 pr-1 pl-3"
                      key={index}
                    >
                      <input
                        aria-label={`Alternative title ${index + 1}`}
                        className="h-8 min-w-0 flex-1 border-0 bg-transparent text-ink outline-none"
                        data-alt-title-index={index}
                        value={title}
                        onChange={(event) =>
                          setAlternativeTitles(
                            alternativeTitles.map((current, position) =>
                              position === index ? event.target.value : current,
                            ),
                          )
                        }
                      />
                      <button
                        aria-label={`Remove alternative title ${title || index + 1}`}
                        className={removeButtonClass}
                        type="button"
                        onClick={() =>
                          setAlternativeTitles(
                            alternativeTitles.filter((_, position) => position !== index),
                          )
                        }
                      >
                        <X aria-hidden="true" className="size-3.5" strokeWidth={2.2} />
                      </button>
                    </div>
                  ))}
                  <button
                    className={addRowButtonClass}
                    type="button"
                    onClick={() => {
                      setAlternativeTitles([...alternativeTitles, ''])
                      focusLater(`[data-alt-title-index="${alternativeTitles.length}"]`)
                    }}
                  >
                    + Add alternative title
                  </button>
                </div>
              </Field>

              <Field
                error={errors.authorName?.message}
                hint="Picks from your existing authors as you type; new names are created on save."
                label="Author"
              >
                <div className="relative">
                  <input
                    aria-label="Author"
                    autoComplete="off"
                    className={fieldClass}
                    name="authorName"
                    value={authorInputValue}
                    onBlur={handleAuthorBlur}
                    onChange={(event) => {
                      form.setValue('authorName', event.target.value, {
                        shouldDirty: true,
                        shouldValidate: true,
                      })
                      form.setValue('authorId', '', { shouldDirty: true, shouldValidate: true })
                      setSelectedAuthorDisplay(null)
                      setAuthorSuggestionsOpen(true)
                    }}
                    onFocus={() => setAuthorSuggestionsOpen(true)}
                  />
                  {authorSuggestionsOpen && trimmedAuthorName.length >= 2 ? (
                    <div aria-busy={authorSearchPending} className={popoverClass}>
                      {authorSearchPending && !authorSuggestionsQuery.data?.length ? (
                        <div className="px-3 py-2 text-sm text-ink-3">Searching authors...</div>
                      ) : null}
                      {authorSuggestionsQuery.data?.map((author) => {
                        const matchedAlias = findMatchingAlias(author, authorName)
                        return (
                          <button
                            className="grid w-full gap-0.5 rounded-control border-0 bg-transparent px-3 py-2 text-left text-sm text-ink hover:bg-hover"
                            key={author.id}
                            type="button"
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => selectAuthor(author)}
                          >
                            <span className="flex items-center justify-between gap-2 font-medium">
                              <span>{formatAuthorDisplay(author.primaryName, matchedAlias)}</span>
                              <span className="text-[10px] font-semibold tracking-[0.14em] text-ink-3 uppercase">
                                {author.isPublic ? 'Public' : 'Private'}
                              </span>
                            </span>
                            {author.otherNames.length ? (
                              <span className="text-xs text-ink-3">
                                {author.otherNames.slice(0, 3).join(', ')}
                              </span>
                            ) : null}
                          </button>
                        )
                      })}
                      {!authorSearchPending && authorSuggestionsQuery.data?.length === 0 ? (
                        <div className="px-3 py-2 text-sm text-ink-3">
                          No author found. A new one will be created.
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </Field>

              <div className="flex flex-wrap gap-[18px]">
                <ChoiceGroup
                  className="flex-[1_1_300px]"
                  error={errors.contentTypeId?.message}
                  hint={selectedType?.description}
                  label="Type"
                  options={(typesQuery.data?.data ?? []).map((type) => ({
                    id: type.id,
                    label: type.name,
                  }))}
                  value={selectedTypeId}
                  onChange={(value) =>
                    form.setValue('contentTypeId', value, {
                      shouldDirty: true,
                      shouldValidate: true,
                    })
                  }
                />
                <ChoiceGroup
                  className="flex-[1_1_360px]"
                  error={errors.statusId?.message}
                  hint={selectedStatus?.description}
                  label="Status"
                  options={(statusesQuery.data?.data ?? []).map((status) => ({
                    id: status.id,
                    label: status.name,
                    dotClass: statusToneClasses[getStatusTone(status.name)].bar,
                  }))}
                  value={selectedStatusId}
                  onChange={(value) =>
                    form.setValue('statusId', value, { shouldDirty: true, shouldValidate: true })
                  }
                />
              </div>
            </FormSection>

            <FormSection
              aside={
                lastLogged
                  ? `Last logged ${formatShortDate(lastLogged)} · history keeps every change`
                  : 'History keeps every change'
              }
              title="Progress"
            >
              <div className="grid gap-3.5 md:grid-cols-3">
                <Field
                  error={errors.currentChapterNumber?.message}
                  hint="Every finished chapter counts, so 32.1 and 32.2 are two."
                  label="Chapters read"
                  required
                >
                  <input
                    aria-label="Current chapter"
                    aria-invalid={errors.currentChapterNumber ? 'true' : undefined}
                    className={cn(fieldClass, 'tabular-nums')}
                    inputMode="numeric"
                    name="currentChapterNumber"
                    value={currentChapterNumber}
                    onChange={(event) =>
                      setIntegerFieldValue('currentChapterNumber', event.target.value)
                    }
                  />
                </Field>
                <Field
                  error={errors.currentChapterLabel?.message}
                  hint="The name of the last chapter you finished, as the source writes it."
                  label="Label in source"
                >
                  <input
                    aria-label="Label in source"
                    className={fieldClass}
                    placeholder="v5c34, 32.2, ex4"
                    {...form.register('currentChapterLabel')}
                  />
                </Field>
                <Field
                  error={errors.totalChapters?.message}
                  hint="Leave empty while the series is still ongoing."
                  label="Total chapters"
                >
                  <input
                    aria-label="Total chapters"
                    aria-invalid={errors.totalChapters ? 'true' : undefined}
                    className={cn(fieldClass, 'tabular-nums')}
                    inputMode="decimal"
                    name="totalChapters"
                    placeholder="Unknown"
                    value={totalChapters}
                    onBlur={() => void form.trigger('totalChapters')}
                    onChange={(event) => setNumericFieldValue('totalChapters', event.target.value)}
                  />
                </Field>
              </div>
              <ProgressPreview
                chapterLabel={currentChapterLabel}
                chaptersRead={currentChapterNumber}
                finished={statusTone === 'finished'}
                tone={statusTone}
                total={totalChapters}
              />
            </FormSection>

            <section
              aria-label="Your take"
              className="flex flex-wrap gap-6 border-b border-line p-6"
            >
              <fieldset className="m-0 min-w-0 flex-[2_1_380px] border-0 p-0" id="rating">
                <legend className="mb-2 p-0 font-medium">Rating</legend>
                <div className="flex flex-wrap gap-1" role="group" aria-label="Rating">
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((value) => (
                    <ScaleButton
                      key={value}
                      label={`Set rating to ${value}/10`}
                      pressed={rating === String(value)}
                      value={value}
                      onClick={() =>
                        form.setValue('rating', rating === String(value) ? '' : String(value), {
                          shouldDirty: true,
                          shouldValidate: true,
                        })
                      }
                    />
                  ))}
                  <button
                    className="h-10 rounded-control border-0 bg-transparent px-2.5 text-ink-3 hover:text-ink disabled:opacity-50"
                    disabled={!rating}
                    type="button"
                    onClick={() =>
                      form.setValue('rating', '', { shouldDirty: true, shouldValidate: true })
                    }
                  >
                    Clear
                  </button>
                </div>
                <FieldError message={errors.rating?.message} />
              </fieldset>
              <fieldset className="m-0 min-w-0 flex-[1_1_240px] border-0 p-0">
                <legend className="mb-2 p-0 font-medium">
                  Priority{' '}
                  <span className="text-[13px] font-normal text-ink-3">· 1 is next up</span>
                </legend>
                <div className="flex gap-1" role="group" aria-label="Priority">
                  {[1, 2, 3, 4, 5].map((value) => (
                    <ScaleButton
                      key={value}
                      label={`Set priority to ${value}`}
                      pressed={priority === String(value)}
                      value={value}
                      onClick={() =>
                        form.setValue('priority', priority === String(value) ? '' : String(value), {
                          shouldDirty: true,
                          shouldValidate: true,
                        })
                      }
                    />
                  ))}
                </div>
                <FieldError message={errors.priority?.message} />
              </fieldset>
            </section>

            <FormSection title="Genres & tags">
              <Field count={selectedGenreIds.length} label="Genres">
                <GenreChipSelect
                  options={genresQuery.data?.data ?? []}
                  selectedIds={selectedGenreIds}
                  onChange={setSelectedGenreIds}
                />
              </Field>
              <Field
                count={selectedTags.length}
                countNote="◆ global tag managed by admin"
                error={errors.tagsText?.message}
                label="Tags"
              >
                <TagChipSelect selected={selectedTags} onChange={setSelectedTags} />
              </Field>
            </FormSection>

            <FormSection last title="Details">
              <Field error={errors.description?.message} label="Description">
                <textarea
                  aria-label="Description"
                  className={textareaClass}
                  rows={4}
                  {...form.register('description')}
                />
              </Field>
              <Field label="Links">
                <div className="flex flex-col gap-2">
                  {links.map((link, index) => (
                    <div
                      className="grid grid-cols-[minmax(0,1fr)_minmax(0,2.4fr)_40px] items-center gap-2"
                      key={index}
                    >
                      <input
                        aria-label={`Link ${index + 1} label`}
                        className={fieldClass}
                        placeholder="Label"
                        value={link.label}
                        onChange={(event) => updateLink(index, { label: event.target.value })}
                      />
                      <input
                        aria-label={`Link ${index + 1} URL`}
                        className={cn(fieldClass, 'font-mono text-[13px]')}
                        data-link-index={index}
                        inputMode="url"
                        placeholder="https://"
                        value={link.url}
                        onChange={(event) => updateLink(index, { url: event.target.value })}
                      />
                      <button
                        aria-label={`Remove link ${link.label || link.url || index + 1}`}
                        className={cn(removeButtonClass, 'size-10')}
                        type="button"
                        onClick={() => setLinks(links.filter((_, position) => position !== index))}
                      >
                        <X aria-hidden="true" className="size-4" />
                      </button>
                    </div>
                  ))}
                  <button
                    className={addRowButtonClass}
                    type="button"
                    onClick={() => {
                      setLinks([...links, emptyBookFormLink()])
                      focusLater(`[data-link-index="${links.length}"]`)
                    }}
                  >
                    + Add link
                  </button>
                </div>
              </Field>
              <Field error={errors.notes?.message} label="Private notes">
                <textarea
                  aria-label="Private notes"
                  className={textareaClass}
                  id="notes"
                  placeholder="Only you see these."
                  rows={3}
                  {...form.register('notes')}
                />
              </Field>
            </FormSection>
          </div>

          <aside
            className="flex w-full flex-[1_1_300px] flex-col gap-4 lg:max-w-[380px]"
            data-testid="book-form-rail"
          >
            <div
              className="flex flex-col gap-3 rounded-panel border border-line bg-surface p-4"
              data-testid="book-cover-editor"
            >
              <span className="font-medium">Cover</span>
              <BookCoverArtwork
                className="w-full rounded-lg"
                cover={mode === 'edit' ? effectiveCurrentCover : null}
                imageUrl={visibleCoverUrl}
                interactive={Boolean(visibleCoverUrl)}
                placeholder={
                  <TypeCoverPlaceholder
                    contentType={typeName}
                    title={primaryTitle || 'New book'}
                    titleClassName="bottom-4 text-[26px]"
                  />
                }
                removeLabel="Remove cover"
                title={primaryTitle || 'Book cover'}
                onClick={() => setCoverPreviewOpen(true)}
                onRemove={() => {
                  if (mode === 'create') {
                    replaceDraftCover(null)
                    return
                  }

                  if (draftCover) {
                    replaceDraftCover(null)
                    setExistingCoverChange({ kind: 'keep' })
                    toast.success('Draft cover removed.')
                    return
                  }

                  setExistingCoverChange({ kind: 'remove' })
                  toast.success('Cover will be removed after saving the book.')
                }}
              />
              <CoverDropzone
                info={coverInfo}
                infoErrorText={displayCoverFailure}
                onFile={storeDraftFile}
                onUrl={storeDraftUrl}
              />
            </div>

            {!admin ? (
              <div className="flex flex-col gap-2.5 rounded-panel border border-line bg-surface p-4">
                <span className="font-medium">Public snapshot</span>
                <label className="flex items-start gap-2.5 text-ink-2">
                  <input
                    checked={publishChoice ?? isListed}
                    className="mt-0.5 size-[18px] shrink-0"
                    disabled={mode === 'edit' && listingQuery.isPending}
                    type="checkbox"
                    onChange={(event) => setPublishChoice(event.target.checked)}
                  />
                  <span>
                    Share a copy in Discover. Your progress, rating and notes stay private.
                    {listing ? (
                      <span className="mt-1 block text-xs text-ink-3">
                        Listed since {formatShortDate(listing.snapshotAt)}. Refresh the copy in
                        Manage after bigger edits.
                      </span>
                    ) : null}
                  </span>
                </label>
              </div>
            ) : null}

            {mode === 'edit' && !admin ? (
              <div className="flex flex-col items-start gap-2.5 rounded-panel border border-danger-line p-4">
                <span className="font-medium text-danger-ink">Delete book</span>
                <span className="text-[13px] text-ink-3">
                  Removes the book, its progress history, files and cover.
                </span>
                <Button
                  disabled={deleteMutation.isPending}
                  size="sm"
                  variant="danger"
                  onClick={() => setDeleteConfirmOpen(true)}
                >
                  Delete…
                </Button>
              </div>
            ) : null}
          </aside>
        </div>

        <div className="sticky bottom-[76px] z-20 -mx-4 border-t border-line bg-sunk/95 px-4 py-3.5 backdrop-blur-md md:bottom-0 md:-mx-8 md:px-8">
          <div className="mx-auto flex w-full max-w-[1440px] flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-2 text-ink-2" role="status">
              <span
                aria-hidden="true"
                className={cn('size-2 rounded-full', isDirty ? 'bg-accent' : 'bg-line-strong')}
              />
              {dirtyText}
            </span>
            <span className="flex-1" />
            <Link
              className={buttonStyles({ variant: 'outline' })}
              state={admin ? undefined : { bookListReturnTo }}
              to={backHref}
            >
              Cancel
            </Link>
            <Button disabled={mutation.isPending} type="submit" variant="primary">
              {saveText}
            </Button>
          </div>
        </div>
      </form>

      {mode === 'create' && !admin ? (
        <BookHtmlParseDialog
          currentValues={form.getValues()}
          hasDraftCover={Boolean(draftCover)}
          open={htmlParseDialogOpen}
          onApply={applyParsedHtml}
          onClose={() => setHtmlParseDialogOpen(false)}
        />
      ) : null}
      <CoverLightbox
        emptyLabel="No cover has been saved for this book yet."
        imageUrl={visibleCoverUrl}
        open={coverPreviewOpen}
        title={primaryTitle || 'Book cover'}
        onClose={() => setCoverPreviewOpen(false)}
      />
      <Dialog
        dismissible={!deleteMutation.isPending}
        footer={
          <>
            <span className="flex-1" />
            <Button
              disabled={deleteMutation.isPending}
              variant="outline"
              onClick={() => setDeleteConfirmOpen(false)}
            >
              Cancel
            </Button>
            <Button
              disabled={deleteMutation.isPending}
              variant="danger"
              onClick={() => deleteMutation.mutate()}
            >
              {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
            </Button>
          </>
        }
        open={deleteConfirmOpen}
        title="Delete book"
        widthClassName="max-w-md"
        onClose={() => setDeleteConfirmOpen(false)}
      >
        <p className="m-0 px-6 py-4 leading-relaxed text-ink-2">
          Delete <strong className="font-semibold text-ink">{primaryTitle}</strong>? Its reading
          history, EPUB files and cover go too. This cannot be undone.
        </p>
      </Dialog>
    </>
  )
}

const removeButtonClass =
  'flex size-8 shrink-0 items-center justify-center rounded-pill border-0 bg-transparent text-ink-3 hover:bg-hover hover:text-ink'

const addRowButtonClass =
  'h-9 self-start rounded-control border border-dashed border-line-strong bg-transparent px-3 text-ink-2 hover:border-line-focus hover:text-ink'

const popoverClass =
  'absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-field border border-line-strong bg-raised p-1 shadow-popover'

/** Focuses an element rendered by the next state update (a newly added row). */
function focusLater(selector: string) {
  window.setTimeout(() => {
    document.querySelector<HTMLElement>(selector)?.focus()
  }, 0)
}

function FormSection({
  title,
  aside,
  last = false,
  children,
}: {
  title: string
  aside?: string | undefined
  last?: boolean
  children: ReactNode
}) {
  return (
    <section className={cn('flex flex-col gap-[18px] p-6', !last && 'border-b border-line')}>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="m-0 text-base font-semibold">{title}</h2>
        {aside ? <span className="text-[13px] text-ink-3">{aside}</span> : null}
      </div>
      {children}
    </section>
  )
}

function Field({
  label,
  required = false,
  hint,
  error,
  count,
  countNote,
  children,
}: {
  label: string
  required?: boolean
  hint?: string | null | undefined
  error?: string | undefined
  count?: number | undefined
  countNote?: string | undefined
  children: ReactNode
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="font-medium">
        {label}
        {required ? (
          <span aria-hidden="true" className="text-ink">
            {' '}
            *
          </span>
        ) : null}
        {count !== undefined ? (
          <span className="text-[13px] font-normal text-ink-3">
            {' '}
            · {count}
            {countNote ? ` · ${countNote}` : null}
          </span>
        ) : null}
      </span>
      {children}
      {hint ? <span className="text-xs text-ink-3">{hint}</span> : null}
      <FieldError message={error} />
    </div>
  )
}

function FieldError({ message }: { message?: string | undefined }) {
  if (!message) return null
  return (
    <span aria-live="polite" className="text-[13px] text-danger-ink" role="alert">
      {message}
    </span>
  )
}

function ChoiceGroup({
  label,
  options,
  value,
  hint,
  error,
  className,
  onChange,
}: {
  label: string
  options: { id: string; label: string; dotClass?: string }[]
  value: string
  hint?: string | null | undefined
  error?: string | undefined
  className?: string
  onChange: (value: string) => void
}) {
  return (
    <fieldset className={cn('m-0 flex min-w-0 flex-col gap-1.5 border-0 p-0', className)}>
      <legend className="mb-1.5 p-0 font-medium">{label}</legend>
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => {
          const pressed = option.id === value
          return (
            <button
              aria-pressed={pressed}
              className={cn(
                'inline-flex h-10 items-center gap-2 rounded-control border px-3.5 text-ink',
                pressed
                  ? 'border-line-focus bg-selected font-semibold'
                  : 'border-line-strong bg-transparent font-medium hover:bg-hover',
              )}
              key={option.id}
              type="button"
              onClick={() => onChange(option.id)}
            >
              {option.dotClass ? (
                <span aria-hidden="true" className={cn('size-2 rounded-full', option.dotClass)} />
              ) : null}
              {option.label}
            </button>
          )
        })}
      </div>
      {hint ? <span className="text-xs text-ink-3">{hint}</span> : null}
      <FieldError message={error} />
    </fieldset>
  )
}

function ScaleButton({
  value,
  label,
  pressed,
  onClick,
}: {
  value: number
  label: string
  pressed: boolean
  onClick: () => void
}) {
  return (
    <button
      aria-label={label}
      aria-pressed={pressed}
      className={cn(
        'size-10 rounded-control border font-semibold tabular-nums',
        pressed
          ? 'border-accent bg-accent text-accent-ink'
          : 'border-line-strong bg-transparent text-ink hover:bg-hover',
      )}
      title={label}
      type="button"
      onClick={onClick}
    >
      {value}
    </button>
  )
}

/** "In library" preview: how the progress will read in the list. */
function ProgressPreview({
  chaptersRead,
  chapterLabel,
  total,
  finished,
  tone,
}: {
  chaptersRead: string
  chapterLabel: string | undefined
  total: string
  finished: boolean
  tone: ReturnType<typeof getStatusTone>
}) {
  const read = Number(chaptersRead) || 0
  const totalNumber = Number(total) || 0
  const percent = finished ? 100 : totalNumber ? Math.min(100, (read / totalNumber) * 100) : null
  const format = (value: number) => value.toLocaleString('en-US')
  const trimmedLabel = chapterLabel?.trim() ?? ''
  const label =
    trimmedLabel !== '' ? trimmedLabel : chaptersRead.trim() !== '' ? chaptersRead.trim() : '—'
  const count = finished
    ? `${format(read)} chapters`
    : totalNumber
      ? `${format(read)} / ${format(totalNumber)} · ${Math.round(percent ?? 0)}%`
      : `${format(read)} read · total unknown`

  return (
    <div className="flex items-center gap-4 rounded-field border border-line bg-sunk px-3.5 py-3">
      <span className="shrink-0 text-xs font-semibold tracking-[0.05em] text-ink-3 uppercase">
        In library
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 tabular-nums">
          <span className={cn('font-semibold', finished && 'text-status-finished-ink')}>
            {finished ? 'Finished' : `Ch. ${label}`}
          </span>
          <span className="truncate text-[13px] text-ink-3">{count}</span>
        </div>
        <div
          aria-hidden="true"
          className={cn(
            'mt-1.5 h-1 overflow-hidden rounded-full',
            percent == null
              ? 'bg-[repeating-linear-gradient(90deg,var(--color-line)_0_6px,transparent_6px_10px)]'
              : 'bg-line',
          )}
        >
          {percent != null ? (
            <div
              className={cn('h-full rounded-full', statusToneClasses[tone].bar)}
              style={{ width: `${percent}%` }}
            />
          ) : null}
        </div>
      </div>
    </div>
  )
}

/** Drop an image, choose a file or paste a URL; the cover is saved with the book. */
function CoverDropzone({
  info,
  infoErrorText,
  onFile,
  onUrl,
}: {
  info: CoverInfoItem[]
  infoErrorText: string | null | undefined
  onFile: (file: File) => void
  onUrl: (url: string) => void
}) {
  const [dragging, setDragging] = useState(false)
  const [urlOpen, setUrlOpen] = useState(false)
  const [url, setUrl] = useState('')

  function submitUrl() {
    const trimmed = url.trim()
    if (!trimmed) return
    onUrl(trimmed)
    setUrl('')
    setUrlOpen(false)
  }

  return (
    <div
      className={cn(
        'flex flex-col items-center gap-1.5 rounded-lg border border-dashed p-3.5 text-center',
        dragging ? 'border-line-focus bg-hover' : 'border-line-strong',
      )}
      onDragLeave={() => setDragging(false)}
      onDragOver={(event) => {
        event.preventDefault()
        setDragging(true)
      }}
      onDrop={(event) => {
        event.preventDefault()
        setDragging(false)
        const file = event.dataTransfer.files[0]
        if (file) onFile(file)
      }}
    >
      <Upload aria-hidden="true" className="size-5 text-ink-2" />
      <span>
        Drop an image,{' '}
        <label className="cursor-pointer text-ink underline underline-offset-[3px]">
          choose a file
          <input
            accept="image/jpeg,image/png,image/webp"
            aria-label="Choose a cover file"
            className="sr-only"
            type="file"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) {
                onFile(file)
                event.target.value = ''
              }
            }}
          />
        </label>{' '}
        or{' '}
        <button
          className="border-0 bg-transparent p-0 text-ink underline underline-offset-[3px]"
          type="button"
          onClick={() => setUrlOpen(!urlOpen)}
        >
          paste a URL
        </button>
      </span>
      {urlOpen ? (
        <div className="mt-1 flex w-full gap-2">
          <input
            aria-label="Cover image URL"
            className={cn(fieldClass, 'h-10 text-sm')}
            placeholder="https://example.com/cover.jpg"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                submitUrl()
              }
            }}
          />
          <Button disabled={!url.trim()} size="sm" variant="secondary" onClick={submitUrl}>
            Use URL
          </Button>
        </div>
      ) : null}
      <span className="text-xs text-ink-3">JPG, PNG or WebP · the link is also added to Links</span>
      {info.map((item) => (
        <span
          className={cn(
            'max-w-full text-xs',
            item.text === infoErrorText ? 'text-danger-ink' : 'text-ink-3',
            item.truncate && 'truncate',
          )}
          key={item.text}
          title={item.truncate ? item.text : undefined}
        >
          {item.text}
        </span>
      ))}
    </div>
  )
}

function formatShortDate(value: string) {
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(new Date(value))
}

function normalizeAuthorName(value: string) {
  return value.trim().toLocaleUpperCase()
}

function sanitizeDecimalInput(value: string) {
  const trimmedLeadingWhitespace = value.replace(/^\s+/, '')
  const digitsAndDotsOnly = trimmedLeadingWhitespace.replace(/[^\d.]/g, '')
  const [integerPart = '', ...fractionParts] = digitsAndDotsOnly.split('.')
  const fraction = fractionParts.join('')
  return fractionParts.length > 0 ? `${integerPart}.${fraction}` : integerPart
}

function sanitizeIntegerInput(value: string) {
  return value.replace(/\D/g, '')
}

function isAllowedCoverFile(file: File) {
  const lowerName = file.name.toLocaleLowerCase()
  const extensionAllowed = Array.from(allowedCoverExtensions).some((extension) =>
    lowerName.endsWith(extension),
  )
  return allowedCoverMimeTypes.has(file.type) && extensionAllowed
}

function isCoverInfoItem(value: CoverInfoItem | null): value is CoverInfoItem {
  return value !== null
}

function GenreChipSelect({
  options,
  selectedIds,
  onChange,
}: {
  options: { id: string; name: string; description?: string | null | undefined }[]
  selectedIds: string[]
  onChange: (value: string[]) => void
}) {
  const [input, setInput] = useState('')
  const selected = options.filter((option) => selectedIds.includes(option.id))
  const suggestions = options
    .filter((option) => !selectedIds.includes(option.id))
    .filter((option) => option.name.toLocaleLowerCase().includes(input.trim().toLocaleLowerCase()))
    .slice(0, 8)

  function addGenre(id: string) {
    onChange([...selectedIds, id])
    setInput('')
  }

  return (
    <ChipBox
      input={input}
      ariaLabel="Add genre"
      placeholder="Add genre…"
      selected={selected.map((option) => ({ key: option.id, label: option.name }))}
      suggestions={suggestions.map((option) => ({
        key: option.id,
        label: option.name,
        description: option.description,
      }))}
      onCreate={undefined}
      onInputChange={setInput}
      onPick={addGenre}
      onRemove={(selectedId) => onChange(selectedIds.filter((id) => id !== selectedId))}
    />
  )
}

function TagChipSelect({
  selected,
  onChange,
}: {
  selected: string[]
  onChange: (value: string[]) => void
}) {
  const [input, setInput] = useState('')
  const trimmedInput = input.trim()
  const debouncedInput = useDebouncedValue(trimmedInput, suggestionSearchDelayMs)
  const tagSuggestionsQuery = useQuery({
    queryKey: ['tagSuggestions', debouncedInput],
    queryFn: () => api.searchTags(debouncedInput, 8),
    enabled: debouncedInput.length >= 1,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  })
  const suggestionsPending = trimmedInput !== debouncedInput || tagSuggestionsQuery.isFetching
  const normalizedSelected = selected.map((tag) => tag.toLocaleLowerCase())
  const suggestions = (tagSuggestionsQuery.data ?? [])
    .filter((tag) => !normalizedSelected.includes(tag.name.toLocaleLowerCase()))
    .map((tag) => ({
      key: tag.name,
      label: tag.name,
      description: tag.description,
      global: tag.isGlobal,
    }))

  function addTag(value: string) {
    const tag = value.trim()
    if (!tag || normalizedSelected.includes(tag.toLocaleLowerCase())) {
      setInput('')
      return
    }

    onChange([...selected, tag])
    setInput('')
  }

  return (
    <ChipBox
      input={input}
      ariaLabel="Add tag"
      collapseAfter={12}
      placeholder="Add tag…"
      variant="tag"
      selected={selected.map((tag) => ({ key: tag, label: tag }))}
      suggestions={suggestions}
      onCreate={addTag}
      onInputChange={setInput}
      suggestionsPending={suggestionsPending}
      onPick={addTag}
      onRemove={(tag) => onChange(selected.filter((selectedTag) => selectedTag !== tag))}
    />
  )
}

function ChipBox({
  ariaLabel,
  input,
  placeholder,
  selected,
  suggestions,
  onInputChange,
  onPick,
  onRemove,
  onCreate,
  suggestionsPending = false,
  variant = 'genre',
  collapseAfter,
}: {
  ariaLabel: string
  input: string
  placeholder: string
  selected: { key: string; label: string }[]
  suggestions: {
    key: string
    label: string
    description?: string | null | undefined
    global?: boolean | undefined
  }[]
  /** Genres are solid chips, tags lighter ones (as on the details page). */
  variant?: 'genre' | 'tag'
  /** Shows only this many chips until "Show all N". */
  collapseAfter?: number | undefined
  onInputChange: (value: string) => void
  onPick: (key: string) => void
  onRemove: (key: string) => void
  onCreate?: ((value: string) => void) | undefined
  suggestionsPending?: boolean
}) {
  const trimmed = input.trim()
  const canCreate = Boolean(
    onCreate &&
    trimmed &&
    !suggestionsPending &&
    !suggestions.some((item) => item.label.toLocaleLowerCase() === trimmed.toLocaleLowerCase()),
  )
  const [activeIndex, setActiveIndex] = useState(0)
  const [showAll, setShowAll] = useState(false)
  const collapsed = collapseAfter !== undefined && !showAll && selected.length > collapseAfter
  const visibleChips = collapsed ? selected.slice(0, collapseAfter) : selected
  const activeIndexResetKey = JSON.stringify([
    input,
    suggestions.map((item) => item.key),
    canCreate,
  ])
  const [trackedResetKey, setTrackedResetKey] = useState(activeIndexResetKey)
  const listboxId = useId()
  const choiceCount = suggestions.length + (canCreate ? 1 : 0)

  if (trackedResetKey !== activeIndexResetKey) {
    setTrackedResetKey(activeIndexResetKey)
    setActiveIndex(0)
  }

  function pickActiveChoice() {
    const activeSuggestion = suggestions[activeIndex]
    if (activeSuggestion) {
      onPick(activeSuggestion.key)
      return
    }
    if (canCreate) {
      onCreate?.(trimmed)
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if ((event.key === 'Enter' || event.key === 'Tab') && trimmed && choiceCount > 0) {
      event.preventDefault()
      pickActiveChoice()
      return
    }

    if (event.key === 'ArrowDown' && choiceCount > 0) {
      event.preventDefault()
      setActiveIndex((current) => (current + 1) % choiceCount)
      return
    }

    if (event.key === 'ArrowUp' && choiceCount > 0) {
      event.preventDefault()
      setActiveIndex((current) => (current - 1 + choiceCount) % choiceCount)
      return
    }

    const lastSelected = selected.at(-1)
    if (event.key === 'Backspace' && !input && lastSelected) {
      event.preventDefault()
      onRemove(lastSelected.key)
    }
  }

  return (
    <div className="relative">
      <div className="flex min-h-11 flex-wrap items-center gap-1.5 rounded-control border border-line-strong bg-ground p-1.5 focus-within:border-ink">
        {visibleChips.map((item) => (
          <span
            className={cn(
              'inline-flex h-[30px] items-center gap-1 rounded-pill border pr-1 pl-2.5',
              variant === 'genre'
                ? 'border-line-strong bg-raised'
                : 'border-line bg-surface text-[13px]',
            )}
            key={item.key}
          >
            {item.label}
            <button
              aria-label={`Remove ${item.label}`}
              className="flex size-[22px] items-center justify-center rounded border-0 bg-transparent text-ink-3 hover:text-ink"
              type="button"
              onMouseDown={(event) => {
                event.preventDefault()
                event.stopPropagation()
              }}
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                onRemove(item.key)
              }}
            >
              <X aria-hidden="true" className="size-3" strokeWidth={2.4} />
            </button>
          </span>
        ))}
        {collapseAfter !== undefined && selected.length > collapseAfter ? (
          <button
            className="h-[30px] rounded-pill border-0 bg-transparent px-2.5 font-medium text-ink hover:underline"
            type="button"
            onClick={() => setShowAll(!showAll)}
          >
            {showAll ? 'Show fewer' : `Show all ${selected.length}`}
          </button>
        ) : null}
        <input
          aria-activedescendant={
            trimmed && choiceCount > 0 ? `${listboxId}-option-${activeIndex}` : undefined
          }
          aria-autocomplete="list"
          aria-controls={trimmed ? listboxId : undefined}
          aria-expanded={Boolean(trimmed)}
          aria-label={ariaLabel}
          className="h-[30px] min-w-[100px] flex-[1_1_120px] border-0 bg-transparent px-1 text-ink outline-none placeholder:text-ink-3"
          placeholder={placeholder}
          role="combobox"
          value={input}
          onChange={(event) => onInputChange(event.target.value)}
          onKeyDown={handleKeyDown}
        />
      </div>
      {trimmed ? (
        <div aria-busy={suggestionsPending} className={popoverClass} id={listboxId} role="listbox">
          {suggestions.map((item, index) => (
            <button
              aria-selected={activeIndex === index}
              className={`w-full rounded-control border-0 px-3 py-2 text-left text-sm text-ink hover:bg-hover ${activeIndex === index ? 'bg-selected' : 'bg-transparent'}`}
              id={`${listboxId}-option-${index}`}
              key={item.key}
              role="option"
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onPick(item.key)}
            >
              <span className="font-medium">
                {item.global ? (
                  <span aria-label="global" className="mr-1.5 text-[10px] text-status-reading-ink">
                    ◆
                  </span>
                ) : null}
                {item.label}
              </span>
              {item.description ? (
                <span className="mt-0.5 block text-xs text-ink-3">{item.description}</span>
              ) : null}
            </button>
          ))}
          {canCreate ? (
            <button
              aria-selected={activeIndex === suggestions.length}
              className={`w-full rounded-control border-0 px-3 py-2 text-left text-sm font-medium text-ink hover:bg-hover ${activeIndex === suggestions.length ? 'bg-selected' : 'bg-transparent'}`}
              id={`${listboxId}-option-${suggestions.length}`}
              role="option"
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onCreate?.(trimmed)}
            >
              Add "{trimmed}"
            </button>
          ) : null}
          {suggestionsPending && !suggestions.length ? (
            <div className="px-3 py-2 text-sm text-ink-3">Searching...</div>
          ) : null}
          {!suggestionsPending && !suggestions.length && !canCreate ? (
            <div className="px-3 py-2 text-sm text-ink-3">No results.</div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function mergeValues(existing: readonly string[], incoming: readonly string[]) {
  const result = [...existing]
  const known = new Set(existing.map((value) => value.trim().toLocaleLowerCase()))
  incoming.forEach((value) => {
    const clean = value.trim()
    const key = clean.toLocaleLowerCase()
    if (clean && !known.has(key)) {
      result.push(clean)
      known.add(key)
    }
  })
  return result
}

function appendCoverSourceLink(request: BookMutationRequest, cover?: BookCoverDto | null) {
  const sourceUrl = cover?.originalImageUrl?.trim()
  if (!sourceUrl || request.links.some((link) => sameUrl(link.url, sourceUrl))) {
    return request
  }

  return {
    ...request,
    links: [
      ...request.links,
      { url: sourceUrl, label: null, sourceType: 'Other', isPrimary: false, lastReadHere: false },
    ],
  }
}

function sameUrl(left: string, right: string) {
  return left.trim().localeCompare(right.trim(), undefined, { sensitivity: 'accent' }) === 0
}

function splitComma(value: string) {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function findMatchingAlias(author: AuthorDto, input: string) {
  const normalizedInput = normalizeAuthorName(input)
  if (!normalizedInput || normalizeAuthorName(author.primaryName) === normalizedInput) {
    return undefined
  }

  return (
    author.otherNames.find((name) => normalizeAuthorName(name) === normalizedInput) ??
    author.otherNames.find((name) => normalizeAuthorName(name).includes(normalizedInput))
  )
}

function formatAuthorDisplay(primaryName: string, matchedAlias?: string) {
  return matchedAlias ? `${primaryName} (${matchedAlias})` : primaryName
}
