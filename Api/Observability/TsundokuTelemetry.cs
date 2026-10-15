namespace Api.Observability;

using System.Diagnostics.Metrics;

public static class TsundokuTelemetry
{
    public const string ServiceName = "Tsundoku.Api";
    public const string ActivitySourceName = ServiceName;
    public const string MeterName = ServiceName;

    public static readonly ActivitySource ActivitySource = new(ActivitySourceName);
    public static readonly Meter Meter = new(MeterName);

    public static readonly Counter<long> BooksCreated = Meter.CreateCounter<long>("tsundoku.book.created");
    public static readonly Counter<long> BooksUpdated = Meter.CreateCounter<long>("tsundoku.book.updated");

    public static readonly Counter<long> BookProgressUpdated =
        Meter.CreateCounter<long>("tsundoku.book.progress_updated");

    public static readonly Counter<long> BookSearchRequests = Meter.CreateCounter<long>("tsundoku.search.requests");

    public static readonly Counter<long> RateLimitRejections =
        Meter.CreateCounter<long>("tsundoku.security.rate_limit_rejections");

    public static readonly Counter<long> AdminDictionaryCreated =
        Meter.CreateCounter<long>("tsundoku.admin.dictionary.created");
}
