namespace Application.Common.DTOs.Book;

public sealed record EpubSearchRequest(string Query, string Scope = "english", bool ForceRefresh = false);
public sealed record EpubRange(string Kind, double? From = null, double? To = null);
public sealed record EpubDownloadRequest(Guid SourceId, EpubRange Range, int SplitEvery,
    string TitleTemplate, int FirstFileNumber, bool AddToBookAutomatically, string RequestKey);
public sealed record CrawlerChapter(string Id, string Url, string Label);
public sealed record EpubSource(Guid Id, string SourceName, string Url, int? ChapterCount,
    string? LatestChapterLabel, DateTime? UpdatedAt, string Language, DateTime? FetchedAt = null);
public sealed record EpubCandidate(string Id, string Title, string Match, IReadOnlyList<EpubSource> Sources);
public sealed record EpubSearchResult(IReadOnlyList<EpubCandidate> Candidates, int SearchedSourceCount,
    long DurationMs, IReadOnlyList<string> Warnings, int TotalSourceCount = 0,
    int CheckedLinkCount = 0, int TotalLinkCount = 0, string? CurrentSource = null,
    DateTime? NextRetryAt = null, int RetryAttempt = 0, string? Query = null, string? Scope = null, int SkippedSourceCount = 0);
public sealed record EpubSearchJob(Guid Id, string Status, EpubSearchResult? Result, string? Error);
public sealed class EpubDownloadFile
{
    public string Title { get; set; } = "";
    public int FirstChapter { get; set; }
    public int LastChapter { get; set; }
    public int ChaptersDone { get; set; }
    public string Status { get; set; } = "waiting";
    public Guid? ImportSessionId { get; set; }
    public Guid? AttachmentId { get; set; }
}
public sealed class EpubDownloadJob
{
    public Guid Id { get; set; }
    public Guid BookId { get; set; }
    public string SourceName { get; set; } = "";
    public string? BookTitle { get; set; }
    public string Status { get; set; } = "queued";
    public int ChaptersDone { get; set; }
    public int ChaptersTotal { get; set; }
    public List<EpubDownloadFile> Files { get; set; } = [];
    public DateTime StartedAt { get; set; }
    public string? Error { get; set; }
    public DateTime? NextRetryAt { get; set; }
    public int RetryAttempt { get; set; }
}
