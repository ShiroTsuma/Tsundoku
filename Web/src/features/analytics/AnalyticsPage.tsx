import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { addDays, format, isSameDay, parseISO, subMonths, subYears } from 'date-fns'
import { useEffect, useMemo, useRef, useState } from 'react'
import { DayPicker, type DateRange } from 'react-day-picker'
import { useSearchParams } from 'react-router-dom'
import { api } from '@/api/client'
import { getStoredSession } from '@/api/http'
import type { BookAnalyticsDto } from '@/api/types'
import { Button } from '@/components/ui/Button'
import { fieldClass } from '@/components/ui/fieldStyles'
import { SegmentButton } from '@/features/books/BookListControls'
import { cn } from '@/lib/utils'
import { formatAverageRating, formatChapterCount } from '@/features/books/bookFormatters'
import { BookSearchInput } from '@/features/books/BookSearchInput'
import { AnalyticsChartCard } from './AnalyticsChartCard'
import { ChapterVolumeChart } from './charts/ChapterVolumeChart'
import { chapterVolumeRows } from './charts/chapterVolumeData'
import { formatCount } from './charts/chartUtils'
import { CoverAvailabilityChart } from './charts/CoverAvailabilityChart'
import { coverAvailabilityRows } from './charts/coverAvailabilityData'
import { EstimatedReadingTimeChart } from './charts/EstimatedReadingTimeChart'
import { estimatedReadingTimeRows } from './charts/estimatedReadingTimeData'
import { LibraryGrowthChart } from './charts/LibraryGrowthChart'
import { libraryGrowthRows } from './charts/libraryGrowthData'
import { LinkSourcesChart } from './charts/LinkSourcesChart'
import { linkSourceRows } from './charts/linkSourcesData'
import { MetadataCompletenessChart } from './charts/MetadataCompletenessChart'
import { metadataCompletenessRows } from './charts/metadataCompletenessData'
import { PriorityByStatusChart } from './charts/PriorityByStatusChart'
import { priorityRows } from './charts/priorityByStatusData'
import { RatingDistributionChart } from './charts/RatingDistributionChart'
import { ratingRows } from './charts/ratingDistributionData'
import { ReadingActivityChart } from './charts/ReadingActivityChart'
import { readingActivityRows } from './charts/readingActivityData'
import { StatusByTypeChart } from './charts/StatusByTypeChart'
import { statusByTypeRows } from './charts/statusByTypeData'
import { TopRelationsChart } from './charts/TopRelationsChart'
import { relationRows } from './charts/topRelationsData'
import { extractAnalyticsDateFilters } from './dateQueryFilters'

type AnalyticsBucket = 'day' | 'week' | 'month'

const analyticsBuckets: AnalyticsBucket[] = ['day', 'week', 'month']
const bucketLabels: Record<AnalyticsBucket, string> = { day: 'Day', week: 'Week', month: 'Month' }
const analyticsRangePresets = [
  { label: 'Beginning', getFrom: (_today: Date) => null },
  { label: 'Last 2 years', getFrom: (today: Date) => subYears(today, 2) },
  { label: 'Last 1 year', getFrom: (today: Date) => subYears(today, 1) },
  { label: 'Last 6 months', getFrom: (today: Date) => subMonths(today, 6) },
  { label: 'Last 3 months', getFrom: (today: Date) => subMonths(today, 3) },
  { label: 'Last month', getFrom: (today: Date) => subMonths(today, 1) },
] as const

export function AnalyticsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const urlFilters = useMemo(() => getAnalyticsFilters(searchParams), [searchParams])
  const [draftFilters, setDraftFilters] = useState(urlFilters)
  const [draftSourceFilters, setDraftSourceFilters] = useState(urlFilters)
  const queryClient = useQueryClient()

  // Reset the draft whenever the URL filters change (adjusting state during render instead of in an effect).
  if (draftSourceFilters !== urlFilters) {
    setDraftSourceFilters(urlFilters)
    setDraftFilters(urlFilters)
  }

  const analyticsQuery = useQuery({
    queryKey: [
      'book-analytics',
      urlFilters.query,
      urlFilters.from,
      urlFilters.to,
      urlFilters.bucket,
    ],
    queryFn: () => api.getBookAnalytics(toAnalyticsRequest(urlFilters)),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  })
  const readingTimeSettingsQuery = useQuery({
    queryKey: ['reading-time-settings'],
    queryFn: api.getReadingTimeSettings,
    staleTime: 60_000,
  })
  const readingTimeSettingsMutation = useMutation({
    mutationFn: api.updateReadingTimeSettings,
    onSuccess: (settings) => queryClient.setQueryData(['reading-time-settings'], settings),
  })

  const data = analyticsQuery.data
  const readingTimeSettings = Object.fromEntries(
    (readingTimeSettingsQuery.data ?? []).map((setting) => [
      setting.contentType,
      setting.minutesPerChapter,
    ]),
  )
  const isInitialLoading = analyticsQuery.isLoading && !data

  function retryAnalytics() {
    void analyticsQuery.refetch()
  }
  const emptyMessage = getAnalyticsEmptyMessage(data, urlFilters.query)

  function applyFilters() {
    setSearchParams(createAnalyticsSearchParams(draftFilters))
  }

  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="m-0 font-display text-[40px] leading-tight font-bold tracking-tight">
            Stats
          </h1>
          <p className="m-0 mt-2 text-[15px] text-ink-2">
            Library metrics for the books that match the query, added in the date range.
          </p>
        </div>
        {analyticsQuery.isFetching && data ? (
          <span className="text-[13px] text-ink-3" role="status">
            Refreshing…
          </span>
        ) : null}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-0 flex-[1_1_420px] flex-col gap-1.5">
          <span className="text-[13px] font-medium text-ink-2">Query</span>
          <BookSearchInput
            appearance="compact"
            ariaLabel="Query"
            placeholder="author:Toika rating:>=8 -genre:romance"
            value={draftFilters.query}
            showHelp={false}
            onChange={(query) => setDraftFilters((current) => ({ ...current, query }))}
          />
        </div>
        <DateRangeChooser filters={draftFilters} onChange={setDraftFilters} />
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-ink-2" id="analytics-bucket-label">
            Bucket
          </span>
          <div
            aria-labelledby="analytics-bucket-label"
            className="flex h-11 items-center gap-0.5 rounded-field border border-line bg-surface p-[3px]"
            role="group"
          >
            {analyticsBuckets.map((bucket) => (
              <SegmentButton
                key={bucket}
                pressed={draftFilters.bucket === bucket}
                onClick={() => setDraftFilters((current) => ({ ...current, bucket }))}
              >
                {bucketLabels[bucket]}
              </SegmentButton>
            ))}
          </div>
        </div>
        <Button className="h-11" onClick={applyFilters}>
          Apply filters
        </Button>
      </div>

      {analyticsQuery.isError && !data ? (
        <div
          className="rounded-panel border border-danger-line bg-danger-soft p-4 text-danger-ink"
          role="alert"
        >
          <h2 className="m-0 text-base font-semibold">Could not load stats.</h2>
          <p className="m-0 mt-1 text-sm">Check the filters and try again.</p>
          <Button className="mt-3" size="sm" variant="danger" onClick={retryAnalytics}>
            Retry
          </Button>
        </div>
      ) : null}

      {emptyMessage ? (
        <div className="rounded-panel border border-dashed border-line p-4 text-sm text-ink-2">
          {emptyMessage}
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <MetricCard
          label="Total books"
          loading={isInitialLoading}
          value={data ? formatCount(data.overview.totalBooks) : '-'}
        />
        <MetricCard
          label="Rated"
          loading={isInitialLoading}
          value={data ? formatCount(data.overview.ratedBooks) : '-'}
        />
        <MetricCard
          label="Unrated"
          loading={isInitialLoading}
          value={data ? formatCount(data.overview.unratedBooks) : '-'}
        />
        <MetricCard
          label="Average rating"
          loading={isInitialLoading}
          value={data ? formatAverageRating(data.overview.averageRating) : '-'}
        />
        <MetricCard
          label="Current chapters"
          loading={isInitialLoading}
          value={data ? formatChapterCount(data.overview.currentChapters) : '-'}
        />
      </div>

      <div className="grid min-w-0 items-start gap-5 xl:grid-cols-2">
        <div className="grid min-w-0 gap-5" data-testid="analytics-left-column">
          <AnalyticsChartCard
            columns={['Type', 'Status', 'Books', 'Share of type']}
            dataTableEnabled={false}
            description="See which content types are concentrated in each reading status."
            emptyMessage="No status/type data for this analytics scope."
            isEmpty={!isInitialLoading && !statusByTypeRows(data).length}
            isError={analyticsQuery.isError && !!data}
            isLoading={isInitialLoading}
            rows={statusByTypeRows(data)}
            title="Status by type"
            onRetry={retryAnalytics}
          >
            <StatusByTypeChart data={data} />
          </AnalyticsChartCard>
          <AnalyticsChartCard
            columns={['Genre', 'Books', 'Share of books']}
            description="Find the genres that dominate the current filters."
            emptyMessage="No genre data for this analytics scope."
            isEmpty={!isInitialLoading && !data?.composition.genres.length}
            isError={analyticsQuery.isError && !!data}
            isLoading={isInitialLoading}
            rows={relationRows(data?.composition.genres ?? [])}
            title="Top genres"
            onRetry={retryAnalytics}
          >
            <TopRelationsChart
              field="genre"
              items={data?.composition.genres ?? []}
              title="Genres"
            />
          </AnalyticsChartCard>
          <AnalyticsChartCard
            columns={['Tag', 'Books', 'Share of books']}
            dataTableEnabled={false}
            description="Find the tags that dominate the current filters."
            emptyMessage="No tag data for this analytics scope."
            isEmpty={!isInitialLoading && !data?.composition.tags.length}
            isError={analyticsQuery.isError && !!data}
            isLoading={isInitialLoading}
            rows={relationRows(data?.composition.tags ?? [])}
            title="Top tags"
            onRetry={retryAnalytics}
          >
            <TopRelationsChart field="tag" items={data?.composition.tags ?? []} title="Tags" />
          </AnalyticsChartCard>
          <AnalyticsChartCard
            columns={['Status', 'Priority', 'Books', 'Share of status']}
            dataTableEnabled={false}
            description="Spot statuses where books are still unprioritized or clustered in one priority."
            emptyMessage="No priority data for this analytics scope."
            isEmpty={!isInitialLoading && !data?.planning.prioritiesByStatus.length}
            isError={analyticsQuery.isError && !!data}
            isLoading={isInitialLoading}
            rows={priorityRows(data)}
            title="Priority by status"
            onRetry={retryAnalytics}
          >
            <PriorityByStatusChart data={data} />
          </AnalyticsChartCard>
          <AnalyticsChartCard
            columns={['Source', 'Links', 'Books', 'Coverage']}
            description="Check which external sources are represented in matching books."
            emptyMessage="0 link sources found for this scope."
            isEmpty={!isInitialLoading && !data?.quality.linkSources.length}
            isError={analyticsQuery.isError && !!data}
            isLoading={isInitialLoading}
            rows={linkSourceRows(data)}
            title="Link sources"
            onRetry={retryAnalytics}
          >
            <LinkSourcesChart data={data} />
          </AnalyticsChartCard>
          <AnalyticsChartCard
            columns={['Kind', 'Bucket', 'Books', 'Coverage']}
            description="Review cover fetch state and provider coverage without opening each book."
            emptyMessage="0 cover records reported for this scope."
            isEmpty={
              !isInitialLoading &&
              !(
                (data?.quality.coverStatuses.length ?? 0) > 0 ||
                (data?.quality.coverSources.length ?? 0) > 0
              )
            }
            isError={analyticsQuery.isError && !!data}
            isLoading={isInitialLoading}
            rows={coverAvailabilityRows(data)}
            title="Cover availability"
            onRetry={retryAnalytics}
          >
            <CoverAvailabilityChart data={data} />
          </AnalyticsChartCard>
        </div>
        <div className="grid min-w-0 gap-5" data-testid="analytics-right-column">
          <AnalyticsChartCard
            columns={['Rating', 'Books']}
            dataTableEnabled={false}
            description="See the rating spread and jump directly to unrated books."
            emptyMessage="No rating data for this analytics scope."
            isEmpty={!isInitialLoading && !data?.overview.totalBooks}
            isError={analyticsQuery.isError && !!data}
            isLoading={isInitialLoading}
            rows={ratingRows(data)}
            title="Rating distribution"
            onRetry={retryAnalytics}
          >
            <RatingDistributionChart data={data} />
          </AnalyticsChartCard>
          <AnalyticsChartCard
            columns={['Type', 'Books', 'Current chapters', 'Average current', 'Median current']}
            description="Compare where your chapter backlog sits by content type."
            emptyMessage="No chapter volume data for this analytics scope."
            isEmpty={!isInitialLoading && !data?.progress.typeVolumes.length}
            isError={analyticsQuery.isError && !!data}
            isLoading={isInitialLoading}
            rows={chapterVolumeRows(data)}
            title="Chapter volume by type"
            onRetry={retryAnalytics}
          >
            <ChapterVolumeChart data={data} />
          </AnalyticsChartCard>
          <AnalyticsChartCard
            columns={['Type', 'Current chapters', 'Minutes / chapter', 'Estimated time']}
            description="Estimate reading effort from chapter counts and your minutes-per-chapter settings."
            emptyMessage="No chapter data to estimate reading time."
            isEmpty={!isInitialLoading && !data?.progress.typeVolumes.length}
            isError={analyticsQuery.isError && !!data}
            isLoading={isInitialLoading}
            rows={estimatedReadingTimeRows(data, readingTimeSettings)}
            title="Estimated reading time"
            onRetry={retryAnalytics}
          >
            <EstimatedReadingTimeChart
              data={data}
              isSaving={readingTimeSettingsMutation.isPending}
              settings={readingTimeSettings}
              onSave={(settings) =>
                readingTimeSettingsMutation.mutateAsync({
                  settings: Object.entries(settings).map(([contentType, minutesPerChapter]) => ({
                    contentType,
                    minutesPerChapter,
                  })),
                })
              }
            />
          </AnalyticsChartCard>
          <AnalyticsChartCard
            columns={[
              'Date',
              'Daily chapters',
              'Cumulative chapters',
              'Progress events',
              'Books touched',
            ]}
            description="Compare daily chapter progress with the cumulative reading total in the selected range."
            emptyMessage="No reading activity in this time range."
            isEmpty={!isInitialLoading && !data?.activity.points.length}
            isError={analyticsQuery.isError && !!data}
            isLoading={isInitialLoading}
            rows={readingActivityRows(data)}
            title="Reading activity"
            onRetry={retryAnalytics}
          >
            <ReadingActivityChart data={data} />
          </AnalyticsChartCard>
          <AnalyticsChartCard
            columns={['Date', 'Books added', 'Cumulative books', 'By type']}
            description="See when books were added and which types caused growth."
            emptyMessage="No library growth points in this time range."
            isEmpty={!isInitialLoading && !data?.libraryGrowth.points.length}
            isError={analyticsQuery.isError && !!data}
            isLoading={isInitialLoading}
            rows={libraryGrowthRows(data)}
            title="Library growth"
            onRetry={retryAnalytics}
          >
            <LibraryGrowthChart data={data} />
          </AnalyticsChartCard>
          <AnalyticsChartCard
            columns={['Field', 'Complete books', 'Coverage', 'Missing books']}
            dataTableEnabled={false}
            description="Find fields that are missing most often in the current scope."
            emptyMessage="0 metadata fields reported for this scope."
            isEmpty={!isInitialLoading && !data?.quality.fieldCompleteness.length}
            isError={analyticsQuery.isError && !!data}
            isLoading={isInitialLoading}
            rows={metadataCompletenessRows(data)}
            title="Metadata completeness"
            onRetry={retryAnalytics}
          >
            <MetadataCompletenessChart data={data} />
          </AnalyticsChartCard>
        </div>
      </div>
    </div>
  )
}

function DateRangeChooser({
  filters,
  onChange,
}: {
  filters: ReturnType<typeof getAnalyticsFilters>
  onChange: React.Dispatch<React.SetStateAction<ReturnType<typeof getAnalyticsFilters>>>
}) {
  const [isOpen, setIsOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const accountStartDate = getAccountStartDate()
  const today = getToday()
  const selectedRange = useMemo<DateRange>(
    () => ({ from: parseDateInput(filters.from), to: getInclusiveToDate(filters.to) }),
    [filters.from, filters.to],
  )
  const [calendarRange, setCalendarRange] = useState<DateRange | undefined>(selectedRange)
  const [calendarSourceRange, setCalendarSourceRange] = useState(selectedRange)
  const [rangeSelectionAnchor, setRangeSelectionAnchor] = useState<Date | null>(null)
  const display = getDateRangeDisplay(filters, accountStartDate)

  // Re-sync the calendar when the applied range changes (adjusting state during render instead of in an effect).
  if (calendarSourceRange !== selectedRange) {
    setCalendarSourceRange(selectedRange)
    setCalendarRange(selectedRange)
  }

  useEffect(() => {
    if (!isOpen) {
      return undefined
    }

    function closeOnOutsidePointerDown(event: PointerEvent) {
      const target = event.target
      if (target instanceof Node && !rootRef.current?.contains(target)) {
        setIsOpen(false)
        setRangeSelectionAnchor(null)
        setCalendarRange(selectedRange)
      }
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsOpen(false)
        setRangeSelectionAnchor(null)
        setCalendarRange(selectedRange)
      }
    }

    document.addEventListener('pointerdown', closeOnOutsidePointerDown)
    document.addEventListener('keydown', closeOnEscape)

    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointerDown)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [isOpen, selectedRange])

  function applyPreset(preset: (typeof analyticsRangePresets)[number]) {
    const today = getToday()
    if (isPresetDisabled(preset, today, accountStartDate)) {
      return
    }

    const nextRange = {
      from: getPresetFromDate(preset, today, accountStartDate),
      to: today,
    }
    setCalendarRange(nextRange)
    setRangeSelectionAnchor(null)
    setIsOpen(false)
    onChange((current) => ({
      ...current,
      from: toDateInputValue(nextRange.from),
      to: toDateInputValue(addDays(today, 1)),
    }))
  }

  function applyCalendarDay(day: Date) {
    if (day < accountStartDate || day > today) {
      return
    }

    if (!rangeSelectionAnchor) {
      setRangeSelectionAnchor(day)
      setCalendarRange({ from: day, to: day })
      onChange((current) => ({
        ...current,
        from: toDateInputValue(day),
        to: toDateInputValue(addDays(day, 1)),
      }))
      return
    }

    const from = day < rangeSelectionAnchor ? day : rangeSelectionAnchor
    const to = day < rangeSelectionAnchor ? rangeSelectionAnchor : day
    setRangeSelectionAnchor(null)
    setCalendarRange({ from, to })
    setIsOpen(false)
    onChange((current) => ({
      ...current,
      from: toDateInputValue(from),
      to: toDateInputValue(addDays(to, 1)),
    }))
  }

  return (
    <div className="relative flex w-full flex-col gap-1.5 sm:w-72" ref={rootRef}>
      <span className="text-[13px] font-medium text-ink-2">Date range</span>
      <button
        aria-expanded={isOpen}
        aria-label={`Date range: ${display.label}. ${display.title}`}
        className={cn(fieldClass, 'flex items-center justify-between gap-3 text-left text-sm')}
        title={display.title}
        type="button"
        onClick={() => {
          setIsOpen((current) => {
            const next = !current
            setRangeSelectionAnchor(null)
            setCalendarRange(selectedRange)
            return next
          })
        }}
      >
        <span className="truncate">{display.label}</span>
        {display.toLabel ? (
          <span className="shrink-0 rounded-pill border border-line-strong bg-raised px-2 py-0.5 text-xs font-medium text-ink-2">
            {display.toLabel}
          </span>
        ) : null}
      </button>
      {isOpen ? (
        <div className="ui-popover absolute top-full left-0 mt-2 w-[min(44rem,calc(100vw-2rem))] p-3 sm:right-0 sm:left-auto">
          <div className="mb-3 grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {analyticsRangePresets.map((preset) => {
              const today = getToday()
              const isActive = display.presetLabel === preset.label
              const isDisabled = isPresetDisabled(preset, today, accountStartDate)
              return (
                <button
                  aria-disabled={isDisabled}
                  className={`ui-filter-chip ${isActive ? 'ui-filter-chip--active' : ''}`}
                  disabled={isDisabled}
                  key={preset.label}
                  type="button"
                  onClick={() => applyPreset(preset)}
                >
                  {preset.label}
                </button>
              )
            })}
          </div>
          <DayPicker
            classNames={dayPickerClassNames}
            defaultMonth={subMonths(today, 1)}
            disabled={{ before: accountStartDate, after: today }}
            mode="range"
            modifiers={{ rangeSelectionAnchor: rangeSelectionAnchor ?? undefined }}
            modifiersClassNames={{ rangeSelectionAnchor: dayPickerClassNames.range_start }}
            numberOfMonths={2}
            selected={rangeSelectionAnchor ? { from: undefined, to: undefined } : calendarRange}
            onDayClick={applyCalendarDay}
            onSelect={() => undefined}
          />
        </div>
      ) : null}
    </div>
  )
}

function MetricCard({ label, loading, value }: { label: string; loading: boolean; value: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <div className="text-xs font-semibold tracking-[0.06em] text-ink-3 uppercase">{label}</div>
      <div className="mt-1 text-[26px] leading-tight font-semibold">
        {loading ? (
          <span className="inline-block h-8 w-16 animate-pulse rounded bg-raised motion-reduce:animate-none" />
        ) : (
          value
        )}
      </div>
    </div>
  )
}

function getAnalyticsFilters(searchParams: URLSearchParams) {
  const extracted = extractAnalyticsDateFilters(searchParams.get('query') ?? '')
  return {
    query: extracted.query,
    from: searchParams.get('from') ?? extracted.from ?? defaultFromDate(),
    to: searchParams.get('to') ?? extracted.to ?? defaultToDate(),
    bucket: normalizeBucket(searchParams.get('bucket')),
  }
}

function toAnalyticsRequest(filters: ReturnType<typeof getAnalyticsFilters>) {
  return {
    query: filters.query.trim(),
    from: filters.from,
    to: filters.to,
    bucket: filters.bucket,
  }
}

function createAnalyticsSearchParams(filters: ReturnType<typeof getAnalyticsFilters>) {
  const next = new URLSearchParams()
  if (filters.query.trim()) {
    next.set('query', filters.query.trim())
  }
  next.set('from', filters.from)
  next.set('to', filters.to)
  next.set('bucket', filters.bucket)
  return next
}

function normalizeBucket(value?: string | null): AnalyticsBucket {
  return analyticsBuckets.includes(value as AnalyticsBucket) ? (value as AnalyticsBucket) : 'week'
}

function defaultToDate() {
  return toDateInputValue(addDays(getToday(), 1))
}

function defaultFromDate() {
  return toDateInputValue(getDefaultFromDate(getToday(), getAccountStartDate()))
}

function toDateInputValue(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function getToday() {
  const date = new Date()
  date.setHours(0, 0, 0, 0)
  return date
}

function getAccountStartDate() {
  const createdAt = getStoredSession()?.createdAt
  if (!createdAt) {
    return new Date(1900, 0, 1)
  }

  const date = parseISO(createdAt)
  if (Number.isNaN(date.getTime())) {
    return new Date(1900, 0, 1)
  }

  date.setHours(0, 0, 0, 0)
  return date
}

function getDefaultFromDate(today: Date, accountStartDate: Date) {
  const lastThreeMonths = subMonths(today, 3)
  return accountStartDate > lastThreeMonths ? accountStartDate : lastThreeMonths
}

function getPresetFromDate(
  preset: (typeof analyticsRangePresets)[number],
  today: Date,
  accountStartDate: Date,
) {
  return preset.label === 'Beginning' ? accountStartDate : preset.getFrom(today)
}

function isPresetDisabled(
  preset: (typeof analyticsRangePresets)[number],
  today: Date,
  accountStartDate: Date,
) {
  const from = preset.getFrom(today)
  return from !== null && from < accountStartDate
}

function parseDateInput(value: string) {
  return parseISO(value)
}

function getInclusiveToDate(exclusiveToValue: string) {
  return addDays(parseDateInput(exclusiveToValue), -1)
}

function getDateRangeDisplay(
  filters: ReturnType<typeof getAnalyticsFilters>,
  accountStartDate: Date,
) {
  const from = parseDateInput(filters.from)
  const toInclusive = getInclusiveToDate(filters.to)
  const today = getToday()
  if (isSameDay(from, toInclusive)) {
    const label = format(from, 'MMM d, yyyy')
    return {
      label,
      presetLabel: undefined,
      toLabel: null,
      title: label,
    }
  }

  const preset = analyticsRangePresets.find(
    (item) =>
      !isPresetDisabled(item, today, accountStartDate) &&
      isSameDay(from, getPresetFromDate(item, today, accountStartDate)) &&
      isSameDay(toInclusive, today),
  )
  const toLabel = isSameDay(toInclusive, today) ? 'Today' : format(toInclusive, 'MMM d, yyyy')
  const label = preset ? preset.label : `${format(from, 'MMM d, yyyy')} – ${toLabel}`

  return {
    label,
    presetLabel: preset?.label,
    toLabel,
    title: `${format(from, 'MMM d, yyyy')} – ${format(toInclusive, 'MMM d, yyyy')}`,
  }
}

const dayPickerClassNames = {
  root: 'text-[var(--qs-text)]',
  months: 'grid gap-4 md:grid-cols-2',
  month: 'space-y-3',
  month_caption:
    'flex items-center justify-center px-8 py-1 text-sm font-semibold text-[var(--qs-text)]',
  caption_label: 'px-2 py-1',
  nav: 'absolute right-3 top-[4.75rem] flex gap-2',
  button_previous:
    'grid h-11 w-11 place-items-center rounded-[var(--qs-control-radius)] border border-[var(--qs-border)] bg-[var(--qs-surface-muted)] text-[var(--qs-muted)] hover:border-[var(--qs-accent)] hover:text-[var(--qs-text)]',
  button_next:
    'grid h-11 w-11 place-items-center rounded-[var(--qs-control-radius)] border border-[var(--qs-border)] bg-[var(--qs-surface-muted)] text-[var(--qs-muted)] hover:border-[var(--qs-accent)] hover:text-[var(--qs-text)]',
  chevron: 'h-4 w-4 fill-current',
  month_grid: 'w-full border-separate border-spacing-1',
  weekdays: 'text-xs uppercase tracking-wide text-[var(--qs-subtle)]',
  weekday: 'h-8 text-center font-semibold',
  week: '',
  day: 'analytics-calendar-day h-11 w-11 text-center text-sm',
  day_button:
    'analytics-calendar-day-button h-11 w-11 rounded-[var(--qs-control-radius)] font-medium',
  today: 'analytics-calendar-day--today',
  selected: 'analytics-calendar-day--selected',
  range_start: 'analytics-calendar-day--range-start rounded-l-full',
  range_middle: 'analytics-calendar-day--range-middle rounded-none',
  range_end: 'analytics-calendar-day--range-end rounded-r-full',
  outside: 'analytics-calendar-day--outside',
  disabled: 'analytics-calendar-day--disabled opacity-40 line-through',
}

function getAnalyticsEmptyMessage(data: BookAnalyticsDto | undefined, query: string) {
  if (!data || data.overview.totalBooks > 0) {
    return null
  }

  return query.trim()
    ? 'No books match the current analytics filters.'
    : 'Your library is empty. Add books to populate analytics.'
}
