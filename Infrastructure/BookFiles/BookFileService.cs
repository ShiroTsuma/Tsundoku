namespace Infrastructure.BookFiles;

using System.Text.Json;
using Application.Common.DTOs.Book;
using Microsoft.EntityFrameworkCore.Storage;
using Microsoft.Extensions.Options;
using Services;

public sealed partial class BookFileService(
    ApplicationDbContext context,
    IUser user,
    IBookFileStorage storage,
    IStorageCleanupQueue cleanup,
    IOptions<BookFileOptions> options,
    IOptions<BookImportSecurityOptions> securityOptions,
    AccountAbuseGuard abuseGuard) : IBookFileService
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web) { MaxDepth = 32 };
    private static readonly string[] TerminalStatuses = ["Completed", "Failed", "Cancelled"];

    private static readonly string[] WorkingStatuses =
        ["Uploading", "Queued", "Processing", "CommitQueued", "Committing"];

    private readonly BookFileOptions _options = options.Value;
    private readonly BookImportSecurityOptions _security = securityOptions.Value;

    public BookFileLimitsDto Limits()
    {
        return new BookFileLimitsDto(_options.MaxFileBytes, _options.MaxUploadBytes, _options.MaxFilesPerImport,
            _options.MaxLibraryArchiveBytes, _options.Retention.TotalDays);
    }

    public async Task<BookFileListDto> ListAsync(Guid bookId, CancellationToken ct)
    {
        var book = await OwnedBookAsync(bookId, user.RequiredId, ct);
        var files = await context.BookFiles.AsNoTracking()
            .Where(f => f.BookId == bookId && f.OwnerId == user.RequiredId)
            .OrderBy(f => f.SortOrder).ThenBy(f => f.Id).ToListAsync(ct);
        var snapshotId = await context.PublicBookSnapshots
            .Where(s => s.SourceBookId == bookId && s.OwnerId == user.RequiredId)
            .Select(s => (Guid?)s.Id).SingleOrDefaultAsync(ct);
        var shared = snapshotId.HasValue
            ? await context.PublicBookFiles.Where(p => p.SnapshotId == snapshotId)
                .Select(p => p.BookFileId).ToListAsync(ct)
            : [];
        return new BookFileListDto(files.Select(f => ToDto(f, shared.Contains(f.Id), book.PrimaryTitle)).ToList(), snapshotId,
            await UsedBytesAsync(user.RequiredId, ct), _options.MaxOwnerStorageBytes, _options.MaxFileBytes,
            _options.MaxUploadBytes);
    }

    public async Task<IReadOnlyList<BookFileDto>> ListPublicAsync(Guid snapshotId, CancellationToken ct)
    {
        _ = user.RequiredId;
        if (!await context.PublicBookSnapshots.AnyAsync(s => s.Id == snapshotId, ct))
        {
            throw new EntityNotFoundException<PublicBookSnapshot, Guid>(snapshotId);
        }

        var bookTitle = await (from s in context.PublicBookSnapshots
            join b in context.Books on s.SourceBookId equals b.Id
            where s.Id == snapshotId
            select b.PrimaryTitle).SingleAsync(ct);
        return (await (from p in context.PublicBookFiles
            join f in context.BookFiles on p.BookFileId equals f.Id
            join s in context.PublicBookSnapshots on p.SnapshotId equals s.Id
            where s.Id == snapshotId && f.BookId == s.SourceBookId && f.OwnerId == s.OwnerId && f.DeletedAtUtc == null
            orderby f.SortOrder, f.Id
            select f).AsNoTracking().ToListAsync(ct)).Select(f => ToDto(f, true, bookTitle)).ToList();
    }

    public async Task UpdateAsync(Guid bookId, Guid fileId, string title, CancellationToken ct)
    {
        var file = await OwnedFileAsync(bookId, fileId, ct);
        if (file.DeletedAtUtc != null)
        {
            throw new ValidationException("Restore the file before editing it.");
        }

        file.Title = ValidateTitle(title);
        await context.SaveChangesAsync(ct);
    }

    public async Task ReorderAsync(Guid bookId, IReadOnlyList<Guid> ids, CancellationToken ct)
    {
        await OwnedBookAsync(bookId, user.RequiredId, ct);
        var files = await context.BookFiles
            .Where(f => f.BookId == bookId && f.OwnerId == user.RequiredId && f.DeletedAtUtc == null).ToListAsync(ct);
        if (ids.Count != files.Count || ids.Distinct().Count() != ids.Count || files.Any(f => !ids.Contains(f.Id)))
        {
            throw new ValidationException("The file list changed. Reload it before changing the order.");
        }

        for (var i = 0; i < ids.Count; i++)
        {
            files.Single(f => f.Id == ids[i]).SortOrder = i;
        }

        await context.SaveChangesAsync(ct);
    }

    public async Task DeleteAsync(Guid bookId, Guid fileId, CancellationToken ct)
    {
        await using var transaction = await LockAsync(user.RequiredId, ct);
        var file = await OwnedFileAsync(bookId, fileId, ct);
        if (file.DeletedAtUtc != null)
        {
            return;
        }

        file.DeletedAtUtc = DateTime.UtcNow;
        await context.PublicBookFiles.Where(p => p.BookFileId == fileId).ExecuteDeleteAsync(ct);
        await cleanup.EnqueueBookFilesAsync([file.StoragePath], file.DeletedAtUtc.Value + _options.Retention, ct);
        await context.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
    }

    public async Task RestoreAsync(Guid bookId, Guid fileId, CancellationToken ct)
    {
        await using var transaction = await LockAsync(user.RequiredId, ct);
        var file = await OwnedFileAsync(bookId, fileId, ct);
        if (file.DeletedAtUtc == null)
        {
            return;
        }

        if (file.DeletedAtUtc + _options.Retention <= DateTime.UtcNow)
        {
            throw new ValidationException("This file's retention period has expired.");
        }

        if (await context.BookFiles.AnyAsync(
                f => f.BookId == bookId && f.DeletedAtUtc == null && f.Sha256 == file.Sha256, ct))
        {
            throw new ValidationException("An identical EPUB already exists in this book.");
        }

        file.DeletedAtUtc = null;
        await context.PublicBookFiles.Where(p => p.BookFileId == fileId).ExecuteDeleteAsync(ct);
        await context.StorageCleanupQueueItems
            .Where(q => q.StorageKind == "BookFile" && q.StoragePath == file.StoragePath).ExecuteDeleteAsync(ct);
        await context.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
    }

    public async Task ShareAsync(Guid bookId, IReadOnlyList<Guid> ids, CancellationToken ct)
    {
        await using var transaction = await LockAsync(user.RequiredId, ct);
        await OwnedBookAsync(bookId, user.RequiredId, ct);
        var snapshot =
            await context.PublicBookSnapshots.SingleOrDefaultAsync(
                s => s.SourceBookId == bookId && s.OwnerId == user.RequiredId, ct)
            ?? throw new ValidationException("Publish this book before sharing EPUB files.");
        await AuthorizedFilesAsync(ids, user.RequiredId, null, ct, true);
        if (await context.BookFiles.AnyAsync(f => ids.Contains(f.Id) && f.BookId != bookId, ct))
        {
            throw new ValidationException("Every shared file must belong to this book.");
        }

        await context.PublicBookFiles.Where(p => p.SnapshotId == snapshot.Id).ExecuteDeleteAsync(ct);
        context.PublicBookFiles.AddRange(ids.Distinct()
            .Select(id => new PublicBookFile { SnapshotId = snapshot.Id, BookFileId = id }));
        await context.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
    }

    public async Task QueueDeletedBookFilesAsync(Guid ownerId, Guid? bookId, CancellationToken ct)
    {
        var keys = await context.BookFiles.Where(f => f.OwnerId == ownerId && (!bookId.HasValue || f.BookId == bookId))
            .Select(f => f.StoragePath).ToListAsync(ct);
        // Book deletion is irreversible: there is no file row left to restore or charge to the quota.
        await cleanup.EnqueueBookFilesAsync(keys, DateTime.UtcNow, ct);
    }

    public async Task<T> ExecuteBookDeletionAsync<T>(Guid ownerId, Guid? bookId,
        Func<CancellationToken, Task<T>> deletion, CancellationToken ct)
    {
        await using var transaction = await LockAsync(ownerId, ct);
        await QueueDeletedBookFilesAsync(ownerId, bookId, ct);
        var result = await deletion(ct);
        await transaction.CommitAsync(ct);
        return result;
    }

    public async Task<IReadOnlyList<BookFileExportCandidateDto>> ExportCandidatesAsync(string? query,
        CancellationToken ct)
    {
        var booksQuery = new BookSearchCriteriaApplier(context).Apply(
            context.Books.AsNoTracking().Where(b => b.OwnerId == user.RequiredId),
            BookSearchQueryParser.Parse(query));
        var books = await booksQuery.Where(b => context.BookFiles.Any(f => f.BookId == b.Id && f.DeletedAtUtc == null))
            .OrderBy(b => b.PrimaryTitle).Select(b => new { b.Id, b.PrimaryTitle, Type = b.ContentType.Name })
            .ToListAsync(ct);
        var ids = books.Select(b => b.Id).ToList();
        var files = await context.BookFiles.AsNoTracking().Where(f =>
                f.OwnerId == user.RequiredId && ids.Contains(f.BookId) && f.DeletedAtUtc == null)
            .OrderBy(f => f.SortOrder).ThenBy(f => f.Id).ToListAsync(ct);
        var filesByBook = files.ToLookup(f => f.BookId);
        return books.Select(b => new BookFileExportCandidateDto(b.Id, b.PrimaryTitle, b.Type,
            filesByBook[b.Id].Select(f => ToDto(f, false, b.PrimaryTitle)).ToList())).ToList();
    }

    private async Task<Book> OwnedBookAsync(Guid id, Guid ownerId, CancellationToken ct)
    {
        return await context.Books.Include(b => b.ContentType)
                   .SingleOrDefaultAsync(b => b.Id == id && b.OwnerId == ownerId, ct)
               ?? throw new EntityNotFoundException<Book, Guid>(id);
    }

    private async Task<BookFile> OwnedFileAsync(Guid bookId, Guid fileId, CancellationToken ct)
    {
        await OwnedBookAsync(bookId, user.RequiredId, ct);
        return await context.BookFiles.SingleOrDefaultAsync(
                   f => f.Id == fileId && f.BookId == bookId && f.OwnerId == user.RequiredId, ct)
               ?? throw new EntityNotFoundException<BookFile, Guid>(fileId);
    }

    private async Task<long> UsedBytesAsync(Guid ownerId, CancellationToken ct)
    {
        return await context.BookFiles.Where(f => f.OwnerId == ownerId).SumAsync(f => (long?)f.SizeBytes, ct) ?? 0;
    }

    internal static BookFileDto ToDto(BookFile f, bool shared, string bookTitle)
    {
        return new BookFileDto(f.Id, f.BookId, BookFileNames.DisplayTitle(f.Title, bookTitle), f.OriginalFileName,
            f.SortOrder, f.SizeBytes, f.Created, f.DeletedAtUtc, shared, f.FirstContentLabel, f.LastContentLabel);
    }

    private static string ValidateTitle(string title)
    {
        if (string.IsNullOrWhiteSpace(title) || title.Trim().Length > 250 || title.Any(char.IsControl))
        {
            throw new ValidationException("File title must contain 1–250 characters and no control characters.");
        }

        return title.Trim();
    }

    private async Task<IDbContextTransaction> LockAsync(Guid ownerId, CancellationToken ct, bool global = false)
    {
        var transaction = await context.Database.BeginTransactionAsync(ct);
        if (context.Database.IsNpgsql())
        {
            await context.Database.ExecuteSqlInterpolatedAsync(
                $"SELECT pg_advisory_xact_lock({(global ? 914732821L : BitConverter.ToInt64(ownerId.ToByteArray()))})",
                ct);
        }

        return transaction;
    }

    internal string JobPath(Guid id, string name = "")
    {
        var root = Path.GetFullPath(_options.StagingRoot);
        var directory = Path.Combine(root, id.ToString("N"));
        if (name.Length > 0 && (Path.GetFileName(name) != name || name.Any(char.IsControl)))
        {
            throw new ValidationException("Invalid staging path.");
        }

        return Path.Combine(directory, name);
    }

    internal static BookFileJobPayload Payload(BookFileJob job)
    {
        return JsonSerializer.Deserialize<BookFileJobPayload>(job.PayloadJson, JsonOptions)!;
    }

    private static void SetPayload(BookFileJob job, BookFileJobPayload payload)
    {
        job.PayloadJson = JsonSerializer.Serialize(payload, JsonOptions);
        job.UpdatedAtUtc = DateTime.UtcNow;
    }

    internal static BookFileJobDto JobDto(BookFileJob job)
    {
        if (WorkingStatuses.Contains(job.Status))
        {
            return new BookFileJobDto(job.Id, job.BookId, job.Kind, job.Status, job.ProcessedFiles, job.TotalFiles,
                job.ExpiresAtUtc,
                job.Error, [], [], job.ImportedCount, job.SkippedCount);
        }

        var p = Payload(job);
        return new BookFileJobDto(job.Id, job.BookId, job.Kind, job.Status, job.ProcessedFiles, job.TotalFiles,
            job.ExpiresAtUtc,
            job.Error,
            p.Entries.Select(e => new BookFileImportEntryDto(e.Id, e.BookId, e.BookTitle, e.ContentType, e.Title,
                e.FileName,
                e.SortOrder, e.SizeBytes, e.Error, e.Duplicate, e.FirstContentLabel, e.LastContentLabel)).ToList(),
            p.Warnings, job.ImportedCount, job.SkippedCount);
    }
}
