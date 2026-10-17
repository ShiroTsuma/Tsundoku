namespace Domain.Entities;

using Domain.Common;

public sealed class CrawlerJob : BaseEntity
{
    public Guid OwnerId { get; set; }
    public Guid BookId { get; set; }
    public string Kind { get; set; } = "search";
    public string Status { get; set; } = "queued";
    public string RequestKey { get; set; } = "";
    public string RequestJson { get; set; } = "{}";
    public string ResultJson { get; set; } = "{}";
    public string? Error { get; set; }
    public bool CancelRequested { get; set; }
    public bool Submitted { get; set; }
    public DateTime CreatedAtUtc { get; set; }
    public DateTime NextAttemptAtUtc { get; set; }
    public DateTime? LeaseUntilUtc { get; set; }
    public DateTime ExpiresAtUtc { get; set; }
}

public sealed class BookCrawlerSource : BaseEntity
{
    public Guid OwnerId { get; set; }
    public Guid BookId { get; set; }
    public required string Url { get; set; }
    public string SourceName { get; set; } = "";
    public bool Selected { get; set; }
    public bool Tracked { get; set; }
    public DateTime NextScanAtUtc { get; set; }
    public DateTime? LastScannedAtUtc { get; set; }
    public string? LastError { get; set; }
    public string ChaptersJson { get; set; } = "[]";
    public string DownloadedUrlsJson { get; set; } = "[]";
    public string? DownloadBoundaryUrl { get; set; }
    public int? NewSinceDownload { get; set; }
}

public sealed class BookCrawlerDiscovery : BaseEntity
{
    public Guid OwnerId { get; set; }
    public Guid BookId { get; set; }
    public DateTime? LastCheckedAtUtc { get; set; }
    public DateTime NextCheckAtUtc { get; set; }
    public string ResultJson { get; set; } = "{}";
    public string? LastError { get; set; }
}
