namespace Infrastructure.Crawler;

using System.Security.Cryptography;
using System.Text.Json;
using Application.Common.DTOs.Book;

public sealed class CrawlerWork
{
    public string SearchRevision { get; set; } = "metadata-search-v2";
    public string Kind { get; set; } = "search";
    public string? Query { get; set; }
    public bool Background { get; set; }
    public bool InitialDiscovery { get; set; }
    public string Scope { get; set; } = "english";
    public string? Url { get; set; }
    public List<string> Urls { get; set; } = [];
    public Guid? SourceId { get; set; }
    public List<CrawlerChapter> Chapters { get; set; } = [];
    public List<CrawlerPlannedFile> Files { get; set; } = [];
    public EpubDownloadRequest? DownloadRequest { get; set; }
}

public sealed record CrawlerPlannedFile(string Title, int FirstChapter, int LastChapter, List<string> ChapterIds,
    Guid? ReplacesFileId = null);

public static class CrawlerPlan
{
    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    public static string Serialize<T>(T value) => JsonSerializer.Serialize(value, Json);
    public static T Read<T>(string value) => JsonSerializer.Deserialize<T>(value, Json)!;
    public static bool Terminal(string status) => status is "completed" or "failed" or "cancelled";

    public static bool AllowedHost(string host) =>
        !host.TrimEnd('.').Equals("novelupdates.com", StringComparison.OrdinalIgnoreCase) &&
        !host.TrimEnd('.').EndsWith(".novelupdates.com", StringComparison.OrdinalIgnoreCase);

    public static string SourceHost(string host) => host.StartsWith("www.", StringComparison.OrdinalIgnoreCase)
        ? host[4..].TrimEnd('.').ToLowerInvariant() : host.TrimEnd('.').ToLowerInvariant();

    public static bool SupportedUrl(string url, HashSet<string> domains) =>
        CanonicalUrl(url) is { } canonical && domains.Contains(SourceHost(new Uri(canonical).IdnHost));

    public static List<CrawlerPlannedFile> Files(EpubDownloadRequest request, List<CrawlerChapter> chapters,
        IReadOnlyList<EpubExistingVolume>? existingVolumes = null)
    {
        var range = request.Range;
        if (range is null || range.Kind is not ("all" or "fromProgress" or "custom") ||
            request.SplitEvery is < 1 or > 10000 || request.FirstFileNumber is < 1 or > 1000000 ||
            request.TitleTemplate is null || request.TitleTemplate.Length > 180 ||
            request.TitleTemplate.Any(char.IsControl))
            throw new ValidationException("Choose a valid chapter range, file size and title.");
        static int Number(double? value)
        {
            if (value is null || !double.IsFinite(value.Value) || value < 1 || value > int.MaxValue || value != Math.Floor(value.Value))
                throw new ValidationException("Chapter positions must be positive whole numbers.");
            return (int)value.Value;
        }
        var from = range.Kind == "all" ? 1 : Number(range.From);
        // The frontend uses MAX_SAFE_INTEGER for an open custom range.
        var to = range.Kind == "custom" && range.To < int.MaxValue ? Number(range.To) : chapters.Count;
        if (chapters.Count == 0 || from > chapters.Count || to < from)
            throw new ValidationException("There are no chapters in the selected range.");
        to = Math.Min(to, chapters.Count);
        var existing = request.RegenerateAffectedVolumes ? existingVolumes ?? [] : [];
        var affected = existing.FirstOrDefault(v => v.FirstChapter <= from && v.LastChapter + 1 >= from);
        if (affected != null) from = affected.FirstChapter;
        var result = new List<CrawlerPlannedFile>();
        var nextNumber = request.FirstFileNumber;
        var template = string.IsNullOrWhiteSpace(request.TitleTemplate) ? "Volume {n}" : request.TitleTemplate.Trim();
        for (var first = from; first <= to; first += request.SplitEvery)
        {
            var last = Math.Min(to, first + request.SplitEvery - 1);
            var previous = existing.FirstOrDefault(v => v.FirstChapter == first);
            if (previous != null && previous.LastChapter >= last) continue;
            if (existing.Any(v => v.FirstChapter <= last && v.LastChapter >= first && v.FileId != previous?.FileId))
                throw new ValidationException("Keep the existing chapters per file when regenerating volumes.");
            var number = nextNumber;
            var title = template.Contains("{n}", StringComparison.Ordinal)
                ? template.Replace("{n}", number.ToString(CultureInfo.InvariantCulture), StringComparison.Ordinal)
                : $"{template} {number}";
            if (previous == null) nextNumber++;
            result.Add(new(previous?.Title ?? title, first, last,
                chapters.Skip(first - 1).Take(last - first + 1).Select(c => c.Id).ToList(), previous?.FileId));
            if (result.Count > 100) throw new ValidationException("Choose at most 100 EPUB files per download.");
        }
        if (result.Count == 0) throw new ValidationException("These volumes already contain all selected chapters.");
        return result;
    }

    public static Guid ImportId(Guid jobId, int index) => new(SHA256.HashData(Encoding.UTF8.GetBytes($"{jobId:N}/{index}"))[..16]);

    public static DateTime NextScan(DateTime now, CrawlerOptions options) =>
        now.AddHours(options.MinScanHours + Random.Shared.NextDouble() * (options.MaxScanHours - options.MinScanHours));

    public static int? NewChapters(List<CrawlerChapter> chapters, string? boundary)
    {
        if (boundary == null) return null;
        var index = chapters.FindIndex(c => c.Url == boundary);
        return index < 0 ? null : chapters.Count - index - 1;
    }

    public static string? CanonicalUrl(string value)
    {
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri) || uri.Scheme is not ("http" or "https") ||
            uri.UserInfo.Length > 0 || !uri.IsDefaultPort || uri.HostNameType == UriHostNameType.IPv4 ||
            uri.HostNameType == UriHostNameType.IPv6 || uri.AbsolutePath.Trim('/').Length == 0 || value.Length > 2000 ||
            !AllowedHost(uri.IdnHost))
            return null;
        return new UriBuilder(uri) { Fragment = "", Host = uri.IdnHost.ToLowerInvariant() }.Uri.AbsoluteUri.TrimEnd('/');
    }
}
