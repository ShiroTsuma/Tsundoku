export type PaginatedResult<T> = {
  skip: number
  take: number
  total: number
  data: T[]
}

export type ApiError = {
  type: string
  title: string
  status: number
  detail: string
  instance: string
  errors?: Record<string, string[]>
}

export type TokenResponse = {
  accessToken: string
  tokenType: string
  expiresAt: string
  refreshTokenExpiresAt: string
  userId: string
  createdAt: string
}

export type RegisterResponse = {
  id: string
  name: string
  createdAt: string
}

export type LoginRequest = {
  username?: string | null
  email?: string | null
  password: string
}

export type RegisterRequest = {
  username: string
  email: string
  password: string
}

export type BookDto = {
  id: string
  created: string
  lastModified: string
  primaryTitle: string
  description?: string | null
  alternativeTitles: string[]
  authorId?: string | null
  author?: string | null
  contentType: string
  status: string
  currentChapterNumber?: number | null
  currentChapterLabel?: string | null
  totalChapters?: number | null
  rating?: number | null
  priority?: number | null
  notes?: string | null
  progressHistory: BookProgressHistoryDto[]
  cover?: BookCoverDto | null
  genres: string[]
  genreDescriptions: Record<string, string | null>
  tags: string[]
  tagDescriptions: Record<string, string | null>
  links: BookLinkDto[]
}

export type ReadingTimeSettingDto = {
  contentType: string
  minutesPerChapter: number
}

export type UpdateReadingTimeSettingsRequest = {
  settings: ReadingTimeSettingDto[]
}

export type PublicBookMetadataDto = {
  name: string
  description?: string | null
}

export type PublicBookSnapshotDto = {
  filesCount?: number
  id: string
  sourceBookId: string
  primaryTitle: string
  description?: string | null
  alternativeTitles: string[]
  author?: string | null
  authorOtherNames: string[]
  contentType: string
  totalChapters?: number | null
  genres: PublicBookMetadataDto[]
  tags: PublicBookMetadataDto[]
  coverUrl?: string | null
  snapshotAt: string
  isOwner: boolean
}

export type CopyPublicBookResult = {
  bookId: string
}

export type BookListItemDto = {
  id: string
  created: string
  lastModified: string
  primaryTitle: string
  description?: string | null
  alternativeTitles: string[]
  alternativeTitlesCount: number
  author?: string | null
  authorOtherNames: string[]
  contentType: string
  status: string
  currentChapterNumber?: number | null
  currentChapterLabel?: string | null
  totalChapters?: number | null
  rating?: number | null
  priority?: number | null
  notes?: string | null
  cover?: BookCoverSummaryDto | null
  genres: string[]
  genreDescriptions: Record<string, string | null>
  genresCount: number
  tags: string[]
  tagDescriptions: Record<string, string | null>
  tagsCount: number
  linksCount: number
}

export type ManagedBookListingDto = {
  id: string
  sourceBookId: string
  snapshotAt: string
}

export type ManagedBookListItemDto = {
  book: BookListItemDto
  listing?: ManagedBookListingDto | null
}

export type BookSummaryDto = {
  totalBooks: number
  ratedBooks: number
  unratedBooks: number
  averageRating?: number | null
  currentChapters: number
  booksWithKnownCurrentChapter: number
  booksWithoutKnownCurrentChapter: number
  statusCounts: BookSummaryStatusCountDto[]
  typeCounts: BookSummaryTypeCountDto[]
  genreCounts: BookSummaryGenreCountDto[]
  ratingCounts: BookSummaryRatingCountDto[]
}

export type BookSummaryStatusCountDto = {
  status: string
  count: number
}

export type BookSummaryTypeCountDto = {
  type: string
  bookCount: number
  currentChapters: number
}

export type BookSummaryGenreCountDto = {
  genre: string
  bookCount: number
}

export type BookSummaryRatingCountDto = {
  rating: number
  bookCount: number
}

export type BookSearchSuggestionDto = {
  value: string
  count: number
  isExact: boolean
  isAvailable: boolean
}

export type BookAnalyticsDto = {
  generatedAt: string
  scope: BookAnalyticsScopeDto
  overview: BookAnalyticsOverviewDto
  composition: BookAnalyticsCompositionDto
  ratings: BookAnalyticsRatingsDto
  planning: BookAnalyticsPlanningDto
  progress: BookAnalyticsProgressDto
  activity: BookAnalyticsActivityDto
  libraryGrowth: BookAnalyticsLibraryGrowthDto
  quality: BookAnalyticsQualityDto
}

export type BookAnalyticsScopeDto = {
  query?: string | null
  from: string
  to: string
  bucket: string
}

export type BookAnalyticsOverviewDto = {
  totalBooks: number
  ratedBooks: number
  unratedBooks: number
  averageRating?: number | null
  currentChapters: number
  booksWithKnownCurrentChapter: number
  booksWithoutKnownCurrentChapter: number
}

export type BookAnalyticsCompositionDto = {
  statusByType: BookAnalyticsStatusByTypeDto[]
  genres: BookAnalyticsRelationCountDto[]
  tags: BookAnalyticsRelationCountDto[]
}

export type BookAnalyticsStatusByTypeDto = {
  type: string
  totalBooks: number
  statuses: BookAnalyticsStatusCountDto[]
}

export type BookAnalyticsStatusCountDto = {
  status: string
  bookCount: number
}

export type BookAnalyticsRelationCountDto = {
  name: string
  bookCount: number
  shareOfBooks: number
}

export type BookAnalyticsRatingsDto = {
  ratedBooks: number
  unratedBooks: number
  averageRating?: number | null
  counts: BookAnalyticsRatingCountDto[]
}

export type BookAnalyticsRatingCountDto = {
  rating: number
  bookCount: number
}

export type BookAnalyticsPlanningDto = {
  prioritiesByStatus: BookAnalyticsPrioritiesByStatusDto[]
}

export type BookAnalyticsPrioritiesByStatusDto = {
  status: string
  totalBooks: number
  priorities: BookAnalyticsPriorityCountDto[]
}

export type BookAnalyticsPriorityCountDto = {
  priority: string
  bookCount: number
}

export type BookAnalyticsProgressDto = {
  typeVolumes: BookAnalyticsTypeVolumeDto[]
}

export type BookAnalyticsTypeVolumeDto = {
  type: string
  bookCount: number
  currentChapters: number
  averageCurrentChapter?: number | null
  medianCurrentChapter?: number | null
  readingBooks?: number
  readingBooksWithKnownTotal?: number
  remainingChapters?: number
}

export type BookAnalyticsActivityDto = {
  baselineChapters: number
  points: BookAnalyticsActivityPointDto[]
}

export type BookAnalyticsActivityPointDto = {
  date: string
  progressEvents: number
  booksTouched: number
  chaptersAdvanced: number
}

export type BookAnalyticsLibraryGrowthDto = {
  openingCount: number
  points: BookAnalyticsLibraryGrowthPointDto[]
}

export type BookAnalyticsLibraryGrowthPointDto = {
  date: string
  booksAdded: number
  cumulativeBooks: number
  byType: BookAnalyticsTypeCountDto[]
}

export type BookAnalyticsTypeCountDto = {
  type: string
  bookCount: number
}

export type BookAnalyticsQualityDto = {
  fieldCompleteness: BookAnalyticsFieldCompletenessDto[]
  linkSources: BookAnalyticsLinkSourceDto[]
  coverStatuses: BookAnalyticsCoverStatusDto[]
  coverSources: BookAnalyticsCoverSourceDto[]
}

export type BookAnalyticsFieldCompletenessDto = {
  field: string
  bookCount: number
  shareOfBooks: number
}

export type BookAnalyticsLinkSourceDto = {
  source: string
  linkCount: number
  bookCount: number
  shareOfBooks: number
}

export type BookAnalyticsCoverStatusDto = {
  status: string
  bookCount: number
  shareOfBooks: number
}

export type BookAnalyticsCoverSourceDto = {
  source: string
  bookCount: number
  shareOfBooks: number
}

export type AdminBookDto = BookDto & {
  ownerId: string
}

export type AdminBookListItemDto = BookListItemDto & {
  ownerId: string
  ownerUsername?: string | null
  ownerEmail?: string | null
}

export type BookLinkDto = {
  id: string
  url: string
  label?: string | null
  sourceType: string
  isPrimary: boolean
  lastReadHere: boolean
}

export type BookCoverSummaryDto = {
  status: string
  source?: string | null
  imageUrl?: string | null
  thumbnailImageUrl?: string | null
  failureReason?: string | null
  lastAttemptAt?: string | null
}

export type BookCoverDto = BookCoverSummaryDto & {
  id: string
  originalImageUrl?: string | null
  mimeType?: string | null
  sizeBytes?: number | null
  width?: number | null
  height?: number | null
  thumbnailMimeType?: string | null
  thumbnailSizeBytes?: number | null
  thumbnailWidth?: number | null
  thumbnailHeight?: number | null
}

export type BookTitleInput = {
  title: string
  language?: string | null
  source?: string | null
}

export type BookLinkInput = {
  url: string
  label?: string | null
  sourceType: string
  isPrimary: boolean
  lastReadHere: boolean
}

export type BookMutationRequest = {
  primaryTitle: string
  contentTypeId: string
  statusId: string
  authorId?: string | null
  authorName?: string | null
  alternativeTitles: BookTitleInput[]
  genreIds: string[]
  tags: string[]
  totalChapters?: number | null
  currentChapterNumber?: number | null
  currentChapterLabel?: string | null
  rating?: number | null
  priority?: number | null
  description?: string | null
  notes?: string | null
  rawImportedLine?: string | null
  links: BookLinkInput[]
  initialCoverUrl?: string | null
  initialCoverUploadToken?: string | null
}

export type BookHtmlDictionaryMatch = {
  id?: string | null
  name: string
}

export type BookHtmlParseResult = {
  source: string
  primaryTitle?: string | null
  authorName?: string | null
  contentType?: BookHtmlDictionaryMatch | null
  alternativeTitles: string[]
  genres: BookHtmlDictionaryMatch[]
  tags: string[]
  description?: string | null
  canonicalUrl?: string | null
  coverUrl?: string | null
  warnings: string[]
}

export type BookProgressHistoryDto = {
  id: string
  changedAt: string
  chapterNumber?: number | null
  chapterLabel?: string | null
  comment?: string | null
}

export type BookImportRowDto = {
  rowId: string
  lineNumber: number
  isValid: boolean
  primaryTitle?: string | null
  authorName?: string | null
  contentType?: string | null
  status?: string | null
  genres?: string | null
  tags?: string | null
  totalChapters?: string | null
  currentChapterNumber?: string | null
  currentChapterLabel?: string | null
  rating?: string | null
  priority?: string | null
  description?: string | null
  notes?: string | null
  rawImportedLine?: string | null
  errors: string[]
  fieldErrors: Record<string, string[]>
}

export type BookImportSessionDto = {
  sessionId: string
  fileName: string
  totalRows: number
  validRows: number
  invalidRows: number
  canFinalize: boolean
  availableContentTypes: string[]
  availableStatuses: string[]
  rows: BookImportRowDto[]
}

export type BookImportRowUpdateRequest = {
  primaryTitle?: string | null
  authorName?: string | null
  contentType?: string | null
  status?: string | null
  genres?: string | null
  tags?: string | null
  totalChapters?: string | null
  currentChapterNumber?: string | null
  currentChapterLabel?: string | null
  rating?: string | null
  priority?: string | null
  description?: string | null
  notes?: string | null
  rawImportedLine?: string | null
}

export type BookImportFinalizeResult = {
  importedCount: number
  skippedCount: number
  importedBooks: BookImportFinalizedBook[]
  errors: string[]
}

export type BookImportFinalizedBook = {
  primaryTitle: string
  contentType: string
  status: string
  currentChapterNumber?: number | null
  currentChapterLabel?: string | null
  totalChapters?: number | null
}

export type AdminLibraryPurgeResult = {
  deletedBooks: number
  deletedAuthors: number
  deletedTags: number
}

export type UpdateProgressRequest = {
  currentChapterNumber?: number | null
  currentChapterLabel?: string | null
  comment?: string | null
}

export type DictionaryDto = {
  id: string
  name: string
  description?: string | null
}

export type DictionaryMutationRequest = {
  name: string
  description?: string | null
}

export type AuthorDto = {
  id: string
  primaryName: string
  otherNames: string[]
  isPublic: boolean
  isOwned: boolean
}

export type TagDto = {
  id: string
  name: string
  description?: string | null
  color?: string | null
  isGlobal: boolean
}

export type AdminUserDto = {
  id: string
  username?: string | null
  email?: string | null
  createdAt: string
  booksCount: number
  tagsCount: number
  authorsCreatedCount: number
}

export type AdminAccountDeleteResult = {
  userId: string
  deletedBooks: number
  deletedAuthors: number
  deletedTags: number
}

export type CreateTagRequest = {
  name: string
  description?: string | null
}

export type CreateAuthorRequest = {
  primaryName: string
  otherNames: string[]
}

export type UpdateTagRequest = {
  description?: string | null
}

export type UpdateAuthorRequest = {
  otherNames: string[]
}

export type UpdateAuthorVisibilityRequest = {
  isPublic: boolean
}
