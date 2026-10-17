namespace Infrastructure.Crawler;

using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Application.Common.DTOs.Book;
using Microsoft.Extensions.Options;

public interface ICrawlerClient
{
    Task<CrawlerProcessingState> ProcessingAsync(CancellationToken ct);
    Task<CrawlerProcessingState> SetProcessingAsync(CrawlerProcessingState state, CancellationToken ct);
    Task<IReadOnlyList<CrawlerSourceInfo>> SourcesAsync(CancellationToken ct);
    Task<CrawlerSourceHealthSnapshot> SourceHealthAsync(CancellationToken ct);
    Task UpdateSourceHealthAsync(string domain, CrawlerSourceSettings settings, CancellationToken ct);
    Task<CrawlerRemoteJob> SubmitAsync(Guid id, object request, CancellationToken ct);
    Task<CrawlerRemoteJob?> GetAsync(Guid id, CancellationToken ct);
    Task CancelAsync(Guid id, CancellationToken ct);
    Task<Stream> OpenFileAsync(Guid id, int index, CancellationToken ct);
    Task DeleteAsync(Guid id, CancellationToken ct);
    Task<IReadOnlyList<Guid>> ActiveJobsAsync(Guid? after, CancellationToken ct);
}

public sealed record CrawlerSourceInfo(string Domain, string Url, string Language, bool CanSearch);
public sealed record CrawlerNovel(string Title, string Url, string Domain, string Language,
    List<CrawlerChapter> Chapters, string? LatestChapterLabel = null, DateTime? UpdatedAt = null);
public sealed record CrawlerRemoteFile(string Title, int FirstChapter, int LastChapter, int ChaptersDone,
    string Status);
public sealed record CrawlerRemoteJob(string Status, List<CrawlerNovel> Novels, List<CrawlerRemoteFile> Files,
    int SearchedSourceCount, long DurationMs, List<string> Warnings, string? Error,
    int TotalSourceCount = 0, int CheckedLinkCount = 0, int TotalLinkCount = 0, string? CurrentSource = null,
    DateTime? NextRetryAt = null, int RetryAttempt = 0, int SkippedSourceCount = 0);

public sealed class CrawlerClient(HttpClient http, IOptions<CrawlerOptions> options) : ICrawlerClient
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public Task<CrawlerProcessingState> ProcessingAsync(CancellationToken ct) => ProcessingRequestAsync(HttpMethod.Get, null, ct);
    public Task<CrawlerProcessingState> SetProcessingAsync(CrawlerProcessingState state, CancellationToken ct) =>
        ProcessingRequestAsync(HttpMethod.Put, state, ct);

    private async Task<CrawlerProcessingState> ProcessingRequestAsync(HttpMethod method, CrawlerProcessingState? state, CancellationToken ct)
    {
        using var request = Request(method, "integration/processing", state);
        using var response = await http.SendAsync(request, ct);
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<CrawlerProcessingState>(Json, ct))!;
    }

    public async Task<CrawlerSourceHealthSnapshot> SourceHealthAsync(CancellationToken ct)
    {
        using var request = Request(HttpMethod.Get, "integration/source-health");
        using var response = await http.SendAsync(request, ct);
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<CrawlerSourceHealthSnapshot>(Json, ct))!;
    }

    public async Task UpdateSourceHealthAsync(string domain, CrawlerSourceSettings settings, CancellationToken ct)
    {
        using var request = Request(HttpMethod.Put, $"integration/source-health/{Uri.EscapeDataString(domain)}", settings);
        using var response = await http.SendAsync(request, ct);
        if (response.StatusCode == HttpStatusCode.BadRequest) throw new ValidationException("Choose a supported crawler source.");
        response.EnsureSuccessStatusCode();
    }

    public async Task<IReadOnlyList<Guid>> ActiveJobsAsync(Guid? after, CancellationToken ct)
    {
        using var request = Request(HttpMethod.Get, "integration/active-jobs" + (after is {} id ? $"?after={id}" : ""));
        using var response = await http.SendAsync(request, ct);
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadFromJsonAsync<List<Guid>>(Json, ct) ?? [];
    }

    private HttpRequestMessage Request(HttpMethod method, string path, object? body = null)
    {
        var request = new HttpRequestMessage(method, path);
        request.Headers.Add("X-Crawler-Key", options.Value.ApiKey);
        if (body != null) request.Content = JsonContent.Create(body, options: Json);
        return request;
    }

    public async Task<IReadOnlyList<CrawlerSourceInfo>> SourcesAsync(CancellationToken ct)
    {
        using var request = Request(HttpMethod.Get, "integration/sources");
        using var response = await http.SendAsync(request, ct);
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadFromJsonAsync<List<CrawlerSourceInfo>>(Json, ct) ?? [];
    }

    public async Task<CrawlerRemoteJob> SubmitAsync(Guid id, object body, CancellationToken ct)
    {
        using var request = Request(HttpMethod.Put, $"integration/jobs/{id}", body);
        using var response = await http.SendAsync(request, ct);
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<CrawlerRemoteJob>(Json, ct))!;
    }

    public async Task<CrawlerRemoteJob?> GetAsync(Guid id, CancellationToken ct)
    {
        using var request = Request(HttpMethod.Get, $"integration/jobs/{id}");
        using var response = await http.SendAsync(request, ct);
        if (response.StatusCode == HttpStatusCode.NotFound) return null;
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadFromJsonAsync<CrawlerRemoteJob>(Json, ct);
    }

    public async Task CancelAsync(Guid id, CancellationToken ct)
    {
        using var request = Request(HttpMethod.Post, $"integration/jobs/{id}/cancel");
        using var response = await http.SendAsync(request, ct);
        if (response.StatusCode != HttpStatusCode.NotFound) response.EnsureSuccessStatusCode();
    }

    public async Task DeleteAsync(Guid id, CancellationToken ct)
    {
        using var request = Request(HttpMethod.Delete, $"integration/jobs/{id}");
        using var response = await http.SendAsync(request, ct);
        if (response.StatusCode != HttpStatusCode.NotFound) response.EnsureSuccessStatusCode();
    }

    public async Task<Stream> OpenFileAsync(Guid id, int index, CancellationToken ct)
    {
        using var request = Request(HttpMethod.Get, $"integration/jobs/{id}/files/{index}");
        var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ct);
        try
        {
            response.EnsureSuccessStatusCode();
            return new ResponseStream(await response.Content.ReadAsStreamAsync(ct), response);
        }
        catch { response.Dispose(); throw; }
    }

    private sealed class ResponseStream(Stream inner, HttpResponseMessage response) : Stream
    {
        public override bool CanRead => inner.CanRead;
        public override bool CanSeek => false;
        public override bool CanWrite => false;
        public override long Length => throw new NotSupportedException();
        public override long Position { get => throw new NotSupportedException(); set => throw new NotSupportedException(); }
        public override int Read(byte[] buffer, int offset, int count) => inner.Read(buffer, offset, count);
        public override ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken ct = default) => inner.ReadAsync(buffer, ct);
        protected override void Dispose(bool disposing) { if (disposing) { inner.Dispose(); response.Dispose(); } base.Dispose(disposing); }
        public override void Flush() => throw new NotSupportedException();
        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
        public override void SetLength(long value) => throw new NotSupportedException();
        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
    }
}
