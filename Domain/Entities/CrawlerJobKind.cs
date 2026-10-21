namespace Domain.Entities;

/// <summary>Values of <see cref="CrawlerJob.Kind"/>.</summary>
public static class CrawlerJobKind
{
    /// <summary>A search the user started from Find EPUB.</summary>
    public const string Search = "search";
    /// <summary>The background library search that finds sources for new books.</summary>
    public const string Discovery = "discovery";
    /// <summary>A periodic chapter index refresh of a tracked source.</summary>
    public const string Scan = "scan";
    public const string Download = "download";
    /// <summary>A re-read of one source before retrying a failed download.</summary>
    public const string Refresh = "refresh";
}
