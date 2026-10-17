namespace Infrastructure.Crawler;

using Application.Common.DTOs.Book;
using Microsoft.Extensions.Options;

public sealed class EpubCrawlerService(ApplicationDbContext db, IUser user, IOptions<CrawlerOptions> options)
    : IEpubCrawlerService
{
    private async Task OwnedBook(Guid id, CancellationToken ct)
    {
        if (!await db.Books.AnyAsync(b => b.Id == id && b.OwnerId == user.RequiredId, ct))
            throw new EntityNotFoundException<Book, Guid>(id);
        if (!await db.Books.AnyAsync(b => b.Id == id && b.ContentType.Slug == "novel", ct))
            throw new ValidationException("The EPUB crawler currently supports novels only.");
    }

    private void Enabled()
    {
        if (!options.Value.Enabled) throw new ValidationException("The EPUB crawler is not enabled on this server.");
    }

    public async Task<EpubSearchJob> SearchAsync(Guid bookId, EpubSearchRequest request, CancellationToken ct)
    {
        Enabled();
        await OwnedBook(bookId, ct);
        if (string.IsNullOrWhiteSpace(request.Query) || request.Query.Trim().Length is < 2 or > 200 ||
            request.Scope is not ("english" or "all")) throw new ValidationException("Enter a title between 2 and 200 characters.");
        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        await LockOwnerAsync(ct);
        await LockBookAsync(db, bookId, ct);
        var title = await db.Books.Where(b => b.Id == bookId).Select(b => b.PrimaryTitle).SingleAsync(ct);
        var previous = await db.CrawlerJobs.Where(j => j.BookId == bookId && j.OwnerId == user.RequiredId &&
                (j.Kind == "search" || j.Kind == "discovery") && j.Status != "failed" && j.Status != "cancelled" &&
                !j.CancelRequested && (j.Status == "completed" || j.ExpiresAtUtc > DateTime.UtcNow))
            .OrderByDescending(j => j.CreatedAtUtc).ToListAsync(ct);
        bool Matches(CrawlerJob job)
        {
            var query = CrawlerPlan.Read<CrawlerWork>(job.RequestJson);
            return string.Equals(query.Query?.Trim(), request.Query.Trim(), StringComparison.OrdinalIgnoreCase) &&
                   Covers(query.Scope, request.Scope);
        }
        var active = previous.FirstOrDefault(j => !CrawlerPlan.Terminal(j.Status) && Matches(j));
        var saved = await db.BookCrawlerDiscoveries.AsNoTracking().SingleOrDefaultAsync(d => d.BookId == bookId, ct);
        var snapshot = saved?.ResultJson is not (null or "{}") ? CrawlerPlan.Read<EpubSearchResult>(saved.ResultJson) : null;
        var snapshotMatches = snapshot != null &&
            string.Equals((snapshot.Query ?? title).Trim(), request.Query.Trim(), StringComparison.OrdinalIgnoreCase) &&
            (snapshot.Scope == null ? request.Scope == "english" : Covers(snapshot.Scope, request.Scope));
        EpubSearchJob dto;
        if (active != null)
            dto = await SearchDtoAsync(active, ct);
        else if (!request.ForceRefresh && snapshotMatches)
            dto = await SearchDtoAsync(SnapshotJob(saved!), ct);
        else if (!request.ForceRefresh && previous.FirstOrDefault(j => j.Status == "completed" && Matches(j)) is { } completed)
            dto = await SearchDtoAsync(completed, ct);
        else
        {
            var links = await db.BookLinks.Where(l => l.BookId == bookId).Select(l => l.Url).ToListAsync(ct);
            var selected = await db.BookCrawlerSources.Where(s => s.BookId == bookId && s.Selected).Select(s => s.Url).ToListAsync(ct);
            var work = new CrawlerWork { Query = request.Query.Trim(), Scope = request.Scope,
                Urls = links.Concat(selected).Select(CrawlerPlan.CanonicalUrl).Where(u => u != null).Cast<string>().Distinct().ToList() };
            dto = await SearchDtoAsync(await Create(bookId, "search", Guid.NewGuid().ToString("N"), work, ct), ct);
        }
        await transaction.CommitAsync(ct);
        return dto;
    }

    private static bool Covers(string available, string requested) => available == "all" || available == requested;

    private static CrawlerJob SnapshotJob(BookCrawlerDiscovery saved) => new()
    {
        Id = saved.Id, OwnerId = saved.OwnerId, BookId = saved.BookId, Kind = "search",
        Status = "completed", ResultJson = saved.ResultJson
    };

    private async Task LockOwnerAsync(CancellationToken ct)
    {
        if (db.Database.IsNpgsql())
            await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock({BitConverter.ToInt64(user.RequiredId.ToByteArray())})", ct);
    }

    internal static async Task LockBookAsync(ApplicationDbContext context, Guid bookId, CancellationToken ct)
    {
        if (context.Database.IsNpgsql())
            await context.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock({914732834}, {bookId.GetHashCode()})", ct);
    }

    private async Task<CrawlerJob> Create(Guid bookId, string kind, string key, CrawlerWork work, CancellationToken ct)
    {
        await using var transaction = db.Database.CurrentTransaction == null ? await db.Database.BeginTransactionAsync(ct) : null;
        await LockOwnerAsync(ct);
        var existing = await db.CrawlerJobs.SingleOrDefaultAsync(j => j.OwnerId == user.RequiredId && j.Kind == kind && j.RequestKey == key, ct);
        if (existing != null)
        {
            if (existing.BookId != bookId || existing.RequestJson != CrawlerPlan.Serialize(work))
                throw new ValidationException("This request identifier was already used for different download options.");
            return existing;
        }
        if (await db.CrawlerJobs.CountAsync(j => j.OwnerId == user.RequiredId && (j.Kind == "search" || j.Kind == "download") && j.ExpiresAtUtc > DateTime.UtcNow &&
                j.Status != "completed" && j.Status != "failed" && j.Status != "cancelled", ct) >= options.Value.MaxActiveJobsPerOwner)
            throw new ValidationException("Finish or cancel an existing crawler operation first.");
        var now = DateTime.UtcNow;
        var job = new CrawlerJob { OwnerId = user.RequiredId, BookId = bookId, Kind = kind, RequestKey = key,
            RequestJson = CrawlerPlan.Serialize(work), CreatedAtUtc = now, NextAttemptAtUtc = now,
            ExpiresAtUtc = now + options.Value.JobLifetime };
        if (kind == "download")
        {
            var source = await db.BookCrawlerSources.SingleAsync(s => s.Id == work.SourceId, ct);
            job.ResultJson = CrawlerPlan.Serialize(new EpubDownloadJob { Id = job.Id, BookId = bookId,
                SourceName = source.SourceName, StartedAt = now, ChaptersTotal = work.Files.Sum(f => f.ChapterIds.Count),
                Files = work.Files.Select(f => new EpubDownloadFile { Title = f.Title, FirstChapter = f.FirstChapter, LastChapter = f.LastChapter }).ToList() });
            var sources = await db.BookCrawlerSources.Where(s => s.BookId == bookId).ToListAsync(ct);
            foreach (var item in sources) item.Selected = item.Id == source.Id;
            source.Tracked = true;
        }
        db.CrawlerJobs.Add(job);
        await db.SaveChangesAsync(ct);
        if (transaction != null) await transaction.CommitAsync(ct);
        return job;
    }

    public async Task<EpubDownloadJob> DownloadAsync(Guid bookId, EpubDownloadRequest request, CancellationToken ct)
    {
        Enabled();
        await OwnedBook(bookId, ct);
        if (string.IsNullOrWhiteSpace(request.RequestKey) || request.RequestKey.Length > 100)
            throw new ValidationException("A download request identifier is required.");
        var source = await db.BookCrawlerSources.SingleOrDefaultAsync(s => s.Id == request.SourceId && s.BookId == bookId && s.OwnerId == user.RequiredId, ct)
            ?? throw new ValidationException("Search again and choose an available source.");
        var chapters = CrawlerPlan.Read<List<CrawlerChapter>>(source.ChaptersJson);
        var work = new CrawlerWork { Kind = "download", SourceId = source.Id, Url = source.Url, Chapters = chapters,
            AddAutomatically = request.AddToBookAutomatically, Files = CrawlerPlan.Files(request, chapters) };
        return DownloadDto(await Create(bookId, "download", request.RequestKey, work, ct));
    }

    private async Task<CrawlerJob> OwnedJob(Guid id, string kind, CancellationToken ct) =>
        await db.CrawlerJobs.SingleOrDefaultAsync(j => j.Id == id && j.OwnerId == user.RequiredId && j.Kind == kind, ct)
        ?? throw new EntityNotFoundException<CrawlerJob, Guid>(id);

    public async Task<EpubSearchJob> GetSearchAsync(Guid id, CancellationToken ct)
    {
        var job = await db.CrawlerJobs.SingleOrDefaultAsync(j => j.Id == id && j.OwnerId == user.RequiredId &&
            (j.Kind == "search" || j.Kind == "discovery"), ct);
        if (job != null) return await SearchDtoAsync(job, ct);
        var saved = await db.BookCrawlerDiscoveries.AsNoTracking().SingleOrDefaultAsync(d => d.Id == id && d.OwnerId == user.RequiredId, ct)
            ?? throw new EntityNotFoundException<CrawlerJob, Guid>(id);
        return await SearchDtoAsync(SnapshotJob(saved), ct);
    }
    public async Task<EpubDownloadJob> GetDownloadAsync(Guid id, CancellationToken ct) => DownloadDto(await OwnedJob(id, "download", ct));
    public async Task<IReadOnlyList<EpubDownloadJob>> ListDownloadsAsync(Guid bookId, CancellationToken ct)
    {
        await OwnedBook(bookId, ct);
        return (await db.CrawlerJobs.Where(j => j.BookId == bookId && j.OwnerId == user.RequiredId && j.Kind == "download")
            .OrderByDescending(j => j.CreatedAtUtc).Take(20).ToListAsync(ct)).Select(DownloadDto).ToList();
    }

    public async Task<IReadOnlyList<EpubDownloadJob>> ListOwnerDownloadsAsync(CancellationToken ct)
    {
        var cutoff = DateTime.UtcNow.AddDays(-1);
        var jobs = await db.CrawlerJobs.AsNoTracking().Where(j => j.OwnerId == user.RequiredId && j.Kind == "download")
            .Where(j => j.CreatedAtUtc >= cutoff || (j.Status != "completed" && j.Status != "failed" && j.Status != "cancelled"))
            .OrderBy(j => j.Status == "completed" || j.Status == "failed" || j.Status == "cancelled")
            .ThenByDescending(j => j.CreatedAtUtc).Take(200).ToListAsync(ct);
        var bookIds = jobs.Select(j => j.BookId).Distinct().ToList();
        var titles = await db.Books.AsNoTracking().Where(b => b.OwnerId == user.RequiredId && bookIds.Contains(b.Id) && b.ContentType.Slug == "novel")
            .ToDictionaryAsync(b => b.Id, b => b.PrimaryTitle, ct);
        return jobs.Where(j => titles.ContainsKey(j.BookId)).Select(j =>
        {
            var dto = DownloadDto(j);
            dto.BookTitle = titles[j.BookId];
            return dto;
        }).ToList();
    }

    public async Task<EpubDownloadJob> CancelAsync(Guid id, CancellationToken ct)
    {
        var job = await OwnedJob(id, "download", ct);
        if (!CrawlerPlan.Terminal(job.Status))
            await db.CrawlerJobs.Where(j => j.Id == id).ExecuteUpdateAsync(s => s.SetProperty(j => j.CancelRequested, true), ct);
        return DownloadDto(job);
    }

    internal static EpubSearchJob SearchDto(CrawlerJob job) => new(job.Id, job.Status,
        job.ResultJson == "{}" ? null : CrawlerPlan.Read<EpubSearchResult>(job.ResultJson), job.Error);
    private async Task<EpubSearchJob> SearchDtoAsync(CrawlerJob job, CancellationToken ct)
    {
        var dto = SearchDto(job);
        if (dto.Result == null && (job.Kind == "search" || job.Kind == "discovery"))
        {
            var saved = await db.BookCrawlerDiscoveries.AsNoTracking().SingleOrDefaultAsync(d => d.BookId == job.BookId && d.OwnerId == job.OwnerId, ct);
            if (saved?.ResultJson is not (null or "{}"))
            {
                var result = CrawlerPlan.Read<EpubSearchResult>(saved.ResultJson);
                var title = result.Query ?? await db.Books.Where(b => b.Id == job.BookId).Select(b => b.PrimaryTitle).SingleAsync(ct);
                if (string.Equals(title.Trim(), CrawlerPlan.Read<CrawlerWork>(job.RequestJson).Query?.Trim(), StringComparison.OrdinalIgnoreCase))
                    dto = dto with { Result = result };
            }
        }
        if (dto.Result == null) return dto;
        var sources = await db.BookCrawlerSources.AsNoTracking().Where(s => s.BookId == job.BookId && s.OwnerId == job.OwnerId).ToDictionaryAsync(s => s.Id, ct);
        var candidates = dto.Result.Candidates.Select(c => c with { Sources = c.Sources.Select(s =>
        {
            if (!sources.TryGetValue(s.Id, out var current) || current.LastScannedAtUtc == null) return s;
            var chapters = CrawlerPlan.Read<List<CrawlerChapter>>(current.ChaptersJson);
            return s with { FetchedAt = current.LastScannedAtUtc, ChapterCount = chapters.Count,
                LatestChapterLabel = chapters.LastOrDefault()?.Label };
        }).ToList() }).ToList();
        return dto with { Result = dto.Result with { Candidates = candidates } };
    }
    internal static EpubDownloadJob DownloadDto(CrawlerJob job)
    {
        var dto = CrawlerPlan.Read<EpubDownloadJob>(job.ResultJson);
        dto.Status = job.Status;
        dto.Error = job.Error;
        return dto;
    }
}
