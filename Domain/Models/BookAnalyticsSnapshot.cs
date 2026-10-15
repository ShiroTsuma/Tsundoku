namespace Domain.Models;

public sealed record BookAnalyticsSnapshot(
    DateTimeOffset GeneratedAt,
    BookAnalyticsScopeSnapshot Scope,
    BookAnalyticsOverviewSnapshot Overview,
    BookAnalyticsCompositionSnapshot Composition,
    BookAnalyticsRatingsSnapshot Ratings,
    BookAnalyticsPlanningSnapshot Planning,
    BookAnalyticsProgressSnapshot Progress,
    BookAnalyticsActivitySnapshot Activity,
    BookAnalyticsLibraryGrowthSnapshot LibraryGrowth,
    BookAnalyticsQualitySnapshot Quality);

public sealed record BookAnalyticsScopeSnapshot(
    string? Query,
    DateOnly From,
    DateOnly To,
    string Bucket);

public sealed record BookAnalyticsOverviewSnapshot(
    int TotalBooks,
    int RatedBooks,
    int UnratedBooks,
    double? AverageRating,
    decimal CurrentChapters,
    int BooksWithKnownCurrentChapter,
    int BooksWithoutKnownCurrentChapter);

public sealed record BookAnalyticsCompositionSnapshot(
    IReadOnlyList<BookAnalyticsStatusByTypeSnapshot> StatusByType,
    IReadOnlyList<BookAnalyticsRelationCountSnapshot> Genres,
    IReadOnlyList<BookAnalyticsRelationCountSnapshot> Tags)
{
    public static BookAnalyticsCompositionSnapshot Empty { get; } = new([], [], []);
}

public sealed record BookAnalyticsStatusByTypeSnapshot(
    string Type,
    int TotalBooks,
    IReadOnlyList<BookAnalyticsStatusCountSnapshot> Statuses);

public sealed record BookAnalyticsStatusCountSnapshot(string Status, int BookCount);

public sealed record BookAnalyticsRelationCountSnapshot(string Name, int BookCount, double ShareOfBooks);

public sealed record BookAnalyticsRatingsSnapshot(
    int RatedBooks,
    int UnratedBooks,
    double? AverageRating,
    IReadOnlyList<BookAnalyticsRatingCountSnapshot> Counts)
{
    public static BookAnalyticsRatingsSnapshot Empty { get; } = new(0, 0, null, CreateEmptyCounts());

    public static IReadOnlyList<BookAnalyticsRatingCountSnapshot> CreateEmptyCounts()
    {
        return Enumerable.Range(1, 10)
            .Select(rating => new BookAnalyticsRatingCountSnapshot(rating, 0))
            .ToList();
    }
}

public sealed record BookAnalyticsRatingCountSnapshot(int Rating, int BookCount);

public sealed record BookAnalyticsPlanningSnapshot(
    IReadOnlyList<BookAnalyticsPrioritiesByStatusSnapshot> PrioritiesByStatus)
{
    public static BookAnalyticsPlanningSnapshot Empty { get; } = new([]);
}

public sealed record BookAnalyticsPrioritiesByStatusSnapshot(
    string Status,
    int TotalBooks,
    IReadOnlyList<BookAnalyticsPriorityCountSnapshot> Priorities);

public sealed record BookAnalyticsPriorityCountSnapshot(string Priority, int BookCount);

public sealed record BookAnalyticsProgressSnapshot(
    IReadOnlyList<BookAnalyticsTypeVolumeSnapshot> TypeVolumes)
{
    public static BookAnalyticsProgressSnapshot Empty { get; } = new([]);
}

public sealed record BookAnalyticsTypeVolumeSnapshot(
    string Type,
    int BookCount,
    decimal CurrentChapters,
    decimal? AverageCurrentChapter,
    decimal? MedianCurrentChapter,
    int ReadingBooks = 0,
    int ReadingBooksWithKnownTotal = 0,
    decimal RemainingChapters = 0m);

public sealed record BookAnalyticsActivitySnapshot(
    decimal BaselineChapters,
    IReadOnlyList<BookAnalyticsActivityPointSnapshot> Points)
{
    public static BookAnalyticsActivitySnapshot Empty { get; } = new(0m, []);
}

public sealed record BookAnalyticsActivityPointSnapshot(
    DateOnly Date,
    int ProgressEvents,
    int BooksTouched,
    decimal ChaptersAdvanced);

public sealed record BookAnalyticsLibraryGrowthSnapshot(
    int OpeningCount,
    IReadOnlyList<BookAnalyticsLibraryGrowthPointSnapshot> Points)
{
    public static BookAnalyticsLibraryGrowthSnapshot Empty { get; } = new(0, []);
}

public sealed record BookAnalyticsLibraryGrowthPointSnapshot(
    DateOnly Date,
    int BooksAdded,
    int CumulativeBooks,
    IReadOnlyList<BookAnalyticsTypeCountSnapshot> ByType);

public sealed record BookAnalyticsTypeCountSnapshot(string Type, int BookCount);

public sealed record BookAnalyticsQualitySnapshot(
    IReadOnlyList<BookAnalyticsFieldCompletenessSnapshot> FieldCompleteness,
    IReadOnlyList<BookAnalyticsLinkSourceSnapshot> LinkSources,
    IReadOnlyList<BookAnalyticsCoverStatusSnapshot> CoverStatuses,
    IReadOnlyList<BookAnalyticsCoverSourceSnapshot> CoverSources)
{
    public static IReadOnlyList<string> FieldNames { get; } = BookAnalyticsQualityFields.All;

    public static BookAnalyticsQualitySnapshot Empty { get; } = new(CreateEmptyFieldCompleteness(), [], [], []);

    public static IReadOnlyList<BookAnalyticsFieldCompletenessSnapshot> CreateEmptyFieldCompleteness()
    {
        return FieldNames
            .Select(field => new BookAnalyticsFieldCompletenessSnapshot(field, 0, 0))
            .ToList();
    }
}

public sealed record BookAnalyticsFieldCompletenessSnapshot(string Field, int BookCount, double ShareOfBooks);

public sealed record BookAnalyticsLinkSourceSnapshot(string Source, int LinkCount, int BookCount, double ShareOfBooks);

public sealed record BookAnalyticsCoverStatusSnapshot(string Status, int BookCount, double ShareOfBooks);

public sealed record BookAnalyticsCoverSourceSnapshot(string Source, int BookCount, double ShareOfBooks);
