namespace Infrastructure.Crawler;

using System.Diagnostics.Metrics;
using System.Runtime.CompilerServices;
using Application.Common.DTOs.Book;
using BookFiles;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Services;

public static class CrawlerTelemetry
{
    public static readonly Meter Meter = new("Tsundoku.Crawler");
    public static readonly Counter<long> Operations = Meter.CreateCounter<long>("tsundoku.crawler.operations");
    public static readonly Histogram<double> ScanAge = Meter.CreateHistogram<double>("tsundoku.crawler.scan.age.hours");
    public static readonly Histogram<int> Queue = Meter.CreateHistogram<int>("tsundoku.crawler.queue.length");
}

public sealed class CrawlerWorker(ApplicationDbContext db, ICrawlerClient remote, IServiceProvider services,
    IOptions<CrawlerOptions> options, ILogger<CrawlerWorker> logger)
{
    private static readonly string[] Terminal = ["completed", "failed", "cancelled"];
    private readonly CrawlerOptions _options = options.Value;

    public async Task<bool> TickAsync(CancellationToken ct)
    {
        if (!_options.Enabled) return false;
        CrawlerJob? job;
        var now = DateTime.UtcNow;
        // Serializes queue admission across API instances. Remote work itself is asynchronous.
        await using (var transaction = await db.Database.BeginTransactionAsync(ct))
        {
            if (db.Database.IsNpgsql())
                await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock({914732832L})", ct);
            var candidates = await db.CrawlerJobs.Where(j => !Terminal.Contains(j.Status) &&
                    (j.NextAttemptAtUtc <= now || j.CancelRequested || j.ExpiresAtUtc <= now) && (j.LeaseUntilUtc == null || j.LeaseUntilUtc < now))
                .OrderBy(j => j.Kind == "discovery" || j.Kind == "scan")
                .ThenBy(j => j.Kind == "discovery").ThenBy(j => j.CreatedAtUtc).Take(100).ToListAsync(ct);
            var running = await db.CrawlerJobs.Where(j => j.Kind == "download" && j.Submitted && !Terminal.Contains(j.Status))
                .Select(j => j.OwnerId).ToListAsync(ct);
            job = candidates.FirstOrDefault(j => j.Submitted || j.CancelRequested || j.ExpiresAtUtc <= now ||
                (j.Kind != "download" || running.Count < _options.MaxConcurrentDownloads && !running.Contains(j.OwnerId)));
            if (job == null) return false;
            job.LeaseUntilUtc = now.AddMinutes(5);
            // Reserve a remote slot before releasing admission lock.
            job.Status = job.Status == "queued" ? "crawling" : job.Status;
            job.Submitted = true;
            await db.SaveChangesAsync(ct);
            await transaction.CommitAsync(ct);
        }
        var stoppingToken = ct;
        using var leaseTimeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        leaseTimeout.CancelAfter(TimeSpan.FromMinutes(4));
        ct = leaseTimeout.Token;
        try
        {
            if (job.ExpiresAtUtc <= now) job.CancelRequested = true;
            var work = CrawlerPlan.Read<CrawlerWork>(job.RequestJson);
            var cancelled = job.CancelRequested || await db.CrawlerJobs.AsNoTracking().Where(j => j.Id == job.Id)
                .Select(j => j.CancelRequested).SingleAsync(ct) ||
                !await db.Books.AnyAsync(b => b.Id == job.BookId && b.ContentType.Slug == "novel", ct) ||
                (work.Url != null && CrawlerPlan.CanonicalUrl(work.Url) == null);
            if (cancelled) await remote.CancelAsync(job.Id, ct);
            var snapshot = await remote.GetAsync(job.Id, ct);
            if (snapshot == null && !cancelled) snapshot = await remote.SubmitAsync(job.Id, work, ct);
            if (snapshot == null) job.Status = "cancelled";
            else if (job.Kind == "download") await DownloadAsync(job, work, snapshot, ct);
            else await MetadataAsync(job, work, snapshot, ct);
            if (!cancelled && snapshot?.NextRetryAt is { } retryAt && !Terminal.Contains(job.Status))
                job.NextAttemptAtUtc = retryAt.ToUniversalTime();
            if (job.ExpiresAtUtc <= now && !Terminal.Contains(job.Status))
            {
                job.Status = "failed";
                job.Error = "The crawler operation exceeded its 24-hour lifetime. Completed files remain available.";
            }
            if (Terminal.Contains(job.Status))
                CrawlerTelemetry.Operations.Add(1, new KeyValuePair<string, object?>("kind", job.Kind),
                    new KeyValuePair<string, object?>("status", job.Status));
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { throw; }
        catch (Exception ex) when (ex is HttpRequestException or IOException or OperationCanceledException)
        {
            logger.LogWarning("Crawler operation {JobId} unavailable; retry scheduled ({ErrorType}).", job.Id, ex.GetType().Name);
            job.NextAttemptAtUtc = DateTime.UtcNow.AddMinutes(1);
            if (job.ExpiresAtUtc <= DateTime.UtcNow) { job.Status = "failed"; job.Error = "Crawler unavailable before the operation expired."; }
        }
        catch (ImportCapacityExceededException)
        {
            // A manual upload/review can temporarily occupy the owner's import slot.
            // Keep the generated files and retry, rather than losing the crawl result.
            job.Status = "adding";
            job.NextAttemptAtUtc = DateTime.UtcNow.AddSeconds(15);
            job.Error = "Finish or cancel your other EPUB import to add the generated files.";
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Crawler operation {JobId} failed.", job.Id);
            job.Status = "failed";
            job.Error = ex is ValidationException ? ex.Message : "The crawler operation could not be completed. Finished files remain available.";
            try { await remote.CancelAsync(job.Id, ct); } catch (HttpRequestException) { /* next cleanup retries */ }
        }
        job.LeaseUntilUtc = null;
        if (job.NextAttemptAtUtc <= now) job.NextAttemptAtUtc = DateTime.UtcNow.AddSeconds(2);
        await db.SaveChangesAsync(stoppingToken);
        return true;
    }

    private async Task MetadataAsync(CrawlerJob job, CrawlerWork work, CrawlerRemoteJob result, CancellationToken ct)
    {
        var candidates = new List<EpubCandidate>();
        foreach (var novel in result.Novels)
        {
            var url = CrawlerPlan.CanonicalUrl(novel.Url);
            if (url == null) continue;
            var source = db.BookCrawlerSources.Local.FirstOrDefault(s => s.BookId == job.BookId && s.Url == url)
                ?? await db.BookCrawlerSources.SingleOrDefaultAsync(s => s.BookId == job.BookId && s.Url == url, ct);
            if (source == null)
            {
                source = new BookCrawlerSource { OwnerId = job.OwnerId, BookId = job.BookId, Url = url,
                    NextScanAtUtc = CrawlerPlan.NextScan(DateTime.UtcNow, _options) };
                db.BookCrawlerSources.Add(source);
            }
            source.SourceName = novel.Domain;
            source.ChaptersJson = CrawlerPlan.Serialize(novel.Chapters);
            source.LastScannedAtUtc = DateTime.UtcNow;
            source.LastError = null;
            source.NextScanAtUtc = CrawlerPlan.NextScan(DateTime.UtcNow, _options);
            source.NewSinceDownload = CrawlerPlan.NewChapters(novel.Chapters, source.DownloadBoundaryUrl);
            // Group only exact normalized titles. Similar titles remain separate choices.
            var key = novel.Title.Trim().ToUpperInvariant();
            var candidate = candidates.Find(c => c.Id == key);
            var item = new EpubSource(source.Id, novel.Domain, url,
                novel.Chapters.Count > 0 ? novel.Chapters.Count : null, novel.LatestChapterLabel, novel.UpdatedAt, novel.Language, source.LastScannedAtUtc);
            if (candidate == null) candidates.Add(new(key, novel.Title,
                string.Equals(novel.Title.Trim(), work.Query?.Trim(), StringComparison.OrdinalIgnoreCase) ? "title" : "similar", [item]));
            else candidates[candidates.IndexOf(candidate)] = candidate with { Sources = candidate.Sources.Append(item).ToList() };
            if (job.Kind == "scan" && CrawlerPlan.Terminal(result.Status))
            {
                var siblings = await db.BookCrawlerSources.Where(s => s.Url == url && s.Id != source.Id).ToListAsync(ct);
                foreach (var other in siblings)
                {
                    other.ChaptersJson = source.ChaptersJson;
                    other.LastScannedAtUtc = source.LastScannedAtUtc;
                    other.LastError = null;
                    other.NewSinceDownload = CrawlerPlan.NewChapters(novel.Chapters, other.DownloadBoundaryUrl);
                    other.NextScanAtUtc = CrawlerPlan.NextScan(DateTime.UtcNow, _options);
                }
            }
        }
        if (job.Kind is "search" or "discovery") job.ResultJson = CrawlerPlan.Serialize(new EpubSearchResult(candidates,
            result.SearchedSourceCount, result.DurationMs, result.Warnings, result.TotalSourceCount,
            result.CheckedLinkCount, result.TotalLinkCount, result.CurrentSource, result.NextRetryAt, result.RetryAttempt, work.Query, work.Scope, result.SkippedSourceCount));
        job.Status = result.Status;
        job.Error = result.Error;
        if (job.Kind == "search" && job.Status == "completed" &&
            string.Equals(work.Query?.Trim(), (await db.Books.Where(b => b.Id == job.BookId).Select(b => b.PrimaryTitle).SingleAsync(ct)).Trim(),
                StringComparison.OrdinalIgnoreCase))
        {
            var saved = await db.BookCrawlerDiscoveries.SingleOrDefaultAsync(d => d.BookId == job.BookId, ct);
            if (saved == null)
            {
                saved = new BookCrawlerDiscovery { OwnerId = job.OwnerId, BookId = job.BookId, NextCheckAtUtc = DateTime.UtcNow };
                db.BookCrawlerDiscoveries.Add(saved);
            }
            var previous = saved.ResultJson == "{}" ? null : CrawlerPlan.Read<EpubSearchResult>(saved.ResultJson);
            if (work.Scope == "all" || previous?.Scope != "all") saved.ResultJson = job.ResultJson;
            saved.LastCheckedAtUtc = DateTime.UtcNow;
            saved.NextCheckAtUtc = saved.LastCheckedAtUtc.Value.AddMonths(1);
            saved.LastError = null;
        }
        if (job.Kind == "discovery" && CrawlerPlan.Terminal(job.Status))
        {
            var discovery = await db.BookCrawlerDiscoveries.SingleOrDefaultAsync(d => d.BookId == job.BookId, ct);
            if (discovery != null)
            {
                discovery.LastError = result.Error;
                if (job.Status == "completed")
                {
                    discovery.LastCheckedAtUtc = DateTime.UtcNow;
                    discovery.NextCheckAtUtc = discovery.LastCheckedAtUtc.Value.AddMonths(1);
                    discovery.ResultJson = job.ResultJson;
                }
                else discovery.NextCheckAtUtc = DateTime.UtcNow.AddHours(6);
            }
        }
        if (job.Kind == "scan" && CrawlerPlan.Terminal(job.Status))
        {
            var sources = await db.BookCrawlerSources.Where(s => s.Url == work.Url).ToListAsync(ct);
            foreach (var source in sources)
            {
                source.NextScanAtUtc = CrawlerPlan.NextScan(DateTime.UtcNow, _options);
                source.LastError = result.Error;
            }
        }
    }

    private async Task DownloadAsync(CrawlerJob job, CrawlerWork work, CrawlerRemoteJob result, CancellationToken ct)
    {
        var dto = EpubCrawlerService.DownloadDto(job);
        var files = ActivatorUtilities.CreateInstance<BookFileService>(services, new CrawlerActor(job.OwnerId));
        var remoteFinished = CrawlerPlan.Terminal(result.Status);
        for (var i = 0; i < result.Files.Count && i < dto.Files.Count; i++)
        {
            var state = dto.Files[i];
            state.ChaptersDone = result.Files[i].ChaptersDone;
            if (state.Status is not ("added" or "ready")) state.Status = result.Files[i].Status;
        }
        var ready = result.Files.Select((f, index) => (f, index)).Where(x => x.f.Status == "ready").Select(x => x.index).ToList();
        // Manual review uses one ordinary import session, allowing all files to be reviewed together.
        var groups = work.AddAutomatically ? ready.Select(i => new List<int> { i }).ToList()
            : remoteFinished && ready.Count > 0 ? [ready] : new List<List<int>>();
        var pending = false;
        foreach (var group in groups)
        {
            var importId = CrawlerPlan.ImportId(job.Id, work.AddAutomatically ? group[0] : -1);
            var existing = await db.BookFileJobs.AsNoTracking().SingleOrDefaultAsync(j => j.Id == importId, ct);
            BookFileJobDto imported;
            if (existing == null || existing.Status == "Uploading")
                imported = await files.CreateImportAsync(job.BookId, Uploads(job.Id, group, dto.Files, ct), ct, operationId: importId);
            else imported = await files.GetJobAsync(importId, ct);
            foreach (var index in group) dto.Files[index].ImportSessionId = importId;
            if (imported.Status is "Failed" or "Cancelled") throw new ValidationException(imported.Error ?? "The EPUB import was cancelled.");
            if (imported.Status == "Ready")
            {
                if (imported.Entries.Any(e => e.Error != null))
                    throw new ValidationException("A generated EPUB did not pass validation.");
                await RecordDownloadedAsync(work, group, ct);
                if (work.AddAutomatically)
                {
                    var sort = await db.BookFiles.Where(f => f.BookId == job.BookId && f.DeletedAtUtc == null)
                        .MaxAsync(f => (int?)f.SortOrder, ct) ?? -1;
                    await files.FinalizeAsync(importId, imported.Entries.Select((e, n) => new BookFileImportSelection(e.Id, job.BookId,
                        dto.Files[group[Math.Min(n, group.Count - 1)]].Title, sort + n + 1)).ToList(), ct);
                    pending = true;
                }
                else foreach (var index in group) dto.Files[index].Status = "ready";
            }
            else if (imported.Status == "Completed")
            {
                var hashes = BookFileService.Payload(existing!).Entries.Select(e => e.Sha256).ToArray();
                var attachments = await db.BookFiles.Where(f => f.BookId == job.BookId && f.DeletedAtUtc == null && hashes.Contains(f.Sha256))
                    .OrderBy(f => f.SortOrder).Select(f => f.Id).ToListAsync(ct);
                foreach (var index in group) { dto.Files[index].Status = "added"; dto.Files[index].AttachmentId = attachments.FirstOrDefault(); }
            }
            else pending = true;
            // The ordinary import service allows one active import per owner.
            if (pending) break;
        }
        dto.ChaptersDone = dto.Files.Sum(f => f.ChaptersDone);
        dto.NextRetryAt = result.NextRetryAt;
        dto.RetryAttempt = result.RetryAttempt;
        job.Status = remoteFinished
            ? pending || ready.Any(i => dto.Files[i].Status is not ("added" or "ready")) ? "adding" : result.Status
            : result.Status;
        job.Error = result.Error;
        job.ResultJson = CrawlerPlan.Serialize(dto);
    }

    private async IAsyncEnumerable<BookFileUpload> Uploads(Guid jobId, List<int> indexes,
        List<EpubDownloadFile> files, [EnumeratorCancellation] CancellationToken ct)
    {
        foreach (var index in indexes)
        {
            await using var stream = await remote.OpenFileAsync(jobId, index, ct);
            // Names are generated locally; remote paths are never accepted.
            yield return new BookFileUpload(stream, $"{index + 1:D4}.epub");
        }
    }

    private async Task RecordDownloadedAsync(CrawlerWork work, List<int> indexes, CancellationToken ct)
    {
        var source = await db.BookCrawlerSources.SingleOrDefaultAsync(s => s.Id == work.SourceId, ct);
        if (source == null) return;
        var urls = CrawlerPlan.Read<HashSet<string>>(source.DownloadedUrlsJson);
        foreach (var i in indexes)
            foreach (var chapter in work.Chapters.Skip(work.Files[i].FirstChapter - 1).Take(work.Files[i].ChapterIds.Count)) urls.Add(chapter.Url);
        source.DownloadedUrlsJson = CrawlerPlan.Serialize(urls);
        var last = work.Chapters.LastOrDefault(c => urls.Contains(c.Url));
        source.DownloadBoundaryUrl = last?.Url;
        source.NewSinceDownload = CrawlerPlan.NewChapters(CrawlerPlan.Read<List<CrawlerChapter>>(source.ChaptersJson), last?.Url);
        // A successfully generated and validated EPUB establishes the user's source.
        // Keep normal Links as the visible, editable record of that preference.
        var links = await db.BookLinks.Where(l => l.BookId == source.BookId).ToListAsync(ct);
        if (!links.Any(l => CrawlerPlan.CanonicalUrl(l.Url) == source.Url))
        {
            db.BookLinks.Add(new BookLink { BookId = source.BookId, Url = source.Url,
                SourceType = "Reading", Label = source.SourceName });
        }
        source.Tracked = true;
    }

    public async Task MaintainAsync(CancellationToken ct)
    {
        if (!_options.Enabled) return;
        // Legacy metadata searches waited for a global retry. Searches now finish
        // after one pass; wake them to reconcile preserved partial results.
        var metadataWaiting = await db.CrawlerJobs.Where(j => (j.Kind == "search" || j.Kind == "discovery") &&
            j.Status == "queued" && j.NextAttemptAtUtc > DateTime.UtcNow && j.ResultJson != "{}").Take(100).ToListAsync(ct);
        foreach (var job in metadataWaiting)
        {
            var result = CrawlerPlan.Read<EpubSearchResult>(job.ResultJson);
            if (result.NextRetryAt == null) continue;
            job.NextAttemptAtUtc = DateTime.UtcNow;
            job.ResultJson = CrawlerPlan.Serialize(result with { NextRetryAt = null });
        }
        await db.SaveChangesAsync(ct);
        var novelIds = db.Books.Where(b => b.ContentType.Slug == "novel").Select(b => b.Id);
        await db.CrawlerJobs.Where(j => !novelIds.Contains(j.BookId) && !Terminal.Contains(j.Status))
            .ExecuteUpdateAsync(s => s.SetProperty(j => j.CancelRequested, true), ct);
        Guid? cursor = null;
        for (var page = 0; page < 100; page++)
        {
            var activeIds = await remote.ActiveJobsAsync(cursor, ct);
            if (activeIds.Count == 0) break;
            var existing = await db.CrawlerJobs.AsNoTracking().Where(j => activeIds.Contains(j.Id) && novelIds.Contains(j.BookId))
                .Select(j => j.Id).ToListAsync(ct);
            foreach (var orphan in activeIds.Except(existing))
            {
                await remote.CancelAsync(orphan, ct);
                logger.LogInformation("Cancelled orphan crawler operation {JobId}; its book/account no longer exists.", orphan);
            }
            if (activeIds.Count < 100) break;
            cursor = activeIds[^1];
        }
        var supported = await remote.SourcesAsync(ct);
        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        if (db.Database.IsNpgsql())
            await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock({914732833L})", ct);
        var domains = supported.Where(s => CrawlerPlan.AllowedHost(new Uri(s.Url).IdnHost))
            .SelectMany(s => new[] { s.Domain, new Uri(s.Url).IdnHost }).Where(CrawlerPlan.AllowedHost)
            .Select(CrawlerPlan.SourceHost).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var links = await db.BookLinks.AsNoTracking().Where(l => novelIds.Contains(l.BookId))
            .Select(l => new { l.BookId, l.Url, l.Book.OwnerId }).ToListAsync(ct);
        var valid = links.Select(l => new { l.BookId, l.OwnerId, Url = CrawlerPlan.CanonicalUrl(l.Url) })
            .Where(l => l.Url != null && CrawlerPlan.SupportedUrl(l.Url, domains)).Distinct().ToList();
        var sources = await db.BookCrawlerSources.ToListAsync(ct);
        foreach (var link in valid)
        {
            var source = sources.Find(s => s.BookId == link.BookId && s.Url == link.Url);
            if (source == null)
            {
                source = new BookCrawlerSource { OwnerId = link.OwnerId, BookId = link.BookId, Url = link.Url!,
                    SourceName = new Uri(link.Url!).Host, Tracked = true, NextScanAtUtc = DateTime.UtcNow };
                db.BookCrawlerSources.Add(source); sources.Add(source);
            }
            source.Tracked = true;
            if (source.LastScannedAtUtc == null && source.LastError == null) source.NextScanAtUtc = DateTime.UtcNow;
        }
        var eligibleBooks = (await novelIds.ToListAsync(ct)).ToHashSet();
        foreach (var source in sources)
            source.Tracked = eligibleBooks.Contains(source.BookId) && CrawlerPlan.SupportedUrl(source.Url, domains) &&
                (source.Selected || valid.Any(l => l.BookId == source.BookId && l.Url == source.Url));
        var now = DateTime.UtcNow;
        await ScheduleDiscoveryAsync(now, ct);
        // Only one metadata scan per URL, including when several accounts track it.
        var activeUrls = (await db.CrawlerJobs.Where(j => j.Kind == "scan" && !Terminal.Contains(j.Status)).ToListAsync(ct))
            .Select(j => CrawlerPlan.Read<CrawlerWork>(j.RequestJson).Url).ToHashSet();
        foreach (var source in sources.Where(s => s.Tracked && s.NextScanAtUtc <= now).GroupBy(s => s.Url).Select(g => g.First()).Take(20))
        {
            if (activeUrls.Contains(source.Url)) continue;
            db.CrawlerJobs.Add(new CrawlerJob { OwnerId = source.OwnerId, BookId = source.BookId, Kind = "scan",
                RequestKey = Guid.NewGuid().ToString("N"), RequestJson = CrawlerPlan.Serialize(new CrawlerWork { Kind = "inspect", Url = source.Url }),
                CreatedAtUtc = now, NextAttemptAtUtc = now, ExpiresAtUtc = now + _options.JobLifetime });
        }
        CrawlerTelemetry.Queue.Record(await db.CrawlerJobs.CountAsync(j => !Terminal.Contains(j.Status), ct));
        foreach (var source in sources.Where(s => s.Tracked && s.LastScannedAtUtc != null))
            CrawlerTelemetry.ScanAge.Record((now - source.LastScannedAtUtc!.Value).TotalHours);
        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
        var old = await db.CrawlerJobs.Where(j => Terminal.Contains(j.Status) && j.ExpiresAtUtc < now).Take(50).ToListAsync(ct);
        foreach (var job in old)
        {
            await remote.DeleteAsync(job.Id, ct);
            db.CrawlerJobs.Remove(job);
        }
        await db.SaveChangesAsync(ct);
    }

    private async Task ScheduleDiscoveryAsync(DateTime now, CancellationToken ct)
    {
        // Seed a bounded persistent backlog; no network requests occur in this step.
        var missingQuery = db.Books.Where(b => b.ContentType.Slug == "novel" && !db.BookCrawlerDiscoveries.Any(d => d.BookId == b.Id));
        var missing = db.Database.IsNpgsql()
            ? await missingQuery.OrderByDescending(b => b.Created).Select(b => new { b.Id, b.OwnerId }).Take(200).ToListAsync(ct)
            : (await missingQuery.Select(b => new { b.Id, b.OwnerId, b.Created }).ToListAsync(ct))
                .OrderByDescending(b => b.Created).Take(200).Select(b => new { b.Id, b.OwnerId }).ToList();
        foreach (var book in missing)
            db.BookCrawlerDiscoveries.Add(new BookCrawlerDiscovery { BookId = book.Id, OwnerId = book.OwnerId, NextCheckAtUtc = now });
        await db.SaveChangesAsync(ct);
        // One library search actively runs at a time. A durable source cooldown
        // releases admission so an unrelated book can proceed while it waits.
        if (await db.CrawlerJobs.AnyAsync(j => j.Kind == "discovery" && !Terminal.Contains(j.Status) &&
            !(j.Status == "queued" && j.NextAttemptAtUtc > now), ct)) return;
        var eligible = from discovery in db.BookCrawlerDiscoveries
            join book in db.Books on discovery.BookId equals book.Id
            where book.ContentType.Slug == "novel" && discovery.NextCheckAtUtc <= now &&
                !db.CrawlerJobs.Any(j => j.BookId == book.Id && j.Kind == "discovery" && !Terminal.Contains(j.Status)) &&
                !db.CrawlerJobs.Any(j => j.BookId == book.Id && j.Kind == "search" && !Terminal.Contains(j.Status) && !j.CancelRequested && j.ExpiresAtUtc > now) &&
                (discovery.LastCheckedAtUtc == null ||
                    (book.Status.Slug != "completed" && book.Status.Slug != "complete" && book.Status.Slug != "dropped" &&
                     !db.BookCrawlerSources.Any(s => s.BookId == book.Id && s.Tracked)))
            select new { Discovery = discovery, Book = book };
        var next = db.Database.IsNpgsql()
            ? await eligible.OrderBy(item => item.Discovery.LastCheckedAtUtc != null)
                .ThenByDescending(item => item.Book.Created).FirstOrDefaultAsync(ct)
            : (await eligible.ToListAsync(ct)).OrderBy(item => item.Discovery.LastCheckedAtUtc != null)
                .ThenByDescending(item => item.Book.Created).FirstOrDefault();
        if (next == null) return;
        await EpubCrawlerService.LockBookAsync(db, next.Book.Id, ct);
        if (await db.CrawlerJobs.AnyAsync(j => j.BookId == next.Book.Id &&
            (j.Kind == "search" || j.Kind == "discovery") && !Terminal.Contains(j.Status) && !j.CancelRequested && j.ExpiresAtUtc > now, ct)) return;
        var urls = await db.BookLinks.Where(l => l.BookId == next.Book.Id).Select(l => l.Url).ToListAsync(ct);
        var work = new CrawlerWork { Kind = "search", Scope = "all", Query = next.Book.PrimaryTitle,
            Background = true, InitialDiscovery = next.Discovery.LastCheckedAtUtc == null,
            Urls = urls.Select(CrawlerPlan.CanonicalUrl).Where(u => u != null).Cast<string>().Distinct().ToList() };
        db.CrawlerJobs.Add(new CrawlerJob { OwnerId = next.Book.OwnerId, BookId = next.Book.Id, Kind = "discovery",
            RequestKey = Guid.NewGuid().ToString("N"), RequestJson = CrawlerPlan.Serialize(work), CreatedAtUtc = now,
            NextAttemptAtUtc = now, ExpiresAtUtc = now + _options.JobLifetime });
    }

    private sealed class CrawlerActor(Guid id) : IUser
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
