namespace Infrastructure.Persistence;

using Domain.Models;

public sealed class BookAnalyticsQueryService(ApplicationDbContext context, BookSearchCriteriaApplier criteriaApplier)
    : IBookAnalyticsQueryService
{
    private const string ReadingStatusName = "Reading";

    public async Task<BookAnalyticsSnapshot> GetAnalyticsAsync(
        Guid ownerId,
        BookSearchCriteria criteria,
        BookAnalyticsScopeSnapshot scope,
        CancellationToken cancellationToken)
    {
        // The snapshot covers every matching book; the date range only scopes the time series
        // (reading activity by progress date, library growth by created date).
        var query = ApplyCriteria(
            context.Books.AsNoTracking().Where(book => book.OwnerId == ownerId),
            criteria);
        var overview = await GetOverviewAsync(query, cancellationToken);
        var composition =
            await GetCompositionAsync(query, overview.TotalBooks, cancellationToken);
        var ratings = await GetRatingsAsync(query, overview, cancellationToken);
        var planning = await GetPlanningAsync(query, overview.TotalBooks, cancellationToken);
        var progress = await GetProgressAsync(query, overview.TotalBooks, cancellationToken);
        var activity =
            await GetActivityAsync(query, scope, overview.TotalBooks, cancellationToken);
        var libraryGrowth =
            await GetLibraryGrowthAsync(query, scope, overview.TotalBooks, cancellationToken);
        var quality = await GetQualityAsync(query, overview.TotalBooks, cancellationToken);

        return new BookAnalyticsSnapshot(
            DateTimeOffset.UtcNow,
            scope,
            overview,
            composition,
            ratings,
            planning,
            progress,
            activity,
            libraryGrowth,
            quality);
    }

    private IQueryable<Book> ApplyCriteria(IQueryable<Book> query, BookSearchCriteria criteria)
    {
        return criteria.HasFilters ? criteriaApplier.Apply(query, criteria) : query;
    }

    private static async Task<BookAnalyticsOverviewSnapshot> GetOverviewAsync(
        IQueryable<Book> query,
        CancellationToken cancellationToken)
    {
        var row = await query
            .GroupBy(_ => 1)
            .Select(group => new
            {
                TotalBooks = group.Count(),
                RatedBooks = group.Count(book => book.Rating != null),
                AverageRating = group
                    .Where(book => book.Rating != null)
                    .Select(book => (double?)book.Rating)
                    .Average(),
                CurrentChapters = group
                    .Where(book => book.CurrentChapterNumber != null)
                    .Select(book => book.CurrentChapterNumber ?? 0)
                    .Sum(),
                BooksWithKnownCurrentChapter = group.Count(book => book.CurrentChapterNumber != null)
            })
            .SingleOrDefaultAsync(cancellationToken);

        var totalBooks = row?.TotalBooks ?? 0;
        var ratedBooks = row?.RatedBooks ?? 0;
        var booksWithKnownCurrentChapter = row?.BooksWithKnownCurrentChapter ?? 0;

        return new BookAnalyticsOverviewSnapshot(
            totalBooks,
            ratedBooks,
            totalBooks - ratedBooks,
            row?.AverageRating,
            row?.CurrentChapters ?? 0,
            booksWithKnownCurrentChapter,
            totalBooks - booksWithKnownCurrentChapter);
    }

    private async Task<BookAnalyticsCompositionSnapshot> GetCompositionAsync(
        IQueryable<Book> query,
        int totalBooks,
        CancellationToken cancellationToken)
    {
        if (totalBooks == 0)
        {
            return BookAnalyticsCompositionSnapshot.Empty;
        }

        var statusByType =
            await GetStatusByTypeAsync(query, cancellationToken);
        var bookIds = query.Select(book => book.Id);
        var genres =
            await GetGenreCountsAsync(bookIds, totalBooks, cancellationToken);
        var tags =
            await GetTagCountsAsync(bookIds, totalBooks, cancellationToken);

        return new BookAnalyticsCompositionSnapshot(statusByType, genres, tags);
    }

    private static async Task<IReadOnlyList<BookAnalyticsStatusByTypeSnapshot>> GetStatusByTypeAsync(
        IQueryable<Book> query,
        CancellationToken cancellationToken)
    {
        var rows = await query
            .GroupBy(book => new { Type = book.ContentType.Name, Status = book.Status.Name })
            .Select(group => new { group.Key.Type, group.Key.Status, BookCount = group.Count() })
            .OrderBy(group => group.Type)
            .ThenByDescending(group => group.BookCount)
            .ThenBy(group => group.Status)
            .ToListAsync(cancellationToken);

        return rows
            .GroupBy(row => row.Type)
            .Select(group => new BookAnalyticsStatusByTypeSnapshot(
                group.Key,
                group.Sum(row => row.BookCount),
                group
                    .Select(row => new BookAnalyticsStatusCountSnapshot(row.Status, row.BookCount))
                    .ToList()))
            .OrderByDescending(group => group.TotalBooks)
            .ThenBy(group => group.Type)
            .ToList();
    }

    private async Task<IReadOnlyList<BookAnalyticsRelationCountSnapshot>> GetGenreCountsAsync(
        IQueryable<Guid> bookIds,
        int totalBooks,
        CancellationToken cancellationToken)
    {
        var rows = await context.Set<BookGenre>()
            .AsNoTracking()
            .Where(bookGenre => bookIds.Contains(bookGenre.BookId))
            .Select(bookGenre => new { Id = bookGenre.BookId, bookGenre.Genre.Name })
            .Distinct()
            .GroupBy(row => row.Name)
            .Select(group => new { Name = group.Key, BookCount = group.Count() })
            .OrderByDescending(group => group.BookCount)
            .ThenBy(group => group.Name)
            .ToListAsync(cancellationToken);

        return ToRelationSnapshots(rows.Select(row => new RelationCountRow(row.Name, row.BookCount)), totalBooks);
    }

    private async Task<IReadOnlyList<BookAnalyticsRelationCountSnapshot>> GetTagCountsAsync(
        IQueryable<Guid> bookIds,
        int totalBooks,
        CancellationToken cancellationToken)
    {
        var rows = await context.Set<BookTag>()
            .AsNoTracking()
            .Where(bookTag => bookIds.Contains(bookTag.BookId))
            .Select(bookTag => new { Id = bookTag.BookId, bookTag.Tag.Name })
            .Distinct()
            .GroupBy(row => row.Name)
            .Select(group => new { Name = group.Key, BookCount = group.Count() })
            .OrderByDescending(group => group.BookCount)
            .ThenBy(group => group.Name)
            .ToListAsync(cancellationToken);

        return ToRelationSnapshots(rows.Select(row => new RelationCountRow(row.Name, row.BookCount)), totalBooks);
    }

    private static IReadOnlyList<BookAnalyticsRelationCountSnapshot> ToRelationSnapshots(
        IEnumerable<RelationCountRow> rows,
        int totalBooks)
    {
        return rows
            .Select(row => new BookAnalyticsRelationCountSnapshot(
                row.Name,
                row.BookCount,
                totalBooks == 0 ? 0 : (double)row.BookCount / totalBooks))
            .ToList();
    }

    private static async Task<BookAnalyticsRatingsSnapshot> GetRatingsAsync(
        IQueryable<Book> query,
        BookAnalyticsOverviewSnapshot overview,
        CancellationToken cancellationToken)
    {
        var rows = await query
            .Where(book => book.Rating != null)
            .GroupBy(book => book.Rating!.Value)
            .Select(group => new { Rating = group.Key, BookCount = group.Count() })
            .ToListAsync(cancellationToken);

        var countsByRating = rows.ToDictionary(row => row.Rating, row => row.BookCount);
        var counts = Enumerable.Range(1, 10)
            .Select(rating => new BookAnalyticsRatingCountSnapshot(
                rating,
                countsByRating.GetValueOrDefault(rating)))
            .ToList();

        return new BookAnalyticsRatingsSnapshot(
            overview.RatedBooks,
            overview.UnratedBooks,
            overview.AverageRating,
            counts);
    }

    private static async Task<BookAnalyticsPlanningSnapshot> GetPlanningAsync(
        IQueryable<Book> query,
        int totalBooks,
        CancellationToken cancellationToken)
    {
        if (totalBooks == 0)
        {
            return BookAnalyticsPlanningSnapshot.Empty;
        }

        var rows = await query
            .GroupBy(book => new { Status = book.Status.Name, book.Priority })
            .Select(group => new { group.Key.Status, group.Key.Priority, BookCount = group.Count() })
            .ToListAsync(cancellationToken);

        var prioritiesByStatus = rows
            .GroupBy(row => row.Status)
            .Select(group =>
            {
                var countsByPriority = group.ToDictionary(
                    row => row.Priority?.ToString(CultureInfo.InvariantCulture) ?? "Unset",
                    row => row.BookCount);
                var priorities = Enumerable.Range(1, 5)
                    .Select(priority => new BookAnalyticsPriorityCountSnapshot(
                        priority.ToString(CultureInfo.InvariantCulture),
                        countsByPriority.GetValueOrDefault(priority.ToString(CultureInfo.InvariantCulture))))
                    .Append(
                        new BookAnalyticsPriorityCountSnapshot("Unset", countsByPriority.GetValueOrDefault("Unset")))
                    .ToList();

                return new BookAnalyticsPrioritiesByStatusSnapshot(
                    group.Key,
                    group.Sum(row => row.BookCount),
                    priorities);
            })
            .OrderByDescending(group => group.TotalBooks)
            .ThenBy(group => group.Status)
            .ToList();

        return new BookAnalyticsPlanningSnapshot(prioritiesByStatus);
    }

    private static async Task<BookAnalyticsProgressSnapshot> GetProgressAsync(
        IQueryable<Book> query,
        int totalBooks,
        CancellationToken cancellationToken)
    {
        if (totalBooks == 0)
        {
            return BookAnalyticsProgressSnapshot.Empty;
        }

        // Portable median projection: EF providers differ on percentile/median support,
        // so keep the database work to the filtered scalar projection and compute
        // per-type medians from chapter values only.
        var rows = await query
            .Select(book => new
            {
                Type = book.ContentType.Name,
                book.CurrentChapterNumber,
                book.TotalChapters,
                Status = book.Status.Name
            })
            .OrderBy(row => row.Type)
            .ToListAsync(cancellationToken);

        return new BookAnalyticsProgressSnapshot(rows
            .GroupBy(row => row.Type)
            .Select(group =>
            {
                var knownChapters = group
                    .Where(row => row.CurrentChapterNumber != null)
                    .Select(row => row.CurrentChapterNumber!.Value)
                    .OrderBy(value => value)
                    .ToList();
                var sum = knownChapters.Sum();
                // Books in progress and how much of them is left, for the finish forecast.
                var reading = group
                    .Where(row => string.Equals(row.Status, ReadingStatusName, StringComparison.OrdinalIgnoreCase))
                    .ToList();
                var readingWithTotal = reading.Where(row => row.TotalChapters != null).ToList();

                return new BookAnalyticsTypeVolumeSnapshot(
                    group.Key,
                    group.Count(),
                    sum,
                    knownChapters.Count == 0 ? null : sum / knownChapters.Count,
                    CalculateMedian(knownChapters),
                    reading.Count,
                    readingWithTotal.Count,
                    readingWithTotal.Sum(row => Math.Max(0m, row.TotalChapters!.Value - (row.CurrentChapterNumber ?? 0m))));
            })
            .OrderByDescending(item => item.BookCount)
            .ThenBy(item => item.Type)
            .ToList());
    }

    private static decimal? CalculateMedian(IReadOnlyList<decimal> sortedValues)
    {
        if (sortedValues.Count == 0)
        {
            return null;
        }

        var middle = sortedValues.Count / 2;
        if (sortedValues.Count % 2 == 1)
        {
            return sortedValues[middle];
        }

        return (sortedValues[middle - 1] + sortedValues[middle]) / 2m;
    }

    private async Task<BookAnalyticsActivitySnapshot> GetActivityAsync(
        IQueryable<Book> query,
        BookAnalyticsScopeSnapshot scope,
        int totalBooks,
        CancellationToken cancellationToken)
    {
        if (totalBooks == 0)
        {
            return BookAnalyticsActivitySnapshot.Empty;
        }

        var bookIds = query.Select(book => book.Id);
        var to = ToUtcDateTimeOffset(scope.To);
        var historyQuery = context.BookProgressHistory
            .AsNoTracking()
            .Where(history => bookIds.Contains(history.BookId));
        if (!IsSqliteProvider())
        {
            historyQuery = historyQuery.Where(history => history.ChangedAt < to);
        }

        var rows = await historyQuery
            .Select(history => new ProgressHistoryRow(
                history.BookId,
                history.Id,
                history.ChangedAt,
                history.ChapterNumber,
                history.ChapterLabel))
            .ToListAsync(cancellationToken);
        if (IsSqliteProvider())
        {
            rows = rows.Where(row => row.ChangedAt < to).ToList();
        }

        var points = CreateEmptyActivityPoints(scope);
        foreach (var group in rows
                     .OrderBy(row => row.BookId)
                     .ThenBy(row => row.ChangedAt)
                     .ThenBy(row => row.Id)
                     .GroupBy(row => row.BookId))
        {
            ProgressHistoryRow? previous = null;
            foreach (var row in group)
            {
                if (previous is null)
                {
                    previous = row;
                    continue;
                }

                var changedDate = DateOnly.FromDateTime(row.ChangedAt.UtcDateTime);
                if (changedDate >= scope.From && changedDate < scope.To)
                {
                    var bucket = ResolveBucketDate(changedDate, scope.From, scope.Bucket);
                    if (points.TryGetValue(bucket, out var point))
                    {
                        point.ProgressEvents++;
                        point.BookIds.Add(row.BookId);
                        point.ChaptersAdvanced +=
                            CalculatePositiveChapterAdvance(previous.ChapterNumber, row.ChapterNumber);
                    }
                }

                previous = row;
            }
        }

        var baselineChapters = rows
            .GroupBy(row => row.BookId)
            .Sum(group => group
                .OrderBy(row => row.ChangedAt)
                .ThenBy(row => row.Id)
                .Select(row => row.ChapterNumber)
                .FirstOrDefault() ?? 0m);

        return new BookAnalyticsActivitySnapshot(baselineChapters, points
            .OrderBy(point => point.Key)
            .Select(point => new BookAnalyticsActivityPointSnapshot(
                point.Key,
                point.Value.ProgressEvents,
                point.Value.BookIds.Count,
                point.Value.ChaptersAdvanced))
            .ToList());
    }

    private async Task<BookAnalyticsLibraryGrowthSnapshot> GetLibraryGrowthAsync(
        IQueryable<Book> query,
        BookAnalyticsScopeSnapshot scope,
        int totalBooks,
        CancellationToken cancellationToken)
    {
        if (totalBooks == 0)
        {
            return BookAnalyticsLibraryGrowthSnapshot.Empty;
        }

        var to = ToUtcDateTimeOffset(scope.To);
        var growthQuery = query;
        if (!IsSqliteProvider())
        {
            growthQuery = growthQuery.Where(book => book.Created < to);
        }

        var rows = await growthQuery
            .Select(book => new LibraryGrowthRow(book.ContentType.Name, book.Created))
            .ToListAsync(cancellationToken);
        var datedRows = rows
            .Where(row => row.Created < to)
            .Select(row => new LibraryGrowthDatedRow(
                row.Type,
                DateOnly.FromDateTime(row.Created.UtcDateTime)))
            .ToList();
        var openingCount = datedRows.Count(row => row.Created < scope.From);
        var additionsByBucket = datedRows
            .Where(row => row.Created >= scope.From && row.Created < scope.To)
            .GroupBy(row => ResolveBucketDate(row.Created, scope.From, scope.Bucket))
            .ToDictionary(group => group.Key, group => group.ToList());

        var cumulativeBooks = openingCount;
        var points = new List<BookAnalyticsLibraryGrowthPointSnapshot>();
        foreach (var bucket in CreateBucketDates(scope))
        {
            var additions = additionsByBucket.GetValueOrDefault(bucket) ?? [];
            cumulativeBooks += additions.Count;
            var byType = additions
                .GroupBy(row => row.Type)
                .Select(group => new BookAnalyticsTypeCountSnapshot(group.Key, group.Count()))
                .OrderByDescending(item => item.BookCount)
                .ThenBy(item => item.Type)
                .ToList();

            points.Add(new BookAnalyticsLibraryGrowthPointSnapshot(
                bucket,
                additions.Count,
                cumulativeBooks,
                byType));
        }

        return new BookAnalyticsLibraryGrowthSnapshot(openingCount, points);
    }

    private async Task<BookAnalyticsQualitySnapshot> GetQualityAsync(
        IQueryable<Book> query,
        int totalBooks,
        CancellationToken cancellationToken)
    {
        if (totalBooks == 0)
        {
            return BookAnalyticsQualitySnapshot.Empty;
        }

        var bookIds = query.Select(book => book.Id);
        var completenessRows = await query
            .Select(book => new QualityCompletenessRow(
                book.Id,
                book.AuthorId != null || (book.Author != null && book.Author.PrimaryName != string.Empty),
                book.Description,
                book.BookGenres.Any(),
                book.BookTags.Any(),
                book.Rating != null,
                book.Priority != null,
                book.TotalChapters != null,
                book.Links.Any(),
                book.Cover != null ? book.Cover.Status : null,
                book.Cover != null ? book.Cover.StoragePath : null,
                book.Cover != null ? book.Cover.ThumbnailStoragePath : null))
            .ToListAsync(cancellationToken);
        var alternateTitleRows = await context.Set<BookTitle>()
            .AsNoTracking()
            .Where(title => bookIds.Contains(title.BookId) && !title.IsPrimary)
            .Select(title => new { title.BookId, title.Title })
            .ToListAsync(cancellationToken);
        var coverRows = await query
            .Select(book => new QualityCoverRow(
                book.Id,
                book.Cover != null ? book.Cover.Status : null,
                book.Cover != null ? book.Cover.Source : null,
                book.Cover != null ? book.Cover.StoragePath : null,
                book.Cover != null ? book.Cover.ThumbnailStoragePath : null))
            .ToListAsync(cancellationToken);

        var completeCounts = new Dictionary<string, int>
        {
            [BookAnalyticsQualityFields.Author] = completenessRows.Count(row => row.HasAuthor),
            [BookAnalyticsQualityFields.Description] =
                completenessRows.Count(row => !string.IsNullOrWhiteSpace(row.Description)),
            [BookAnalyticsQualityFields.Genre] = completenessRows.Count(row => row.HasGenre),
            [BookAnalyticsQualityFields.Tag] = completenessRows.Count(row => row.HasTag),
            [BookAnalyticsQualityFields.Rating] = completenessRows.Count(row => row.HasRating),
            [BookAnalyticsQualityFields.Priority] = completenessRows.Count(row => row.HasPriority),
            [BookAnalyticsQualityFields.TotalChapters] = completenessRows.Count(row => row.HasTotalChapters),
            [BookAnalyticsQualityFields.Link] = completenessRows.Count(row => row.HasLink),
            [BookAnalyticsQualityFields.AlternateTitle] = alternateTitleRows
                .Where(row => !string.IsNullOrWhiteSpace(row.Title))
                .Select(row => row.BookId)
                .Distinct()
                .Count(),
            [BookAnalyticsQualityFields.UsableCover] =
                completenessRows.Count(row => IsUsableCover(row.Status, row.StoragePath, row.ThumbnailStoragePath))
        };

        var linkSources =
            await GetLinkSourcesAsync(bookIds, totalBooks, cancellationToken);
        var coverStatuses = coverRows
            .Where(row => row.Status != null)
            .GroupBy(row => row.Status!.Value.ToString())
            .Select(group => new BookAnalyticsCoverStatusSnapshot(
                group.Key,
                group.Count(),
                CalculateShare(group.Count(), totalBooks)))
            .OrderByDescending(item => item.BookCount)
            .ThenBy(item => item.Status)
            .ToList();
        var coverSources = coverRows
            .Where(row => row.Status != null)
            .GroupBy(row => row.Source?.ToString() ?? "Unknown")
            .Select(group => new BookAnalyticsCoverSourceSnapshot(
                group.Key,
                group.Count(),
                CalculateShare(group.Count(), totalBooks)))
            .OrderByDescending(item => item.BookCount)
            .ThenBy(item => item.Source)
            .ToList();

        return new BookAnalyticsQualitySnapshot(
            BookAnalyticsQualitySnapshot.FieldNames
                .Select(field => new BookAnalyticsFieldCompletenessSnapshot(
                    field,
                    completeCounts.GetValueOrDefault(field),
                    CalculateShare(completeCounts.GetValueOrDefault(field), totalBooks)))
                .ToList(),
            linkSources,
            coverStatuses,
            coverSources);
    }

    private async Task<IReadOnlyList<BookAnalyticsLinkSourceSnapshot>> GetLinkSourcesAsync(
        IQueryable<Guid> bookIds,
        int totalBooks,
        CancellationToken cancellationToken)
    {
        var rows = await context.BookLinks
            .AsNoTracking()
            .Where(link => bookIds.Contains(link.BookId))
            .Select(link => new { link.BookId, link.SourceType })
            .ToListAsync(cancellationToken);

        return rows
            .GroupBy(row => string.IsNullOrWhiteSpace(row.SourceType) ? "Unknown" : row.SourceType.Trim())
            .Select(group => new BookAnalyticsLinkSourceSnapshot(
                group.Key,
                group.Count(),
                group.Select(row => row.BookId).Distinct().Count(),
                CalculateShare(group.Select(row => row.BookId).Distinct().Count(), totalBooks)))
            .OrderByDescending(item => item.LinkCount)
            .ThenBy(item => item.Source)
            .ToList();
    }

    private static bool IsUsableCover(QualityCoverRow row)
    {
        return IsUsableCover(row.Status, row.StoragePath, row.ThumbnailStoragePath);
    }

    private static bool IsUsableCover(BookCoverStatus? status, string? storagePath, string? thumbnailStoragePath)
    {
        return status is BookCoverStatus.Found or BookCoverStatus.Uploaded
               && (!string.IsNullOrWhiteSpace(storagePath) || !string.IsNullOrWhiteSpace(thumbnailStoragePath));
    }

    private static double CalculateShare(int count, int totalBooks)
    {
        return totalBooks == 0 ? 0 : (double)count / totalBooks;
    }

    private static DateTimeOffset ToUtcDateTimeOffset(DateOnly value)
    {
        return new DateTimeOffset(value.ToDateTime(TimeOnly.MinValue), TimeSpan.Zero);
    }

    private bool IsSqliteProvider()
    {
        return context.Database.ProviderName?.Contains("Sqlite", StringComparison.OrdinalIgnoreCase) == true;
    }

    private static SortedDictionary<DateOnly, ActivityPointAccumulator> CreateEmptyActivityPoints(
        BookAnalyticsScopeSnapshot scope)
    {
        var points = new SortedDictionary<DateOnly, ActivityPointAccumulator>();
        foreach (var bucket in CreateBucketDates(scope))
        {
            points[bucket] = new ActivityPointAccumulator();
        }

        return points;
    }

    private static IEnumerable<DateOnly> CreateBucketDates(BookAnalyticsScopeSnapshot scope)
    {
        for (var bucket = ResolveBucketDate(scope.From, scope.From, scope.Bucket);
             bucket < scope.To;
             bucket = NextBucketDate(bucket, scope.Bucket))
        {
            yield return bucket;
        }
    }

    private static DateOnly ResolveBucketDate(DateOnly date, DateOnly from, string bucket)
    {
        var bucketDate = bucket switch
        {
            BookAnalyticsBuckets.Day => date,
            BookAnalyticsBuckets.Week => StartOfWeek(date),
            BookAnalyticsBuckets.Month => new DateOnly(date.Year, date.Month, 1),
            _ => date
        };

        return bucketDate < from ? from : bucketDate;
    }

    private static DateOnly NextBucketDate(DateOnly bucket, string bucketSize)
    {
        return bucketSize switch
        {
            BookAnalyticsBuckets.Day => bucket.AddDays(1),
            BookAnalyticsBuckets.Week => StartOfWeek(bucket).AddDays(7),
            BookAnalyticsBuckets.Month => new DateOnly(bucket.Year, bucket.Month, 1).AddMonths(1),
            _ => bucket.AddDays(1)
        };
    }

    private static DateOnly StartOfWeek(DateOnly date)
    {
        var daysSinceMonday = ((int)date.DayOfWeek - (int)DayOfWeek.Monday + 7) % 7;
        return date.AddDays(-daysSinceMonday);
    }

    private static decimal CalculatePositiveChapterAdvance(decimal? previous, decimal? current)
    {
        if (previous is null || current is null || current <= previous)
        {
            return 0m;
        }

        return current.Value - previous.Value;
    }

    private sealed record RelationCountRow(string Name, int BookCount);

    private sealed record ProgressHistoryRow(
        Guid BookId,
        Guid Id,
        DateTimeOffset ChangedAt,
        decimal? ChapterNumber,
        string? ChapterLabel);

    private sealed record LibraryGrowthRow(string Type, DateTimeOffset Created);

    private sealed record LibraryGrowthDatedRow(string Type, DateOnly Created);

    private sealed record QualityCoverRow(
        Guid BookId,
        BookCoverStatus? Status,
        BookCoverSource? Source,
        string? StoragePath,
        string? ThumbnailStoragePath);

    private sealed record QualityCompletenessRow(
        Guid BookId,
        bool HasAuthor,
        string? Description,
        bool HasGenre,
        bool HasTag,
        bool HasRating,
        bool HasPriority,
        bool HasTotalChapters,
        bool HasLink,
        BookCoverStatus? Status,
        string? StoragePath,
        string? ThumbnailStoragePath);

    private sealed class ActivityPointAccumulator
    {
        public int ProgressEvents { get; set; }
        public HashSet<Guid> BookIds { get; } = [];
        public decimal ChaptersAdvanced { get; set; }
    }
}
