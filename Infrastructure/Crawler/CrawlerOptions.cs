namespace Infrastructure.Crawler;

public sealed class CrawlerOptions
{
    public bool Enabled { get; set; }
    public bool RunJobs { get; set; } = true;
    public string BaseUrl { get; set; } = "http://crawler:8181";
    public string ApiKey { get; set; } = "";
    public int MaxConcurrentDownloads { get; set; } = 2;
    public int MaxActiveJobsPerOwner { get; set; } = 5;
    public TimeSpan JobLifetime { get; set; } = TimeSpan.FromHours(24);
    public double MinScanHours { get; set; } = 60;
    public double MaxScanHours { get; set; } = 72;
}
