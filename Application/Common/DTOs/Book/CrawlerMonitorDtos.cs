namespace Application.Common.DTOs.Book;

public sealed record CrawlerMonitorSnapshot(bool Enabled, DateTime ObservedAtUtc,
    int TotalBooks, int CheckedBooks, int PendingBooks, int RunningJobs, int WaitingJobs,
    int TrackedSources, int TotalJobs, int Skip, int Take, IReadOnlyList<CrawlerMonitorJob> Jobs, bool ProcessingEnabled = true);

public sealed record CrawlerMonitorJob(Guid Id, Guid BookId, string BookTitle, string? Username,
    string Kind, string Status, DateTime CreatedAtUtc, DateTime NextAttemptAtUtc,
    int RetryAttempt, DateTime? NextRetryAt, string? CurrentSource, int SearchedSourceCount,
    int TotalSourceCount, int CheckedLinkCount, int TotalLinkCount, int ChaptersDone,
    int ChaptersTotal, int ReadyFiles, int TotalFiles, IReadOnlyList<string> Warnings, string? Error);
