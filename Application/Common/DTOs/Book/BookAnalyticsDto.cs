namespace Application.Common.DTOs.Book;

public sealed record BookAnalyticsDto
{
    public DateTimeOffset GeneratedAt { get; init; }
    public required BookAnalyticsScopeDto Scope { get; init; }
    public required BookAnalyticsOverviewDto Overview { get; init; }
    public BookAnalyticsCompositionDto Composition { get; init; } = new();
    public BookAnalyticsRatingsDto Ratings { get; init; } = new();
    public BookAnalyticsPlanningDto Planning { get; init; } = new();
    public BookAnalyticsProgressDto Progress { get; init; } = new();
    public BookAnalyticsActivityDto Activity { get; init; } = new();
    public BookAnalyticsLibraryGrowthDto LibraryGrowth { get; init; } = new();
    public BookAnalyticsQualityDto Quality { get; init; } = new();
}

public sealed record BookAnalyticsScopeDto
{
    public string? Query { get; init; }
    public DateOnly From { get; init; }
    public DateOnly To { get; init; }
    public required string Bucket { get; init; }
}

public sealed record BookAnalyticsOverviewDto
{
    public int TotalBooks { get; init; }
    public int RatedBooks { get; init; }
    public int UnratedBooks { get; init; }
    public double? AverageRating { get; init; }
    public decimal CurrentChapters { get; init; }
    public int BooksWithKnownCurrentChapter { get; init; }
    public int BooksWithoutKnownCurrentChapter { get; init; }
}

public sealed record BookAnalyticsCompositionDto
{
    public IReadOnlyList<BookAnalyticsStatusByTypeDto> StatusByType { get; init; } = [];
    public IReadOnlyList<BookAnalyticsRelationCountDto> Genres { get; init; } = [];
    public IReadOnlyList<BookAnalyticsRelationCountDto> Tags { get; init; } = [];
}

public sealed record BookAnalyticsStatusByTypeDto
{
    public required string Type { get; init; }
    public int TotalBooks { get; init; }
    public IReadOnlyList<BookAnalyticsStatusCountDto> Statuses { get; init; } = [];
}

public sealed record BookAnalyticsStatusCountDto
{
    public required string Status { get; init; }
    public int BookCount { get; init; }
}

public sealed record BookAnalyticsRelationCountDto
{
    public required string Name { get; init; }
    public int BookCount { get; init; }
    public double ShareOfBooks { get; init; }
}

public sealed record BookAnalyticsRatingsDto
{
    public int RatedBooks { get; init; }
    public int UnratedBooks { get; init; }
    public double? AverageRating { get; init; }
    public IReadOnlyList<BookAnalyticsRatingCountDto> Counts { get; init; } = [];
}

public sealed record BookAnalyticsRatingCountDto
{
    public int Rating { get; init; }
    public int BookCount { get; init; }
}

public sealed record BookAnalyticsPlanningDto
{
    public IReadOnlyList<BookAnalyticsPrioritiesByStatusDto> PrioritiesByStatus { get; init; } = [];
}

public sealed record BookAnalyticsPrioritiesByStatusDto
{
    public required string Status { get; init; }
    public int TotalBooks { get; init; }
    public IReadOnlyList<BookAnalyticsPriorityCountDto> Priorities { get; init; } = [];
}

public sealed record BookAnalyticsPriorityCountDto
{
    public required string Priority { get; init; }
    public int BookCount { get; init; }
}

public sealed record BookAnalyticsProgressDto
{
    public IReadOnlyList<BookAnalyticsTypeVolumeDto> TypeVolumes { get; init; } = [];
}

public sealed record BookAnalyticsTypeVolumeDto
{
    public required string Type { get; init; }
    public int BookCount { get; init; }
    public decimal CurrentChapters { get; init; }
    public decimal? AverageCurrentChapter { get; init; }
    public decimal? MedianCurrentChapter { get; init; }
    /// <summary>Books with status Reading.</summary>
    public int ReadingBooks { get; init; }
    public int ReadingBooksWithKnownTotal { get; init; }
    /// <summary>Chapters left in Reading books whose total is known.</summary>
    public decimal RemainingChapters { get; init; }
}

public sealed record BookAnalyticsActivityDto
{
    public decimal BaselineChapters { get; init; }
    public IReadOnlyList<BookAnalyticsActivityPointDto> Points { get; init; } = [];
}

public sealed record BookAnalyticsActivityPointDto
{
    public DateOnly Date { get; init; }
    public int ProgressEvents { get; init; }
    public int BooksTouched { get; init; }
    public decimal ChaptersAdvanced { get; init; }
}

public sealed record BookAnalyticsLibraryGrowthDto
{
    public int OpeningCount { get; init; }
    public IReadOnlyList<BookAnalyticsLibraryGrowthPointDto> Points { get; init; } = [];
}

public sealed record BookAnalyticsLibraryGrowthPointDto
{
    public DateOnly Date { get; init; }
    public int BooksAdded { get; init; }
    public int CumulativeBooks { get; init; }
    public IReadOnlyList<BookAnalyticsTypeCountDto> ByType { get; init; } = [];
}

public sealed record BookAnalyticsTypeCountDto
{
    public required string Type { get; init; }
    public int BookCount { get; init; }
}

public sealed record BookAnalyticsQualityDto
{
    public IReadOnlyList<BookAnalyticsFieldCompletenessDto> FieldCompleteness { get; init; } = [];
    public IReadOnlyList<BookAnalyticsLinkSourceDto> LinkSources { get; init; } = [];
    public IReadOnlyList<BookAnalyticsCoverStatusDto> CoverStatuses { get; init; } = [];
    public IReadOnlyList<BookAnalyticsCoverSourceDto> CoverSources { get; init; } = [];
}

public sealed record BookAnalyticsFieldCompletenessDto
{
    public required string Field { get; init; }
    public int BookCount { get; init; }
    public double ShareOfBooks { get; init; }
}

public sealed record BookAnalyticsLinkSourceDto
{
    public required string Source { get; init; }
    public int LinkCount { get; init; }
    public int BookCount { get; init; }
    public double ShareOfBooks { get; init; }
}

public sealed record BookAnalyticsCoverStatusDto
{
    public required string Status { get; init; }
    public int BookCount { get; init; }
    public double ShareOfBooks { get; init; }
}

public sealed record BookAnalyticsCoverSourceDto
{
    public required string Source { get; init; }
    public int BookCount { get; init; }
    public double ShareOfBooks { get; init; }
}
