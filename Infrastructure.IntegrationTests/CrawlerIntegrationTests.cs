namespace Infrastructure.IntegrationTests;

using Application.Common.DTOs.Book;
using Application.Common.Interfaces;
using System.IO.Compression;
using BookFiles;
using BookCovers;
using Crawler;
using Domain.Entities;
using Domain.Exceptions;
using FluentValidation;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Microsoft.Extensions.Caching.Distributed;
using Microsoft.Extensions.Caching.Memory;
using Services;
using TestSupport;

public sealed class CrawlerIntegrationTests
{
    [Fact]
    public async Task SourceSettings_RequireAdmin_AndRejectUnsupportedHosts()
    {
        using var h = new Harness();
        var member = new CrawlerSourceAdminService(h.Remote, h.User);
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => member.GetAsync(default));
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => member.ProcessingAsync(default));
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => member.SetProcessingAsync(new(true), default));
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => member.UpdateAsync("example.com", new(false, true), default));
        var admin = new CrawlerSourceAdminService(h.Remote, new Reader(h.User.RequiredId, true));
        await admin.GetAsync(default);
        Assert.False((await admin.SetProcessingAsync(new(false), default)).ProcessingEnabled);
        Assert.False((await admin.ProcessingAsync(default)).ProcessingEnabled);
        var monitor = new CrawlerMonitorService(h.Db, h.User, h.Options, h.Remote);
        Assert.False((await monitor.GetAsync(false, "active", 0, 20, default)).ProcessingEnabled);
        Assert.True((await admin.SetProcessingAsync(new(true), default)).ProcessingEnabled);
        await admin.UpdateAsync("example.com", new(false, true), default);
        await Assert.ThrowsAsync<ValidationException>(() => admin.UpdateAsync("novelupdates.com", new(true, true), default));
        await Assert.ThrowsAsync<ValidationException>(() => admin.UpdateAsync("https://example.com/path", new(true, true), default));
    }

    [Fact]
    public async Task Search_JoinsBackgroundDiscovery_EvenWhenWaitingAndRefreshIsRequested()
    {
        using var h = new Harness(); var book = await h.Book();
        await h.Worker.MaintainAsync(default);
        var background = await h.Db.CrawlerJobs.SingleAsync(j => j.Kind == "discovery");
        background.CreatedAtUtc = DateTime.UtcNow.AddMinutes(-30);
        background.NextAttemptAtUtc = DateTime.UtcNow.AddMinutes(10);
        await h.Db.SaveChangesAsync();
        var joined = await h.Api.SearchAsync(book.Id, new(book.PrimaryTitle, "english"), default);
        Assert.Equal(background.Id, joined.Id);
        Assert.Equal(background.Id, (await h.Api.SearchAsync(book.Id, new(book.PrimaryTitle, "english", true), default)).Id);
        Assert.Equal("queued", (await h.Api.GetSearchAsync(joined.Id, default)).Status);
        Assert.Single(await h.Db.CrawlerJobs.ToListAsync());
        var stranger = new EpubCrawlerService(h.Db, new Reader(Guid.NewGuid()), h.Options);
        await Assert.ThrowsAsync<EntityNotFoundException<CrawlerJob, Guid>>(() => stranger.GetSearchAsync(joined.Id, default));
    }

    [Fact]
    public async Task Search_ReusesDurableSuccessWithWarnings_AfterRemoteJobsAreCleanedUp()
    {
        using var h = new Harness(); var book = await h.Book();
        await h.Worker.MaintainAsync(default);
        h.Remote.Snapshot = new("completed", [new(book.PrimaryTitle, "https://example.com/novel/test", "example.com", "en", Chapters())], [], 35, 100, ["One source unavailable"], null);
        await h.Worker.TickAsync(default);
        var saved = await h.Db.BookCrawlerDiscoveries.SingleAsync();
        await h.Db.CrawlerJobs.ExecuteDeleteAsync();
        h.Db.ChangeTracker.Clear();
        var cached = await h.Api.SearchAsync(book.Id, new(book.PrimaryTitle), default);
        Assert.Equal(saved.Id, cached.Id);
        Assert.Equal("completed", cached.Status);
        Assert.Single(cached.Result!.Candidates);
        Assert.Equal("One source unavailable", Assert.Single(cached.Result.Warnings));
        Assert.Empty(await h.Db.CrawlerJobs.ToListAsync());
        Assert.Single((await h.Api.GetSearchAsync(cached.Id, default)).Result!.Candidates);
        var stranger = new EpubCrawlerService(h.Db, new Reader(Guid.NewGuid()), h.Options);
        await Assert.ThrowsAsync<EntityNotFoundException<CrawlerJob, Guid>>(() => stranger.GetSearchAsync(cached.Id, default));
        var refresh = await h.Api.SearchAsync(book.Id, new(book.PrimaryTitle, "english", true), default);
        Assert.NotEqual(cached.Id, refresh.Id);
        Assert.Single(refresh.Result!.Candidates);
        Assert.Equal(refresh.Id, (await h.Api.SearchAsync(book.Id, new(book.PrimaryTitle, "english", true), default)).Id);
        await h.Worker.MaintainAsync(default);
        Assert.Single(await h.Db.CrawlerJobs.ToListAsync());
    }

    [Fact]
    public async Task Search_RespectsQueryAndScope_AndManualResultsPreventDuplicateInitialDiscovery()
    {
        using var h = new Harness(); var book = await h.Book();
        var english = await h.Api.SearchAsync(book.Id, new(book.PrimaryTitle), default);
        await h.Worker.MaintainAsync(default);
        Assert.Single(await h.Db.CrawlerJobs.ToListAsync());
        h.Remote.Snapshot = new("completed", [new(book.PrimaryTitle, "https://example.com/novel/test", "example.com", "en", Chapters())], [], 35, 100, [], null);
        await h.Worker.TickAsync(default);
        var saved = await h.Db.BookCrawlerDiscoveries.SingleAsync();
        Assert.NotNull(saved.LastCheckedAtUtc);
        await h.Worker.MaintainAsync(default);
        Assert.Single(await h.Db.CrawlerJobs.ToListAsync());
        var cached = await h.Api.SearchAsync(book.Id, new(book.PrimaryTitle), default);
        Assert.Equal("completed", cached.Status);
        var broader = await h.Api.SearchAsync(book.Id, new(book.PrimaryTitle, "all"), default);
        Assert.NotEqual(english.Id, broader.Id);
        Assert.Equal("queued", broader.Status);
        Assert.Equal(broader.Id, (await h.Api.SearchAsync(book.Id, new(book.PrimaryTitle), default)).Id);
        var different = await h.Api.SearchAsync(book.Id, new("Different title"), default);
        Assert.NotEqual(broader.Id, different.Id);
        Assert.Null(different.Result);
    }

    [Fact]
    public async Task BackgroundBacklog_DoesNotConsumeManualJobLimit()
    {
        using var h = new Harness();
        var book = await h.Book();
        for (var i = 0; i < 20; i++)
            h.Db.CrawlerJobs.Add(new CrawlerJob { OwnerId = h.User.RequiredId, BookId = book.Id,
                Kind = i % 2 == 0 ? "scan" : "discovery", CreatedAtUtc = DateTime.UtcNow,
                ExpiresAtUtc = DateTime.UtcNow.AddHours(24), RequestKey = Guid.NewGuid().ToString("N") });
        await h.Db.SaveChangesAsync();
        for (var i = 0; i < 5; i++)
            Assert.Equal("queued", (await h.Api.SearchAsync(book.Id, new($"Manual query {i}"), default)).Status);
        await Assert.ThrowsAsync<ValidationException>(() => h.Api.SearchAsync(book.Id, new("Manual query six"), default));
    }

    [Fact]
    public async Task SavedLinks_TrackOnlySupportedSources_AndRefreshThemBeforeDiscoveryEveryThreeDays()
    {
        using var h = new Harness();
        var book = await h.Book();
        const string url = "https://www.example.com/novel/test";
        h.Db.BookLinks.AddRange(
            new BookLink { BookId = book.Id, Url = "https://www.novelupdates.com/series/test/", SourceType = "Other" },
            new BookLink { BookId = book.Id, Url = "https://unhandled.example/novel/test", SourceType = "Other" },
            new BookLink { BookId = book.Id, Url = url, SourceType = "Other" });
        // Even if an upstream version advertises NU, it is excluded by our policy.
        h.Remote.Catalog.Add(new("novelupdates.com", "https://novelupdates.com", "en", true));
        await h.Db.SaveChangesAsync();
        await h.Worker.MaintainAsync(default);
        var source = Assert.Single(await h.Db.BookCrawlerSources.ToListAsync());
        Assert.Equal(url, source.Url);
        Assert.True(source.Tracked);
        h.Remote.Snapshot = new("completed", [new("Test", url, "example.com", "en", Chapters())], [], 0, 10, [], null);
        await h.Worker.TickAsync(default);
        Assert.Equal("inspect", Assert.Single(h.Remote.Submissions).Kind);
        Assert.Equal(url, h.Remote.Submissions[0].Url);
        var monitor = new CrawlerMonitorService(h.Db, h.User, h.Options, h.Remote);
        var scan = Assert.Single((await monitor.GetAsync(false, "recent", 0, 20, default)).Jobs, j => j.Kind == "scan");
        Assert.Equal("www.example.com", scan.CurrentSource);
        Assert.NotNull(source.LastScannedAtUtc);
        Assert.InRange(source.NextScanAtUtc - DateTime.UtcNow, TimeSpan.FromHours(59.9), TimeSpan.FromHours(72));
        await h.Worker.MaintainAsync(default);
        Assert.Single(await h.Db.CrawlerJobs.Where(j => j.Kind == "scan").ToListAsync());
        source.NextScanAtUtc = DateTime.UtcNow.AddSeconds(-1);
        await h.Db.SaveChangesAsync();
        await h.Worker.MaintainAsync(default);
        Assert.Equal(2, await h.Db.CrawlerJobs.CountAsync(j => j.Kind == "scan"));
        Assert.Equal(3, await h.Db.BookLinks.CountAsync());
    }

    [Theory]
    [InlineData("https://novelupdates.com/series/test")]
    [InlineData("https://www.novelupdates.com/series/test")]
    [InlineData("https://cdn.novelupdates.com/image.jpg")]
    public void ReferenceLinks_AreExcludedFromCrawlerUrls(string url) => Assert.Null(CrawlerPlan.CanonicalUrl(url));

    [Theory]
    [InlineData("manga")]
    [InlineData("manhwa")]
    [InlineData("manhua")]
    [InlineData("other")]
    public async Task NonNovels_RejectCrawlerRequests_AndNeverEnterDiscovery(string slug)
    {
        using var h = new Harness();
        var book = await h.Book();
        book.ContentTypeId = await h.Db.ContentTypes.Where(t => t.Slug == slug).Select(t => t.Id).SingleAsync();
        await h.Db.SaveChangesAsync();
        await Assert.ThrowsAsync<ValidationException>(() => h.Api.SearchAsync(book.Id, new("Test"), default));
        await Assert.ThrowsAsync<ValidationException>(() => h.Api.DownloadAsync(book.Id,
            new(Guid.NewGuid(), new("all"), 100, "Volume {n}", 1, true, "one"), default));
        await h.Worker.MaintainAsync(default);
        Assert.Empty(await h.Db.CrawlerJobs.ToListAsync());
        Assert.Empty(await h.Db.BookCrawlerDiscoveries.ToListAsync());
    }

    [Fact]
    public async Task ChangingNovelToManga_CancelsExistingWork()
    {
        using var h = new Harness();
        var book = await h.Book();
        var job = await h.Api.SearchAsync(book.Id, new("Test"), default);
        book.ContentTypeId = await h.Db.ContentTypes.Where(t => t.Slug == "manga").Select(t => t.Id).SingleAsync();
        await h.Db.SaveChangesAsync();
        await h.Worker.TickAsync(default);
        Assert.Equal("cancelled", (await h.Db.CrawlerJobs.SingleAsync(j => j.Id == job.Id)).Status);
        Assert.Empty(h.Remote.Submissions);
    }

    private static List<CrawlerChapter> Chapters(int count = 6) => Enumerable.Range(1, count)
        .Select(i => new CrawlerChapter($"chapter-{i}", $"https://example.com/chapter/{i}", i == 1 ? "Prologue" : $"V2C{i}")).ToList();

    [Fact]
    public void RangePlan_SelectsExactIdsAndSplitsWithContinuedNames()
    {
        var request = new EpubDownloadRequest(Guid.NewGuid(), new("custom", 2, 6), 2, "Part {n}", 4, true, "one");
        var files = CrawlerPlan.Files(request, Chapters());
        Assert.Equal(new[] { "Part 4", "Part 5", "Part 6" }, files.Select(f => f.Title));
        Assert.Equal(new[] { "chapter-2", "chapter-3" }, files[0].ChapterIds);
        Assert.Equal(new[] { "chapter-6" }, files[2].ChapterIds);
    }

    [Theory]
    [InlineData(0, 3)]
    [InlineData(2.5, 3)]
    [InlineData(4, 2)]
    [InlineData(7, 10)]
    public void RangePlan_RejectsInvalidOrEmptyRanges(double from, double to) =>
        Assert.Throws<ValidationException>(() => CrawlerPlan.Files(new(Guid.NewGuid(), new("custom", from, to), 100, "{n}", 1, true, "one"), Chapters()));

    [Fact]
    public void Boundary_UsesSourceIdentityAndDoesNotInventCounts()
    {
        Assert.Null(CrawlerPlan.NewChapters(Chapters(), null));
        Assert.Null(CrawlerPlan.NewChapters(Chapters(), "https://example.com/deleted"));
        Assert.Equal(3, CrawlerPlan.NewChapters(Chapters(), "https://example.com/chapter/3"));
        Assert.Equal("V2C2", Chapters()[1].Label);
        var now = DateTime.UtcNow;
        foreach (var _ in Enumerable.Range(0, 100))
            Assert.InRange(CrawlerPlan.NextScan(now, new()) - now, TimeSpan.FromHours(60), TimeSpan.FromHours(72));
    }

    [Fact]
    public async Task Search_PersistsPartialResultsAndStableSources_ButDoesNotTrackEveryCandidate()
    {
        using var h = new Harness();
        var book = await h.Book();
        var job = await h.Api.SearchAsync(book.Id, new("Test", "english"), default);
        h.Remote.Snapshot = new("crawling", [new("Test", "https://example.com/novel/test", "example.com", "en", Chapters())], [], 2, 250, ["One source unavailable"], null);
        await h.Worker.TickAsync(default);
        var result = await h.Api.GetSearchAsync(job.Id, default);
        Assert.Equal("crawling", result.Status);
        var sourceId = Assert.Single(Assert.Single(result.Result!.Candidates).Sources).Id;
        Assert.False((await h.Db.BookCrawlerSources.SingleAsync()).Tracked);
        Assert.Null(Assert.Single(Assert.Single(result.Result.Candidates).Sources).UpdatedAt);
        await h.Due();
        h.Remote.Snapshot = h.Remote.Snapshot with { Status = "completed" };
        await h.Worker.TickAsync(default);
        Assert.Equal(sourceId, Assert.Single(Assert.Single((await h.Api.GetSearchAsync(job.Id, default)).Result!.Candidates).Sources).Id);
        Assert.Single(await h.Db.BookCrawlerSources.ToListAsync());
        Assert.DoesNotContain(h.Remote.Submissions, w => w.Kind == "download");
    }

    [Fact]
    public async Task Download_IdempotencyAndOwnershipAreEnforced()
    {
        using var h = new Harness();
        var book = await h.Book();
        var source = new BookCrawlerSource { OwnerId = h.User.RequiredId, BookId = book.Id, Url = "https://example.com/novel/test", ChaptersJson = CrawlerPlan.Serialize(Chapters()) };
        h.Db.BookCrawlerSources.Add(source); await h.Db.SaveChangesAsync();
        var request = new EpubDownloadRequest(source.Id, new("all"), 3, "Volume {n}", 1, true, "stable");
        var a = await h.Api.DownloadAsync(book.Id, request, default);
        var b = await h.Api.DownloadAsync(book.Id, request, default);
        Assert.Equal(a.Id, b.Id);
        Assert.Single(await h.Db.CrawlerJobs.ToListAsync());
        Assert.True(source.Tracked);
        var other = new EpubCrawlerService(h.Db, new Reader(Guid.NewGuid()), h.Options);
        await Assert.ThrowsAsync<EntityNotFoundException<CrawlerJob, Guid>>(() => other.GetDownloadAsync(a.Id, default));
        await Assert.ThrowsAsync<EntityNotFoundException<Book, Guid>>(() => other.ListDownloadsAsync(book.Id, default));
    }

    [Fact]
    public async Task Search_IncludesSavedDobyUrlEvenWhenQueryDoesNotMatchItsTitle()
    {
        using var h = new Harness();
        var book = await h.Book();
        const string url = "https://dobytranslations.com/series/my-struggle-for-survival-after-becoming-the-true-ancestors-blood-servant/";
        h.Db.BookLinks.Add(new BookLink { BookId = book.Id, Url = url, SourceType = "Other" });
        await h.Db.SaveChangesAsync();
        var job = await h.Api.SearchAsync(book.Id, new("Blood Servant", "english"), default);
        var stored = await h.Db.CrawlerJobs.SingleAsync(j => j.Id == job.Id);
        var work = CrawlerPlan.Read<CrawlerWork>(stored.RequestJson);
        Assert.Equal("Blood Servant", work.Query);
        Assert.Equal(url.TrimEnd('/'), Assert.Single(work.Urls));
        h.Remote.Snapshot = new("crawling", [], [], 0, 2000, [], null, 100, 0, 1, "Checking saved link: dobytranslations.com");
        await h.Worker.TickAsync(default);
        var progress = (await h.Api.GetSearchAsync(job.Id, default)).Result!;
        Assert.Empty(progress.Candidates);
        Assert.Equal(100, progress.TotalSourceCount);
        Assert.Equal(1, progress.TotalLinkCount);
        Assert.Equal("Checking saved link: dobytranslations.com", progress.CurrentSource);
    }

    [Fact]
    public async Task SourceCooldown_AdmitsTheNextBook_WithoutDuplicatingSleepingDiscovery()
    {
        using var h = new Harness();
        var older = await h.Book(); var newer = await h.Book();
        newer.Created = DateTimeOffset.UtcNow.AddMinutes(1);
        await h.Db.SaveChangesAsync();
        await h.Worker.MaintainAsync(default);
        var first = await h.Db.CrawlerJobs.SingleAsync();
        Assert.Equal(newer.Id, first.BookId);
        first.Status = "queued"; first.NextAttemptAtUtc = DateTime.UtcNow.AddMinutes(10);
        await h.Db.SaveChangesAsync();
        await h.Worker.MaintainAsync(default);
        Assert.Equal(2, await h.Db.CrawlerJobs.CountAsync());
        Assert.Single(await h.Db.CrawlerJobs.Where(j => j.BookId == older.Id).ToListAsync());
        Assert.Single(await h.Db.CrawlerJobs.Where(j => j.BookId == newer.Id).ToListAsync());
    }

    [Fact]
    public async Task Monitor_RestrictsOwnerViewAndRequiresAdminForGlobalActivity()
    {
        using var h = new Harness();
        var book = await h.Book();
        var job = await h.Api.SearchAsync(book.Id, new("Test"), default);
        h.Remote.Snapshot = new("queued", [], [], 28, 100, ["A source is unavailable"], null,
            TotalSourceCount: 35, NextRetryAt: DateTime.UtcNow.AddMinutes(10), RetryAttempt: 1);
        await h.Worker.TickAsync(default);
        var own = new CrawlerMonitorService(h.Db, h.User, h.Options, h.Remote);
        var status = await own.GetAsync(false, "active", 0, 20, default);
        Assert.Equal(1, status.TotalBooks);
        Assert.Equal(1, status.WaitingJobs);
        Assert.Equal(28, Assert.Single(status.Jobs).SearchedSourceCount);
        Assert.Equal(job.Id, status.Jobs[0].Id);
        Assert.Null(status.Jobs[0].Username);
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => own.GetAsync(true, "active", 0, 20, default));
        var stranger = new CrawlerMonitorService(h.Db, new Reader(Guid.NewGuid()), h.Options, h.Remote);
        Assert.Empty((await stranger.GetAsync(false, "active", 0, 20, default)).Jobs);
        var admin = new CrawlerMonitorService(h.Db, new Reader(Guid.NewGuid(), true), h.Options, h.Remote);
        Assert.Single((await admin.GetAsync(true, "active", 0, 20, default)).Jobs);
    }

    [Fact]
    public async Task DeletedBookOrAccount_CancelsRemoteOrphans_WithoutCancellingOwnedJobs()
    {
        using var h = new Harness();
        var book = await h.Book();
        var job = await h.Api.SearchAsync(book.Id, new("Test"), default);
        var orphan = Guid.NewGuid();
        h.Remote.ActiveIds.AddRange([job.Id, orphan]);
        await h.Worker.MaintainAsync(default);
        Assert.Equal(new[] { orphan }, h.Remote.CancelledIds);
        await h.Db.CrawlerJobs.Where(j => j.Id == job.Id).ExecuteDeleteAsync();
        h.Remote.ActiveIds.Remove(orphan);
        await h.Worker.MaintainAsync(default);
        Assert.Contains(job.Id, h.Remote.CancelledIds);
    }

    [Fact]
    public async Task OwnerDownloads_IncludesActiveAndRecentFinishedJobsAcrossBooks_WithoutOtherOwners()
    {
        using var h = new Harness();
        var a = await h.Book(); var b = await h.Book();
        foreach (var book in new[] { a, b })
        {
            var source = new BookCrawlerSource { OwnerId = h.User.RequiredId, BookId = book.Id,
                Url = "https://example.com/novel/test", ChaptersJson = CrawlerPlan.Serialize(Chapters()) };
            h.Db.BookCrawlerSources.Add(source); await h.Db.SaveChangesAsync();
            await h.Api.DownloadAsync(book.Id, new(source.Id, new("all"), 100, "Volume {n}", 1, true, book.Id.ToString()), default);
        }
        var jobs = await h.Db.CrawlerJobs.OrderBy(j => j.CreatedAtUtc).ToListAsync();
        jobs[0].Status = "completed";
        await h.Db.SaveChangesAsync();
        var result = await h.Api.ListOwnerDownloadsAsync(default);
        Assert.Equal(2, result.Count);
        Assert.All(result, item => Assert.NotNull(item.BookTitle));
        var other = new EpubCrawlerService(h.Db, new Reader(Guid.NewGuid()), Options.Create(new CrawlerOptions { Enabled = true }));
        Assert.Empty(await other.ListOwnerDownloadsAsync(default));
        jobs[0].CreatedAtUtc = DateTime.UtcNow.AddDays(-2);
        jobs[1].CreatedAtUtc = DateTime.UtcNow.AddDays(-2);
        await h.Db.SaveChangesAsync();
        Assert.Single(await h.Api.ListOwnerDownloadsAsync(default));
    }

    [Fact]
    public async Task TemporarySourceFailure_PersistsRetryTimeAndCanBeCancelledBeforeDeadline()
    {
        using var h = new Harness();
        var book = await h.Book();
        var source = new BookCrawlerSource { OwnerId = h.User.RequiredId, BookId = book.Id,
            Url = "https://example.com/novel/test", ChaptersJson = CrawlerPlan.Serialize(Chapters()) };
        h.Db.BookCrawlerSources.Add(source); await h.Db.SaveChangesAsync();
        var job = await h.Api.DownloadAsync(book.Id, new(source.Id, new("all"), 100, "Volume {n}", 1, true, "retry"), default);
        var due = DateTime.UtcNow.AddMinutes(15);
        h.Remote.Snapshot = new("queued", [], [], 0, 0, [], null, NextRetryAt: due.ToLocalTime(), RetryAttempt: 2);
        await h.Worker.TickAsync(default);
        var progress = await h.Api.GetDownloadAsync(job.Id, default);
        Assert.Equal(due, progress.NextRetryAt?.ToUniversalTime());
        Assert.Equal(2, progress.RetryAttempt);
        Assert.Equal(due, (await h.Db.CrawlerJobs.SingleAsync()).NextAttemptAtUtc);
        Assert.Equal(DateTimeKind.Utc, (await h.Db.CrawlerJobs.SingleAsync()).NextAttemptAtUtc.Kind);
        Assert.False(await h.Worker.TickAsync(default));
        await h.Api.CancelAsync(job.Id, default);
        Assert.True(await h.Worker.TickAsync(default));
        Assert.Equal("cancelled", (await h.Api.GetDownloadAsync(job.Id, default)).Status);
    }

    [Fact]
    public async Task Search_PreservesPartialResultsAndRetryFeedback()
    {
        using var h = new Harness();
        var book = await h.Book();
        var job = await h.Api.SearchAsync(book.Id, new("Test"), default);
        var due = DateTime.UtcNow.AddMinutes(5);
        h.Remote.Snapshot = new("queued", [new("Test", "https://example.com/novel/test", "example.com", "en", Chapters())],
            [], 1, 0, [], null, NextRetryAt: due, RetryAttempt: 1);
        await h.Worker.TickAsync(default);
        var result = (await h.Api.GetSearchAsync(job.Id, default)).Result!;
        Assert.Single(result.Candidates);
        Assert.Equal(due, result.NextRetryAt);
        Assert.Equal(1, result.RetryAttempt);
    }

    [Fact]
    public async Task LinkedSources_ScanOnlyMetadataAndShareRefreshAcrossBooks()
    {
        using var h = new Harness();
        var a = await h.Book(); var b = await h.Book();
        foreach (var book in new[] { a, b })
            h.Db.BookLinks.Add(new() { BookId = book.Id, Url = "https://example.com/novel/test", SourceType = "Other" });
        await h.Db.SaveChangesAsync();
        foreach (var book in new[] { a, b }) h.Db.BookCrawlerDiscoveries.Add(new() { OwnerId = h.User.RequiredId, BookId = book.Id,
            LastCheckedAtUtc = DateTime.UtcNow, NextCheckAtUtc = DateTime.UtcNow.AddMonths(1) });
        await h.Db.SaveChangesAsync();
        await h.Worker.MaintainAsync(default);
        Assert.Equal(2, await h.Db.BookCrawlerSources.CountAsync());
        foreach (var source in await h.Db.BookCrawlerSources.ToListAsync()) source.NextScanAtUtc = DateTime.UtcNow.AddSeconds(-1);
        await h.Db.SaveChangesAsync();
        await h.Worker.MaintainAsync(default);
        Assert.Single(await h.Db.CrawlerJobs.ToListAsync());
        h.Remote.Snapshot = new("completed", [new("Test", "https://example.com/novel/test", "example.com", "en", Chapters())], [], 0, 10, [], null);
        await h.Worker.TickAsync(default);
        Assert.All(await h.Db.BookCrawlerSources.ToListAsync(), s =>
        {
            Assert.NotNull(s.LastScannedAtUtc);
            Assert.InRange(s.NextScanAtUtc, DateTime.UtcNow.AddHours(59.99), DateTime.UtcNow.AddHours(72.01));
            Assert.Equal(6, CrawlerPlan.Read<List<CrawlerChapter>>(s.ChaptersJson).Count);
        });
        Assert.Equal("inspect", Assert.Single(h.Remote.Submissions).Kind);
    }

    [Fact]
    public async Task CancelledQueuedDownload_DoesNotStartRemoteWork()
    {
        using var h = new Harness(); var book = await h.Book();
        var source = new BookCrawlerSource { OwnerId = h.User.RequiredId, BookId = book.Id, Url = "https://example.com/novel/test", ChaptersJson = CrawlerPlan.Serialize(Chapters()) };
        h.Db.BookCrawlerSources.Add(source); await h.Db.SaveChangesAsync();
        var job = await h.Api.DownloadAsync(book.Id, new(source.Id, new("all"), 100, "Volume {n}", 1, true, "cancel"), default);
        await h.Api.CancelAsync(job.Id, default);
        h.Db.ChangeTracker.Clear();
        await h.Worker.TickAsync(default);
        Assert.Equal("cancelled", (await h.Api.GetDownloadAsync(job.Id, default)).Status);
        Assert.Empty(h.Remote.Submissions);
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task FinishedFiles_UseRealImportValidationAndSurviveWorkerRecreation(bool automatic)
    {
        using var h = new Harness(); var book = await h.Book();
        var source = new BookCrawlerSource { OwnerId = h.User.RequiredId, BookId = book.Id, Url = "https://example.com/novel/test", ChaptersJson = CrawlerPlan.Serialize(Chapters()) };
        h.Db.BookCrawlerSources.Add(source); await h.Db.SaveChangesAsync();
        var job = await h.Api.DownloadAsync(book.Id, new(source.Id, new("all"), 6, "Volume {n}", 1, automatic, "files"), default);
        h.Remote.Snapshot = new("completed", [], [new("Volume 1", 1, 6, 6, "ready")], 0, 20, [], null);
        await h.Worker.TickAsync(default); // deterministic import session queued
        Assert.Single(await h.Db.BookFileJobs.ToListAsync());
        await h.Files.ProcessNextAsync(default); // EPUB validation
        await h.Due(); await h.Worker.TickAsync(default); // ready -> auto confirmation or manual review
        if (automatic)
        {
            await h.Files.ProcessNextAsync(default);
            await h.Due(); await h.Worker.TickAsync(default);
            Assert.Single(await h.Db.BookFiles.ToListAsync());
        }
        else
        {
            Assert.Empty(await h.Db.BookFiles.ToListAsync());
            Assert.Equal("Ready", (await h.Db.BookFileJobs.SingleAsync()).Status);
        }
        var finished = await h.Api.GetDownloadAsync(job.Id, default);
        Assert.Equal("completed", finished.Status);
        Assert.Equal(automatic ? "added" : "ready", Assert.Single(finished.Files).Status);
        Assert.NotNull(finished.Files[0].ImportSessionId);
        Assert.Equal("https://example.com/chapter/6", source.DownloadBoundaryUrl);
        Assert.Equal(source.Url, Assert.Single(await h.Db.BookLinks.ToListAsync()).Url);
        Assert.Single(await h.Db.BookFileJobs.ToListAsync());
    }

    [Fact]
    public async Task LibraryDiscovery_PrioritizesNewestUnseenBook_AndKeepsMonthlySnapshot()
    {
        using var h = new Harness();
        var old = await h.Book();
        var latest = await h.Book();
        latest.Created = DateTimeOffset.UtcNow.AddMinutes(1);
        await h.Db.SaveChangesAsync();
        await h.Worker.MaintainAsync(default);
        var job = Assert.Single(await h.Db.CrawlerJobs.Where(j => j.Kind == "discovery").ToListAsync());
        Assert.Equal(latest.Id, job.BookId);
        var work = CrawlerPlan.Read<CrawlerWork>(job.RequestJson);
        Assert.True(work.Background);
        Assert.True(work.InitialDiscovery);
        Assert.Equal("all", work.Scope);
        h.Remote.Snapshot = new("completed", [new(latest.PrimaryTitle, "https://example.com/novel/new", "example.com", "en", Chapters())], [], 2, 500, [], null);
        await h.Worker.TickAsync(default);
        var saved = await h.Db.BookCrawlerDiscoveries.SingleAsync(d => d.BookId == latest.Id);
        Assert.NotNull(saved.LastCheckedAtUtc);
        Assert.InRange(saved.NextCheckAtUtc, DateTime.UtcNow.AddDays(27), DateTime.UtcNow.AddDays(32));
        Assert.NotEqual("{}", saved.ResultJson);
        Assert.False((await h.Db.BookCrawlerSources.SingleAsync()).Tracked);
        var cached = await h.Api.SearchAsync(latest.Id, new(latest.PrimaryTitle), default);
        Assert.Single(cached.Result!.Candidates);
        Assert.NotNull(cached.Result.Candidates[0].Sources[0].FetchedAt);
        await h.Worker.MaintainAsync(default);
        Assert.Equal(old.Id, (await h.Db.CrawlerJobs.Where(j => j.Kind == "discovery" && j.Status == "queued").SingleAsync()).BookId);
    }

    [Theory]
    [InlineData("completed")]
    [InlineData("dropped")]
    public async Task MonthlyDiscovery_SkipsFinishedAndDropped_AfterInitialCheck(string slug)
    {
        using var h = new Harness(); var book = await h.Book();
        book.StatusId = await h.Db.Statuses.Where(s => s.Slug == slug).Select(s => s.Id).SingleAsync();
        await h.Db.SaveChangesAsync();
        await h.Worker.MaintainAsync(default);
        Assert.Single(await h.Db.CrawlerJobs.Where(j => j.Kind == "discovery").ToListAsync());
        h.Remote.Snapshot = new("completed", [], [], 2, 500, [], null);
        await h.Worker.TickAsync(default);
        var discovery = await h.Db.BookCrawlerDiscoveries.SingleAsync();
        discovery.NextCheckAtUtc = DateTime.UtcNow.AddDays(-1);
        await h.Db.SaveChangesAsync();
        await h.Worker.MaintainAsync(default);
        Assert.Single(await h.Db.CrawlerJobs.Where(j => j.Kind == "discovery").ToListAsync());
    }

    private sealed class Harness : IDisposable
    {
        private readonly SqliteTestDatabase database = new();
        private readonly string root = Path.Combine(Path.GetTempPath(), "tsundoku-crawler-tests", Guid.NewGuid().ToString("N"));
        private readonly ServiceProvider provider;
        public Harness()
        {
            Db = database.CreateContext(); User = new(database.UserId);
            Api = new(Db, User, Options);
            var services = new ServiceCollection();
            services.AddSingleton(Db);
            services.AddSingleton(TimeProvider.System);
            services.AddSingleton<IUser>(User);
            services.AddSingleton(Microsoft.Extensions.Options.Options.Create(new BookFileOptions { StorageRoot = Path.Combine(root, "epubs"), StagingRoot = Path.Combine(root, "staging") }));
            services.AddSingleton(Microsoft.Extensions.Options.Options.Create(new BookImportSecurityOptions()));
            services.AddSingleton<IBookFileStorage, LocalBookFileStorage>();
            services.AddSingleton<IStorageCleanupQueue, StorageCleanupQueue>();
            services.AddSingleton<IDistributedCache>(new MemoryDistributedCache(Microsoft.Extensions.Options.Options.Create(new MemoryDistributedCacheOptions())));
            services.AddSingleton<Microsoft.Extensions.Logging.ILogger<AccountAbuseGuard>>(NullLogger<AccountAbuseGuard>.Instance);
            services.AddSingleton<AccountAbuseGuard>();
            provider = services.BuildServiceProvider();
            Files = ActivatorUtilities.CreateInstance<BookFileService>(provider);
            Worker = new(Db, Remote, provider, Options, NullLogger<CrawlerWorker>.Instance);
        }
        public Infrastructure.Contexts.ApplicationDbContext Db { get; }
        public Reader User { get; }
        public EpubCrawlerService Api { get; }
        public FakeRemote Remote { get; } = new();
        public CrawlerWorker Worker { get; }
        public BookFileService Files { get; }
        public IOptions<CrawlerOptions> Options { get; } = Microsoft.Extensions.Options.Options.Create(new CrawlerOptions { Enabled = true });
        public async Task<Book> Book()
        {
            var title = $"Test {Guid.NewGuid():N}";
            var book = new Book { PrimaryTitle = title, NormalizedPrimaryTitle = title.Replace(" ", "").ToUpperInvariant(), OwnerId = User.RequiredId,
                ContentTypeId = await Db.ContentTypes.Select(t => t.Id).FirstAsync(), StatusId = await Db.Statuses.Select(t => t.Id).FirstAsync() };
            Db.Books.Add(book); await Db.SaveChangesAsync(); return book;
        }
        public async Task Due()
        {
            foreach (var job in await Db.CrawlerJobs.ToListAsync()) job.NextAttemptAtUtc = DateTime.UtcNow.AddSeconds(-1);
            await Db.SaveChangesAsync();
        }
        public void Dispose() { provider.Dispose(); Db.Dispose(); database.Dispose(); if (Directory.Exists(root)) Directory.Delete(root, true); }
    }

    private sealed class Reader(Guid id, bool admin = false) : IUser
    {
        public Guid? Id => id;
        public Guid RequiredId => id;
        public string? Email => null;
        public string? Username => null;
        public IEnumerable<string> Roles => admin ? [Application.Common.AuthorizationRoles.Admin] : [];
        public bool IsAuthenticated => true;
        public bool Valid => true;
    }
    private sealed class FakeRemote : ICrawlerClient
    {
        public bool ProcessingEnabled { get; set; } = true;
        public Task<CrawlerProcessingState> ProcessingAsync(CancellationToken ct) => Task.FromResult(new CrawlerProcessingState(ProcessingEnabled));
        public Task<CrawlerProcessingState> SetProcessingAsync(CrawlerProcessingState state, CancellationToken ct)
        {
            ProcessingEnabled = state.ProcessingEnabled;
            return Task.FromResult(state);
        }
        public Task<CrawlerSourceHealthSnapshot> SourceHealthAsync(CancellationToken ct) => Task.FromResult(new CrawlerSourceHealthSnapshot(true, []));
        public Task UpdateSourceHealthAsync(string domain, CrawlerSourceSettings settings, CancellationToken ct) => Task.CompletedTask;
        private readonly HashSet<Guid> submitted = [];
        public List<CrawlerWork> Submissions { get; } = [];
        public CrawlerRemoteJob Snapshot { get; set; } = new("queued", [], [], 0, 0, [], null);
        public List<Guid> ActiveIds { get; } = [];
        public List<Guid> CancelledIds { get; } = [];
        public Task<IReadOnlyList<Guid>> ActiveJobsAsync(Guid? after, CancellationToken ct) =>
            Task.FromResult<IReadOnlyList<Guid>>(after == null ? ActiveIds.ToList() : []);
        public List<CrawlerSourceInfo> Catalog { get; } = [new("example.com", "https://example.com", "en", true)];
        public Task<IReadOnlyList<CrawlerSourceInfo>> SourcesAsync(CancellationToken ct) => Task.FromResult<IReadOnlyList<CrawlerSourceInfo>>(Catalog);
        public Task<CrawlerRemoteJob> SubmitAsync(Guid id, object request, CancellationToken ct)
        { submitted.Add(id); Submissions.Add((CrawlerWork)request); return Task.FromResult(Snapshot); }
        public Task<CrawlerRemoteJob?> GetAsync(Guid id, CancellationToken ct) => Task.FromResult(submitted.Contains(id) ? Snapshot : null);
        public Task CancelAsync(Guid id, CancellationToken ct) { CancelledIds.Add(id); Snapshot = Snapshot with { Status = "cancelled" }; return Task.CompletedTask; }
        public Task DeleteAsync(Guid id, CancellationToken ct) => Task.CompletedTask;
        public Task<Stream> OpenFileAsync(Guid id, int index, CancellationToken ct)
        {
            var target = new MemoryStream();
            using (var zip = new ZipArchive(target, ZipArchiveMode.Create, true))
            {
                void Write(string name, string content)
                {
                    using var writer = new StreamWriter(zip.CreateEntry(name, CompressionLevel.NoCompression).Open());
                    writer.Write(content);
                }
                Write("mimetype", "application/epub+zip");
                Write("META-INF/container.xml", "<container xmlns='urn:oasis:names:tc:opendocument:xmlns:container'><rootfiles><rootfile full-path='content.opf'/></rootfiles></container>");
                Write("content.opf", "<package xmlns='http://www.idpf.org/2007/opf'><metadata><dc:title xmlns:dc='http://purl.org/dc/elements/1.1/'>Volume 1</dc:title></metadata></package>");
                Write("chapter.xhtml", "<html><body>Example content</body></html>");
            }
            target.Position = 0;
            return Task.FromResult<Stream>(target);
        }
    }
}
