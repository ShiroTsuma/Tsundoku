namespace Application.Common;

using Domain.Models;
using DTOs.Book;

public static partial class MappingExtensions
{
    public static BookAnalyticsDto ToDto(this BookAnalyticsSnapshot source)
    {
        return new BookAnalyticsDto
        {
            GeneratedAt = source.GeneratedAt,
            Scope =
                new BookAnalyticsScopeDto
                {
                    Query = source.Scope.Query,
                    From = source.Scope.From,
                    To = source.Scope.To,
                    Bucket = source.Scope.Bucket
                },
            Overview = new BookAnalyticsOverviewDto
            {
                TotalBooks = source.Overview.TotalBooks,
                RatedBooks = source.Overview.RatedBooks,
                UnratedBooks = source.Overview.UnratedBooks,
                AverageRating = source.Overview.AverageRating,
                CurrentChapters = source.Overview.CurrentChapters,
                BooksWithKnownCurrentChapter = source.Overview.BooksWithKnownCurrentChapter,
                BooksWithoutKnownCurrentChapter = source.Overview.BooksWithoutKnownCurrentChapter
            },
            Composition = new BookAnalyticsCompositionDto
            {
                StatusByType = source.Composition.StatusByType
                    .Select(item => new BookAnalyticsStatusByTypeDto
                    {
                        Type = item.Type,
                        TotalBooks = item.TotalBooks,
                        Statuses = item.Statuses
                            .Select(status => new BookAnalyticsStatusCountDto
                            {
                                Status = status.Status, BookCount = status.BookCount
                            })
                            .ToList()
                    })
                    .ToList(),
                Genres = source.Composition.Genres
                    .Select(item => new BookAnalyticsRelationCountDto
                    {
                        Name = item.Name, BookCount = item.BookCount, ShareOfBooks = ToPercentage(item.ShareOfBooks)
                    })
                    .ToList(),
                Tags = source.Composition.Tags
                    .Select(item => new BookAnalyticsRelationCountDto
                    {
                        Name = item.Name, BookCount = item.BookCount, ShareOfBooks = ToPercentage(item.ShareOfBooks)
                    })
                    .ToList()
            },
            Ratings = new BookAnalyticsRatingsDto
            {
                RatedBooks = source.Ratings.RatedBooks,
                UnratedBooks = source.Ratings.UnratedBooks,
                AverageRating = source.Ratings.AverageRating,
                Counts = source.Ratings.Counts
                    .Select(item => new BookAnalyticsRatingCountDto
                    {
                        Rating = item.Rating, BookCount = item.BookCount
                    })
                    .ToList()
            },
            Planning = new BookAnalyticsPlanningDto
            {
                PrioritiesByStatus = source.Planning.PrioritiesByStatus
                    .Select(item => new BookAnalyticsPrioritiesByStatusDto
                    {
                        Status = item.Status,
                        TotalBooks = item.TotalBooks,
                        Priorities = item.Priorities
                            .Select(priority => new BookAnalyticsPriorityCountDto
                            {
                                Priority = priority.Priority, BookCount = priority.BookCount
                            })
                            .ToList()
                    })
                    .ToList()
            },
            Progress = new BookAnalyticsProgressDto
            {
                TypeVolumes = source.Progress.TypeVolumes
                    .Select(item => new BookAnalyticsTypeVolumeDto
                    {
                        Type = item.Type,
                        BookCount = item.BookCount,
                        CurrentChapters = item.CurrentChapters,
                        AverageCurrentChapter = item.AverageCurrentChapter,
                        MedianCurrentChapter = item.MedianCurrentChapter,
                        ReadingBooks = item.ReadingBooks,
                        ReadingBooksWithKnownTotal = item.ReadingBooksWithKnownTotal,
                        RemainingChapters = item.RemainingChapters
                    })
                    .ToList()
            },
            Activity = new BookAnalyticsActivityDto
            {
                BaselineChapters = source.Activity.BaselineChapters,
                Points = source.Activity.Points
                    .Select(item => new BookAnalyticsActivityPointDto
                    {
                        Date = item.Date,
                        ProgressEvents = item.ProgressEvents,
                        BooksTouched = item.BooksTouched,
                        ChaptersAdvanced = item.ChaptersAdvanced
                    })
                    .ToList()
            },
            LibraryGrowth = new BookAnalyticsLibraryGrowthDto
            {
                OpeningCount = source.LibraryGrowth.OpeningCount,
                Points = source.LibraryGrowth.Points
                    .Select(item => new BookAnalyticsLibraryGrowthPointDto
                    {
                        Date = item.Date,
                        BooksAdded = item.BooksAdded,
                        CumulativeBooks = item.CumulativeBooks,
                        ByType = item.ByType
                            .Select(type => new BookAnalyticsTypeCountDto
                            {
                                Type = type.Type, BookCount = type.BookCount
                            })
                            .ToList()
                    })
                    .ToList()
            },
            Quality = new BookAnalyticsQualityDto
            {
                FieldCompleteness = source.Quality.FieldCompleteness
                    .Select(item => new BookAnalyticsFieldCompletenessDto
                    {
                        Field = item.Field,
                        BookCount = item.BookCount,
                        ShareOfBooks = ToPercentage(item.ShareOfBooks)
                    })
                    .ToList(),
                LinkSources = source.Quality.LinkSources
                    .Select(item => new BookAnalyticsLinkSourceDto
                    {
                        Source = item.Source,
                        LinkCount = item.LinkCount,
                        BookCount = item.BookCount,
                        ShareOfBooks = ToPercentage(item.ShareOfBooks)
                    })
                    .ToList(),
                CoverStatuses = source.Quality.CoverStatuses
                    .Select(item => new BookAnalyticsCoverStatusDto
                    {
                        Status = item.Status,
                        BookCount = item.BookCount,
                        ShareOfBooks = ToPercentage(item.ShareOfBooks)
                    })
                    .ToList(),
                CoverSources = source.Quality.CoverSources
                    .Select(item => new BookAnalyticsCoverSourceDto
                    {
                        Source = item.Source,
                        BookCount = item.BookCount,
                        ShareOfBooks = ToPercentage(item.ShareOfBooks)
                    })
                    .ToList()
            }
        };
    }

    private static double ToPercentage(double share)
    {
        return Math.Clamp(share * 100, 0, 100);
    }
}
