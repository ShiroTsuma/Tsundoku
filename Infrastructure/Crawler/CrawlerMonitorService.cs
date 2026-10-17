namespace Infrastructure.Crawler;

using Application.Common.DTOs.Book;
using Microsoft.Extensions.Options;

public sealed class CrawlerMonitorService(ApplicationDbContext db, IUser user, IOptions<CrawlerOptions> options, ICrawlerClient remote)
    : ICrawlerMonitorService
{
    public async Task<CrawlerMonitorSnapshot> GetAsync(bool allAccounts, string filter, int skip, int take, CancellationToken ct)
    {
        if (allAccounts && !user.Roles.Contains(AuthorizationRoles.Admin)) throw new UnauthorizedAccessException();
        if (filter is not ("active" or "recent" or "failed")) throw new ValidationException("Unknown crawler job filter.");
        skip = Math.Max(0, skip);
        take = Math.Clamp(take, 1, 100);
        var books = db.Books.AsNoTracking().Where(b => b.ContentType.Slug == "novel" && (allAccounts || b.OwnerId == user.RequiredId));
        var bookIds = books.Select(b => b.Id);
        var discoveries = db.BookCrawlerDiscoveries.AsNoTracking().Where(d => bookIds.Contains(d.BookId));
        var sources = db.BookCrawlerSources.AsNoTracking().Where(s => bookIds.Contains(s.BookId));
        var jobs = db.CrawlerJobs.AsNoTracking().Where(j => bookIds.Contains(j.BookId));
        var now = DateTime.UtcNow;
        var active = jobs.Where(j => j.Status != "completed" && j.Status != "failed" && j.Status != "cancelled");
        var waiting = await active.CountAsync(j => j.Status == "queued", ct);
        var running = await active.CountAsync(j => j.Status != "queued", ct);
        var filtered = filter == "active" ? active : filter == "failed" ? jobs.Where(j => j.Status == "failed") : jobs;
        var totalJobs = await filtered.CountAsync(ct);
        var page = await filtered.OrderBy(j => j.Status == "completed" || j.Status == "failed" || j.Status == "cancelled")
            .ThenByDescending(j => j.CreatedAtUtc).Skip(skip).Take(take).ToListAsync(ct);
        var ids = page.Select(j => j.BookId).Distinct().ToList();
        var titles = await books.Where(b => ids.Contains(b.Id)).ToDictionaryAsync(b => b.Id, b => b.PrimaryTitle, ct);
        var owners = page.Select(j => j.OwnerId).Distinct().ToList();
        var usernames = allAccounts ? await db.Users.AsNoTracking().Where(u => owners.Contains(u.Id))
            .ToDictionaryAsync(u => u.Id, u => u.UserName, ct) : new Dictionary<Guid, string?>();
        var items = page.Where(j => titles.ContainsKey(j.BookId)).Select(j =>
        {
            var search = j.Kind is "search" or "discovery" && j.ResultJson != "{}"
                ? CrawlerPlan.Read<EpubSearchResult>(j.ResultJson) : null;
            var download = j.Kind == "download" && j.ResultJson != "{}"
                ? CrawlerPlan.Read<EpubDownloadJob>(j.ResultJson) : null;
            var work = CrawlerPlan.Read<CrawlerWork>(j.RequestJson);
            var source = search?.CurrentSource ?? (Uri.TryCreate(work.Url, UriKind.Absolute, out var url) ? url.Host : null);
            return new CrawlerMonitorJob(j.Id, j.BookId, titles[j.BookId], usernames.GetValueOrDefault(j.OwnerId),
                j.Kind, j.Status, j.CreatedAtUtc, j.NextAttemptAtUtc, search?.RetryAttempt ?? download?.RetryAttempt ?? 0,
                search?.NextRetryAt ?? download?.NextRetryAt, source,
                search?.SearchedSourceCount ?? 0, search?.TotalSourceCount ?? 0, search?.CheckedLinkCount ?? 0,
                search?.TotalLinkCount ?? 0, download?.ChaptersDone ?? 0, download?.ChaptersTotal ?? 0,
                download?.Files.Count(f => f.Status is "ready" or "added") ?? 0, download?.Files.Count ?? 0,
                search?.Warnings ?? [], j.Error);
        }).ToList();
        var processing = false;
        if (options.Value.Enabled)
        {
            try { processing = (await remote.ProcessingAsync(ct)).ProcessingEnabled; }
            catch (HttpRequestException) { /* Offline crawlers cannot process work. */ }
        }
        return new(options.Value.Enabled, now, await books.CountAsync(ct),
            await discoveries.CountAsync(d => d.LastCheckedAtUtc != null, ct),
            await books.CountAsync(b => !db.BookCrawlerDiscoveries.Any(d => d.BookId == b.Id && d.LastCheckedAtUtc != null), ct),
            running, waiting, await sources.CountAsync(s => s.Tracked, ct), totalJobs, skip, take, items, processing);
    }
}
