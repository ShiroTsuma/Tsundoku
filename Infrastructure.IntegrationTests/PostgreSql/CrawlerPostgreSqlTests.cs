namespace Infrastructure.IntegrationTests.PostgreSql;

using Application.Common.DTOs.Book;
using Application.Common.Interfaces;
using Crawler;
using Domain.Entities;
using Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using System.Net;
using System.Text;
using System.Text.Json;
using TestSupport;

[Collection(PostgreSqlCollection.CollectionName)]
public sealed class CrawlerPostgreSqlTests(PostgreSqlFixture fixture) : IAsyncLifetime
{
    public Task InitializeAsync() => fixture.ResetDatabaseAsync();
    public Task DisposeAsync() => Task.CompletedTask;

    [Fact]
    public async Task ConcurrentSearchAndRefresh_JoinOneJob()
    {
        var owner = Guid.NewGuid();
        await using var db = fixture.CreateContext(owner);
        db.Users.Add(new User { Id = owner });
        var book = TestData.Book(owner, "Shared search");
        db.Books.Add(book); await db.SaveChangesAsync();
        async Task<Guid> Start(bool force)
        {
            await using var context = fixture.CreateContext(owner);
            var api = new EpubCrawlerService(context, new Reader(owner), Options.Create(new CrawlerOptions { Enabled = true }));
            return (await api.SearchAsync(book.Id, new(book.PrimaryTitle, "english", force), default)).Id;
        }
        var ids = await Task.WhenAll(Start(false), Start(true), Start(true));
        Assert.Single(ids.Distinct());
        Assert.Single(await db.CrawlerJobs.ToListAsync());
    }

    [Fact]
    public async Task RetryTimestamp_WithExplicitOffset_IsPersistedAsUtc()
    {
        var owner = Guid.NewGuid();
        await using var db = fixture.CreateContext(owner);
        db.Users.Add(new User { Id = owner });
        var book = TestData.Book(owner, "Crawler retry clock");
        db.Books.Add(book);
        await db.SaveChangesAsync();
        var options = Options.Create(new CrawlerOptions { Enabled = true, ApiKey = new string('x', 32) });
        var service = new EpubCrawlerService(db, new Reader(owner), options);
        var job = await service.SearchAsync(book.Id, new("Crawler retry clock"), default);
        var due = DateTimeOffset.UtcNow.AddMinutes(10);
        // Python emits +00:00, which System.Text.Json reads as a Local DateTime.
        var json = JsonSerializer.Serialize(new { status = "queued", novels = new object[0], files = new object[0],
            searchedSourceCount = 0, durationMs = 0, warnings = new string[0], nextRetryAt = due.ToString("O"), retryAttempt = 1 });
        using var http = new HttpClient(new SnapshotHandler(json)) { BaseAddress = new Uri("http://crawler/") };
        using var provider = new ServiceCollection().BuildServiceProvider();
        var worker = new CrawlerWorker(db, new CrawlerClient(http, options), provider, options, NullLogger<CrawlerWorker>.Instance);
        Assert.True(await worker.TickAsync(default));
        db.ChangeTracker.Clear();
        var stored = await db.CrawlerJobs.SingleAsync(j => j.Id == job.Id);
        Assert.Equal(DateTimeKind.Utc, stored.NextAttemptAtUtc.Kind);
        // PostgreSQL timestamps have microsecond precision.
        Assert.InRange(Math.Abs((stored.NextAttemptAtUtc - due.UtcDateTime).Ticks), 0, 10);
        Assert.Equal("queued", stored.Status);
    }

    private sealed class SnapshotHandler(string json) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct) =>
            Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(json, Encoding.UTF8, "application/json") });
    }

    [Fact]
    public async Task ConcurrentRetries_CreateOneDownload_AndBookDeletionCascadesIntegrationState()
    {
        var owner = Guid.NewGuid();
        await using var db = fixture.CreateContext(owner);
        db.Users.Add(new User { Id = owner });
        var book = TestData.Book(owner, "Crawler concurrency");
        db.Books.Add(book);
        var source = new BookCrawlerSource { OwnerId = owner, BookId = book.Id, Url = "https://example.com/novel/test",
            ChaptersJson = CrawlerPlan.Serialize(new[] { new CrawlerChapter("one", "https://example.com/chapter/1", "Prologue") }) };
        db.BookCrawlerSources.Add(source);
        await db.SaveChangesAsync();
        var request = new EpubDownloadRequest(source.Id, new("all"), 100, "Part {n}", 1, true, "same-request");
        async Task<Guid> Start()
        {
            await using var context = fixture.CreateContext(owner);
            var api = new EpubCrawlerService(context, new Reader(owner), Options.Create(new CrawlerOptions { Enabled = true }));
            return (await api.DownloadAsync(book.Id, request, default)).Id;
        }
        var ids = await Task.WhenAll(Start(), Start());
        Assert.Equal(ids[0], ids[1]);
        Assert.Single(await db.CrawlerJobs.ToListAsync());
        Assert.False(db.Database.HasPendingModelChanges());
        await db.Books.Where(b => b.Id == book.Id).ExecuteDeleteAsync();
        Assert.Empty(await db.CrawlerJobs.ToListAsync());
        Assert.Empty(await db.BookCrawlerSources.ToListAsync());
    }

    private sealed class Reader(Guid id) : IUser
    {
        public Guid? Id => id;
        public Guid RequiredId => id;
        public string? Email => null;
        public string? Username => null;
        public IEnumerable<string> Roles => [];
        public bool IsAuthenticated => true;
        public bool Valid => true;
    }
}
