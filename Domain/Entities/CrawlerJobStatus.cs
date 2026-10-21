namespace Domain.Entities;

/// <summary>Values of <see cref="CrawlerJob.Status"/>. Remote crawler statuses use the same names.</summary>
public static class CrawlerJobStatus
{
    public const string Queued = "queued";
    public const string Crawling = "crawling";
    public const string Adding = "adding";
    public const string Completed = "completed";
    public const string Failed = "failed";
    public const string Cancelled = "cancelled";

    public static readonly string[] Terminal = [Completed, Failed, Cancelled];

    public static bool IsTerminal(string status) => status is Completed or Failed or Cancelled;
}
