namespace Infrastructure.BookFiles;

using System.IO.Compression;
using System.Security.Cryptography;
using System.Text.Json;
using Application.Common.DTOs.Book;
using Archives;

public sealed partial class BookFileService
{
    public async Task<BookFileJobDto> CreateExportAsync(IReadOnlyList<Guid> fileIds, Guid? snapshotId,
        bool includeManifest, CancellationToken ct)
    {
        if (snapshotId.HasValue && includeManifest)
        {
            throw new ValidationException("Library exports are available only to their owner.");
        }

        var files = await AuthorizedFilesAsync(fileIds, user.RequiredId, snapshotId, ct);
        if (includeManifest && files.Count >= _options.MaxLibraryArchiveEntries)
        {
            throw new ValidationException("Select fewer files to leave room for the export manifest.");
        }

        var size = files.Sum(f => f.SizeBytes) + 16L * 1024 * 1024;
        if (size > _options.MaxLibraryArchiveBytes)
        {
            throw new ValidationException("The EPUB export is too large. Select fewer books or files.");
        }

        var job = await ReserveJobAsync(includeManifest ? "LibraryExport" : "Export", null, size, ct);
        job.TotalFiles = files.Count;
        job.Status = "Queued";
        SetPayload(job,
            new BookFileJobPayload
            {
                FileIds = fileIds.ToList(), SnapshotId = snapshotId, IncludeManifest = includeManifest
            });
        await context.SaveChangesAsync(ct);
        return JobDto(job);
    }

    public async Task<IReadOnlyList<BookFileDownloadDto>> CreateDownloadsAsync(IReadOnlyList<Guid> fileIds,
        Guid? snapshotId, CancellationToken ct)
    {
        await abuseGuard.ThrowIfBlockedAsync(user, ct);
        var files = await AuthorizedFilesAsync(fileIds, user.RequiredId, snapshotId, ct);
        var result = new List<BookFileDownloadDto>();
        foreach (var file in files)
        {
            result.Add(await TicketAsync(file.Id, snapshotId, null, file.Title, ct));
        }

        await context.SaveChangesAsync(ct);
        return result;
    }

    public async Task<BookFileDownloadDto> CreateJobDownloadAsync(Guid jobId, CancellationToken ct)
    {
        var job = await OwnedJobAsync(jobId, ct);
        if (job.Kind is not ("Export" or "LibraryExport") || job.Status != "Ready")
        {
            throw new ValidationException("The EPUB export is not ready to download.");
        }

        var payload = Payload(job);
        await AuthorizedFilesAsync(payload.FileIds, user.RequiredId, payload.SnapshotId, ct);
        var result = await TicketAsync(null, payload.SnapshotId, jobId, "EPUB archive", ct);
        await context.SaveChangesAsync(ct);
        return result;
    }

    public async Task<BookFileDownloadResult> ConsumeDownloadAsync(Guid id, string token, CancellationToken ct)
    {
        if (token.Length != 64)
        {
            throw new EntityNotFoundException<BookFileDownloadTicket, Guid>(id);
        }

        var hash = TokenHash(token);
        var now = DateTime.UtcNow;
        var ticket = await context.BookFileDownloadTickets.AsNoTracking()
                         .SingleOrDefaultAsync(
                             t => t.Id == id && t.TokenHash == hash && t.ExpiresAtUtc > now && t.ConsumedAtUtc == null,
                             ct)
                     ?? throw new EntityNotFoundException<BookFileDownloadTicket, Guid>(id);
        await CheckAccountAsync(ticket.OwnerId, ct);
        var consumed = await context.BookFileDownloadTickets.Where(t =>
                t.Id == id && t.TokenHash == hash && t.ExpiresAtUtc > now && t.ConsumedAtUtc == null)
            .ExecuteUpdateAsync(s => s.SetProperty(t => t.ConsumedAtUtc, now), ct);
        if (consumed != 1)
        {
            throw new EntityNotFoundException<BookFileDownloadTicket, Guid>(id);
        }

        if (ticket.FileId.HasValue)
        {
            var file =
                (await AuthorizedFilesAsync([ticket.FileId.Value], ticket.OwnerId, ticket.SnapshotId, ct)).Single();
            return new BookFileDownloadResult(await storage.OpenReadAsync(file.StoragePath, ct), file.MimeType,
                $"{SafeName(file.Title)}.epub");
        }

        var job = await context.BookFileJobs.AsNoTracking().SingleOrDefaultAsync(
                      j => j.Id == ticket.JobId && j.OwnerId == ticket.OwnerId &&
                           (j.Kind == "Export" || j.Kind == "LibraryExport") && j.Status == "Ready" &&
                           j.ExpiresAtUtc > now, ct)
                  ?? throw new EntityNotFoundException<BookFileJob, Guid>(ticket.JobId ?? Guid.Empty);
        var payload = Payload(job);
        await AuthorizedFilesAsync(payload.FileIds, ticket.OwnerId, payload.SnapshotId, ct);
        return new BookFileDownloadResult(File.OpenRead(JobPath(job.Id, "export.zip")), "application/zip",
            payload.IncludeManifest ? "tsundoku-epubs.zip" : "book-epubs.zip");
    }

    private async Task<List<BookFile>> AuthorizedFilesAsync(IReadOnlyList<Guid> ids, Guid actorId, Guid? snapshotId,
        CancellationToken ct, bool allowEmpty = false)
    {
        if ((!allowEmpty && ids.Count == 0) || ids.Count > _options.MaxLibraryArchiveEntries ||
            ids.Distinct().Count() != ids.Count)
        {
            throw new ValidationException("Choose a valid, unique selection of EPUB files.");
        }

        var query = context.BookFiles.AsNoTracking().Where(f => ids.Contains(f.Id) && f.DeletedAtUtc == null);
        if (snapshotId.HasValue)
        {
            query = query.Where(f => context.PublicBookFiles.Any(p =>
                p.BookFileId == f.Id && p.SnapshotId == snapshotId &&
                context.PublicBookSnapshots.Any(s =>
                    s.Id == p.SnapshotId && s.SourceBookId == f.BookId && s.OwnerId == f.OwnerId)));
        }
        else
        {
            query = query.Where(f => f.OwnerId == actorId);
        }

        var files = await query.OrderBy(f => f.BookId).ThenBy(f => f.SortOrder).ThenBy(f => f.Id).ToListAsync(ct);
        if (files.Count != ids.Count)
        {
            throw new EntityNotFoundException<BookFile, Guid>(Guid.Empty);
        }

        return files;
    }

    private async Task BuildExportAsync(BookFileJob job, BookFileJobPayload payload, CancellationToken ct)
    {
        var files = await AuthorizedFilesAsync(payload.FileIds, job.OwnerId, payload.SnapshotId, ct);
        var ids = files.Select(f => f.BookId).Distinct().ToList();
        var books = await context.Books.AsNoTracking().Where(b => ids.Contains(b.Id))
            .Select(b => new { b.Id, b.PrimaryTitle, Type = b.ContentType.Name }).ToDictionaryAsync(b => b.Id, ct);
        var manifest = new BookFileManifest();
        var budget = new ArchiveReadBudget(_options.MaxLibraryArchiveBytes);
        await using var target = new FileStream(JobPath(job.Id, "export.zip"), FileMode.CreateNew, FileAccess.Write,
            FileShare.None, 65536, true);
        using (var archive = new ZipArchive(target, ZipArchiveMode.Create, true))
        {
            foreach (var group in files.GroupBy(f => f.BookId))
            {
                var book = books[group.Key];
                var manifestBook = new BookFileManifestBook(book.Id, book.PrimaryTitle, book.Type, []);
                manifest.Books.Add(manifestBook);
                foreach (var file in group)
                {
                    await EnsureRunningAsync(job, ct);
                    // Check again before each copy; publication or deletion may have changed while queued.
                    await AuthorizedFilesAsync([file.Id], job.OwnerId, payload.SnapshotId, ct);
                    var name = $"{file.SortOrder:D5}-{SafeName(file.Title)}-{file.Id:N}.epub";
                    var entryPath = payload.IncludeManifest
                        ? $"{SafeName(book.PrimaryTitle)}-{book.Id:N}/{name}"
                        : name;
                    var entry = archive.CreateEntry(entryPath, CompressionLevel.NoCompression);
                    await using (var source = await storage.OpenReadAsync(file.StoragePath, ct))
                    await using (var destination = entry.Open())
                    {
                        await ArchiveSafety.CopyAsync(source, destination, _options.MaxFileBytes, file.SizeBytes,
                            budget, ct);
                    }

                    manifestBook.Files.Add(new BookFileManifestEntry(entryPath, file.Title, file.OriginalFileName,
                        file.SortOrder,
                        file.SizeBytes, file.Sha256));
                    job.ProcessedFiles++;
                    job.UpdatedAtUtc = DateTime.UtcNow;
                    await context.SaveChangesAsync(ct);
                }
            }

            if (payload.IncludeManifest)
            {
                var json = JsonSerializer.SerializeToUtf8Bytes(manifest, JsonOptions);
                if (json.Length > 8 * 1024 * 1024)
                {
                    throw new ValidationException("Export manifest is too large. Select fewer files.");
                }

                var entry = archive.CreateEntry("manifest.json", CompressionLevel.NoCompression);
                await using var content = entry.Open();
                await content.WriteAsync(json, ct);
            }
        }

        if (target.Length > _options.MaxLibraryArchiveBytes)
        {
            throw new ValidationException("EPUB archive exceeds the export size limit.");
        }
    }

    private static string SafeName(string value)
    {
        var name = new string(value.Take(60).Select(c => char.IsLetterOrDigit(c) || c is '-' or '_' or ' ' ? c : '_')
            .ToArray()).Trim();
        return name.Length == 0 ? "book" : name;
    }

    private Task<BookFileDownloadDto> TicketAsync(Guid? fileId, Guid? snapshotId, Guid? jobId, string title,
        CancellationToken ct)
    {
        var token = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
        var ticket = new BookFileDownloadTicket
        {
            OwnerId = user.RequiredId,
            FileId = fileId,
            SnapshotId = snapshotId,
            JobId = jobId,
            TokenHash = TokenHash(token),
            ExpiresAtUtc = DateTime.UtcNow + _options.TicketLifetime
        };
        context.BookFileDownloadTickets.Add(ticket);
        return Task.FromResult(new BookFileDownloadDto(fileId ?? jobId!.Value, title,
            $"/{ApiRoutes.Book}/files/download/{ticket.Id}?token={token}"));
    }

    private static string TokenHash(string token)
    {
        return Convert.ToHexString(SHA256.HashData(Encoding.ASCII.GetBytes(token)));
    }

    private async Task CheckAccountAsync(Guid ownerId, CancellationToken ct)
    {
        var account = await context.Users.AsNoTracking().SingleOrDefaultAsync(u => u.Id == ownerId, ct)
                      ?? throw new UnauthorizedAccessException("The download account is no longer available.");
        if (account.LockoutEnabled && account.LockoutEnd > DateTimeOffset.UtcNow)
        {
            throw new UnauthorizedAccessException("The account is locked.");
        }

        await abuseGuard.ThrowIfBlockedAsync(await ActorAsync(ownerId, ct), ct);
    }

    private async Task<IUser> ActorAsync(Guid id, CancellationToken ct)
    {
        return new JobActor(id,
            await (from ur in context.UserRoles
                join role in context.Roles on ur.RoleId equals role.Id
                where ur.UserId == id
                select role.Name!).ToListAsync(ct));
    }

    private sealed class JobActor(Guid id, IReadOnlyList<string> roles) : IUser
    {
        public Guid? Id => id;
        public Guid RequiredId => id;
        public string? Email => null;
        public string? Username => null;
        public IEnumerable<string> Roles => roles;
        public bool IsAuthenticated => true;
        public bool Valid => true;
    }
}
