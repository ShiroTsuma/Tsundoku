namespace Application.Common.DTOs.Book;

public sealed record CrawlerSourceSettings(bool Enabled, bool AlwaysInclude);
public sealed record CrawlerProcessingState(bool ProcessingEnabled);
public sealed record CrawlerSourceHealthSnapshot(bool ProcessingEnabled, IReadOnlyList<CrawlerSourceHealth> Sources);
public sealed record CrawlerSourceHealth(string Domain, string Url, string Language, bool CanSearch,
    bool Enabled, bool AlwaysInclude, int SampleCount, int SuccessCount, int TimeoutCount, int WarningCount,
    int RateLimitedCount, double? SuccessRate, double? TimeoutRate, double? WarningRate,
    double? LastObservedAt, bool AutoSkipped, double NextProbeAt);
