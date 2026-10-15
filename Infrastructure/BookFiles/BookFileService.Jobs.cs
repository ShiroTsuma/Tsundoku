namespace Infrastructure.BookFiles;

using System.IO.Compression;
using System.Text.Json;
using System.Xml;
using Application.Common.DTOs.Book;
using Archives;
using Services;

public sealed partial class BookFileService
{
    public async Task<BookFileJobDto> CreateImportAsync(Guid? bookId, IAsyncEnumerable<BookFileUpload> uploads,
        CancellationToken ct, long? requestBytes = null)
    {
        if (bookId.HasValue)
        {
            await OwnedBookAsync(bookId.Value, user.RequiredId, ct);
        }

        var maxUpload = bookId.HasValue ? _options.MaxUploadBytes : _options.MaxLibraryArchiveBytes;
        var reservation = bookId.HasValue
            ? _options.MaxUploadBytes + _options.MaxExtractedBytes
            : Math.Min(requestBytes ?? maxUpload, maxUpload) + _options.MaxLibraryArchiveBytes;
        var job = await ReserveJobAsync(bookId.HasValue ? "BookImport" : "LibraryImport", bookId, reservation, ct);
        var payload = new BookFileJobPayload();
        var budget = new ArchiveReadBudget(maxUpload);
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(_options.ProcessingTimeout);
        try
        {
            await foreach (var upload in uploads.WithCancellation(timeout.Token))
            {
                var extension = Path.GetExtension(upload.FileName).ToLowerInvariant();
                if (payload.Uploads.Count >= _options.MaxFilesPerImport ||
                    extension is not (".zip" or ".epub") || upload.FileName.Any(char.IsControl) ||
                    upload.FileName.Length > 250)
                {
                    throw new ValidationException(
                        "Choose EPUB or ZIP files with safe names, within the file count limit.");
                }

                if (!bookId.HasValue && (extension != ".zip" || payload.Uploads.Count > 0))
                {
                    throw new ValidationException("EPUB archive import accepts exactly one exported ZIP archive.");
                }

                var name = $"upload-{payload.Uploads.Count:D5}{extension}";
                await using (var target = new FileStream(JobPath(job.Id, name), FileMode.CreateNew, FileAccess.Write,
                                 FileShare.None, 65536, true))
                {
                    await ArchiveSafety.CopyAsync(upload.Content, target,
                        extension == ".epub" ? _options.MaxFileBytes : maxUpload,
                        null, budget, timeout.Token);
                }

                payload.Uploads.Add(new StagedUpload(name, Path.GetFileName(upload.FileName)));
            }

            if (payload.Uploads.Count == 0)
            {
                throw new ValidationException("Choose at least one EPUB or ZIP file.");
            }

            job.Status = "Queued";
            SetPayload(job, payload);
            await context.SaveChangesAsync(ct);
            return JobDto(job);
        }
        catch (Exception exception)
        {
            job.Status = "Failed";
            job.Error = "Upload did not complete. Choose the files and try again.";
            job.ReservedBytes = 0;
            await context.SaveChangesAsync(CancellationToken.None);
            DeleteJobDirectory(job.Id);
            if (exception is InvalidDataException)
            {
                throw new ValidationException("Invalid or oversized multipart upload.");
            }

            throw;
        }
    }

    public async Task<BookFileJobDto> GetJobAsync(Guid id, CancellationToken ct)
    {
        return JobDto(await OwnedJobAsync(id, ct));
    }

    public async Task<IReadOnlyList<BookFileJobDto>> ListJobsAsync(CancellationToken ct)
    {
        return (await context.BookFileJobs.AsNoTracking()
            .Where(j => j.OwnerId == user.RequiredId && j.ExpiresAtUtc > DateTime.UtcNow)
            .OrderByDescending(j => j.CreatedAtUtc).Take(20).Select(j => new BookFileJob
            {
                Id = j.Id,
                BookId = j.BookId,
                Kind = j.Kind,
                Status = j.Status,
                OwnerId = j.OwnerId,
                ProcessedFiles = j.ProcessedFiles,
                TotalFiles = j.TotalFiles,
                ImportedCount = j.ImportedCount,
                SkippedCount = j.SkippedCount,
                ExpiresAtUtc = j.ExpiresAtUtc,
                Error = j.Error,
                PayloadJson = "{}"
            }).ToListAsync(ct)).Select(JobDto).ToList();
    }

    public async Task CancelAsync(Guid id, CancellationToken ct)
    {
        await using var transaction = await LockAsync(Guid.Empty, ct, true);
        var job = await OwnedJobAsync(id, ct);
        await context.Entry(job).ReloadAsync(ct);
        if (TerminalStatuses.Contains(job.Status))
        {
            return;
        }

        var idle = job.Status is "Ready" or "Queued" or "CommitQueued";
        var now = DateTime.UtcNow;
        // Keep the reservation until the worker observes cancellation; do not remove an open file.
        var changed = await context.BookFileJobs.Where(j => j.Id == id && !TerminalStatuses.Contains(j.Status))
            .ExecuteUpdateAsync(s => s.SetProperty(j => j.Status, "Cancelled").SetProperty(j => j.UpdatedAtUtc, now),
                ct);
        await transaction.CommitAsync(ct);
        context.Entry(job).State = EntityState.Detached;
        if (changed == 0)
        {
            return;
        }

        if (idle)
        {
            try
            {
                DeleteJobDirectory(job.Id);
                await context.BookFileJobs.Where(j => j.Id == id && j.Status == "Cancelled")
                    .ExecuteUpdateAsync(s => s.SetProperty(j => j.ReservedBytes, 0L), ct);
            }
            catch (IOException)
            {
                /* An open download may hold the archive; maintenance retries cleanup. */
            }
        }
    }

    public async Task<BookFileJobDto> FinalizeAsync(Guid id, IReadOnlyList<BookFileImportSelection> selection,
        CancellationToken ct)
    {
        var job = await OwnedJobAsync(id, ct);
        if (job.Status is "CommitQueued" or "Committing" or "Completed")
        {
            return JobDto(job);
        }

        if (job.Kind is "Export" or "LibraryExport" || job.Status != "Ready")
        {
            throw new ValidationException("The import is not ready to confirm.");
        }

        var payload = Payload(job);
        var entryMap = payload.Entries.ToDictionary(e => e.Id);
        if (selection.Count == 0 || selection.Count > payload.Entries.Count ||
            selection.Select(e => e.EntryId).Distinct().Count() != selection.Count)
        {
            throw new ValidationException("Choose valid EPUB entries to import.");
        }

        var targetIds = selection.Select(e => e.BookId).Distinct().ToArray();
        if (await context.Books.CountAsync(b => targetIds.Contains(b.Id) && b.OwnerId == user.RequiredId, ct) !=
            targetIds.Length)
        {
            throw new ValidationException("Every EPUB must be assigned to a book in your library.");
        }

        foreach (var entry in selection)
        {
            entryMap.TryGetValue(entry.EntryId, out var staged);
            if (staged == null || staged.Error != null || (job.BookId.HasValue && entry.BookId != job.BookId) ||
                entry.SortOrder is < 0 or > 1_000_000)
            {
                throw new ValidationException("The import selection is invalid.");
            }

            _ = ValidateTitle(entry.Title);
        }

        var existing = await context.BookFiles.AsNoTracking().Where(f =>
                f.OwnerId == user.RequiredId && targetIds.Contains(f.BookId) && f.DeletedAtUtc == null)
            .Select(f => new { f.BookId, f.Sha256 }).ToListAsync(ct);
        var seen = existing.Select(f => (f.BookId, f.Sha256)).ToHashSet();
        var selectedBytes = selection.Where(s => seen.Add((s.BookId, entryMap[s.EntryId].Sha256)))
            .Sum(s => entryMap[s.EntryId].SizeBytes);
        if (selectedBytes > _options.MaxOwnerStorageBytes - await UsedBytesAsync(user.RequiredId, ct))
        {
            throw new ValidationException("The selected EPUBs exceed your storage limit, including the trash.");
        }

        payload.Selection = selection.ToList();
        job.TotalFiles = selection.Count;
        job.ProcessedFiles = 0;
        job.Status = "CommitQueued";
        SetPayload(job, payload);
        await context.SaveChangesAsync(ct);
        return JobDto(job);
    }

    private async Task<BookFileJob> ReserveJobAsync(string kind, Guid? bookId, long bytes, CancellationToken ct)
    {
        await abuseGuard.ThrowIfBlockedAsync(user, ct);
        await using var transaction = await LockAsync(user.RequiredId, ct, true);
        var now = DateTime.UtcNow;
        var active = context.BookFileJobs.Where(j => j.ExpiresAtUtc > now && !TerminalStatuses.Contains(j.Status));
        if (await active.CountAsync(j => j.OwnerId == user.RequiredId, ct) >= _options.MaxActiveJobsPerOwner)
        {
            throw new ImportCapacityExceededException("Finish or cancel an existing EPUB operation first.");
        }

        if (kind is not ("Export" or "LibraryExport") &&
            await active.AnyAsync(j => j.OwnerId == user.RequiredId && j.Kind != "Export" && j.Kind != "LibraryExport",
                ct))
        {
            throw new ImportCapacityExceededException(
                "You already have an active EPUB import. Finish or cancel it first.");
        }

        var reserved = await context.BookFileJobs.SumAsync(j => (long?)j.ReservedBytes, ct) ?? 0;
        if (bytes > _options.MaxStagingBytes - reserved)
        {
            throw new ImportCapacityExceededException(
                "The server's EPUB staging capacity is currently full. Try again later.");
        }

        var job = new BookFileJob
        {
            OwnerId = user.RequiredId,
            BookId = bookId,
            Kind = kind,
            ReservedBytes = bytes,
            CreatedAtUtc = now,
            UpdatedAtUtc = now,
            ExpiresAtUtc = now + _options.JobLifetime
        };
        context.BookFileJobs.Add(job);
        await context.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
        Directory.CreateDirectory(JobPath(job.Id));
        return job;
    }

    private async Task<BookFileJob> OwnedJobAsync(Guid id, CancellationToken ct)
    {
        var job = await context.BookFileJobs.SingleOrDefaultAsync(j => j.Id == id && j.OwnerId == user.RequiredId, ct)
                  ?? throw new EntityNotFoundException<BookFileJob, Guid>(id);
        if (job.ExpiresAtUtc <= DateTime.UtcNow)
        {
            throw new ValidationException("This EPUB operation expired. Start a new one.");
        }

        return job;
    }

    internal async Task<bool> ProcessNextAsync(CancellationToken ct)
    {
        var job = await ClaimNextAsync(ct);
        if (job == null)
        {
            return false;
        }

        var committing = job.Status == "Committing";
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(_options.ProcessingTimeout);
        var payload = Payload(job);
        try
        {
            await CheckAccountAsync(job.OwnerId, timeout.Token);
            if (committing)
            {
                await CommitImportAsync(job, payload, timeout.Token);
            }
            else if (job.Kind is "Export" or "LibraryExport")
            {
                await BuildExportAsync(job, payload, timeout.Token);
            }
            else
            {
                await InspectImportAsync(job, payload, timeout.Token);
            }

            job.Status = committing ? "Completed" : "Ready";
            if (committing)
            {
                job.ReservedBytes = 0;
                DeleteJobDirectory(job.Id);
            }

            SetPayload(job, payload);
            await context.SaveChangesAsync(ct);
            BookFileTelemetry.Operations.Add(1, new KeyValuePair<string, object?>("kind", job.Kind),
                new KeyValuePair<string, object?>("result", "success"));
        }
        catch (Exception exception)
        {
            context.ChangeTracker.Clear();
            var current = await context.BookFileJobs.SingleOrDefaultAsync(j => j.Id == job.Id, CancellationToken.None);
            if (current != null && current.Status != "Cancelled")
            {
                current.Status = "Failed";
                current.Error = exception is OperationCanceledException
                    ? "Processing was interrupted or timed out. Retry the operation."
                    : exception is ValidationException or InvalidDataException or JsonException or XmlException
                        ? exception.Message[..Math.Min(exception.Message.Length, 1000)]
                        : "Could not process EPUB files. Retry the operation.";
                current.UpdatedAtUtc = DateTime.UtcNow;
                current.ReservedBytes = 0;
                await context.SaveChangesAsync(CancellationToken.None);
            }

            if (exception is SuspiciousBookImportException suspicious)
            {
                var actor = await ActorAsync(job.OwnerId, CancellationToken.None);
                await abuseGuard.BlockAsync(actor, suspicious.ReasonCode, CancellationToken.None);
            }

            DeleteJobDirectory(job.Id);
            if (current is { Status: "Cancelled" })
            {
                current.ReservedBytes = 0;
                await context.SaveChangesAsync(CancellationToken.None);
            }

            BookFileTelemetry.Operations.Add(1, new KeyValuePair<string, object?>("kind", job.Kind),
                new KeyValuePair<string, object?>("result", "failure"));
        }

        return true;
    }

    private async Task<BookFileJob?> ClaimNextAsync(CancellationToken ct)
    {
        await using var transaction = await LockAsync(Guid.Empty, ct, true);
        var now = DateTime.UtcNow;
        if (await context.BookFileJobs.CountAsync(
                j => (j.Status == "Processing" || j.Status == "Committing") && j.ExpiresAtUtc > now, ct) >=
            _options.MaxConcurrentOperations)
        {
            return null;
        }

        var job = await context.BookFileJobs
            .Where(j => (j.Status == "Queued" || j.Status == "CommitQueued") && j.ExpiresAtUtc > now)
            .OrderBy(j => j.CreatedAtUtc).FirstOrDefaultAsync(ct);
        if (job == null)
        {
            return null;
        }

        job.Status = job.Status == "CommitQueued" ? "Committing" : "Processing";
        job.UpdatedAtUtc = now;
        try
        {
            await context.SaveChangesAsync(ct);
            await transaction.CommitAsync(ct);
        }
        catch (DbUpdateConcurrencyException)
        {
            context.ChangeTracker.Clear();
            return null;
        }

        return job;
    }

    private async Task InspectImportAsync(BookFileJob job, BookFileJobPayload payload, CancellationToken ct)
    {
        var state = new ImportInspectionState();
        var outerBudget = new ArchiveReadBudget(job.Kind == "LibraryImport"
            ? _options.MaxLibraryArchiveBytes
            : _options.MaxExtractedBytes);
        var epubBudget = new ArchiveReadBudget(_options.MaxExpandedEpubBytes);
        foreach (var upload in payload.Uploads)
        {
            if (Path.GetExtension(upload.Path) == ".epub")
            {
                await InspectEpubAsync(job, payload, JobPath(job.Id, upload.Path), upload.FileName, null, epubBudget,
                    state, ct);
                continue;
            }

            await using var archiveStream = File.OpenRead(JobPath(job.Id, upload.Path));
            using var archive = new ZipArchive(archiveStream, ZipArchiveMode.Read, true);
            var library = job.Kind == "LibraryImport";
            var entries = ArchiveSafety.Validate(archive, _security,
                library ? _options.MaxLibraryArchiveBytes : _options.MaxExtractedBytes,
                library ? _options.MaxLibraryArchiveEntries : _options.MaxArchiveEntries, true);
            Dictionary<string, (BookFileManifestBook Book, BookFileManifestEntry File)>? manifestEntries = null;
            if (library)
            {
                if (!entries.TryGetValue("manifest.json", out var manifestEntry))
                {
                    throw new ValidationException(
                        "This ZIP has no EPUB export manifest. Import ordinary ZIP files from a book's details.");
                }

                using var json = new MemoryStream();
                await using (var content = manifestEntry.Open())
                {
                    await ArchiveSafety.CopyAsync(content, json, 8 * 1024 * 1024, manifestEntry.Length, outerBudget,
                        ct);
                }

                var manifest = JsonSerializer.Deserialize<BookFileManifest>(json.ToArray(), JsonOptions);
                if (manifest == null || manifest.Format != "tsundoku-epubs" || manifest.Version != 1 ||
                    manifest.Books == null || manifest.Books.Count > _options.MaxLibraryArchiveEntries)
                {
                    throw new ValidationException("Unsupported EPUB archive manifest.");
                }

                manifestEntries =
                    new Dictionary<string, (BookFileManifestBook Book, BookFileManifestEntry File)>(StringComparer
                        .OrdinalIgnoreCase);
                foreach (var book in manifest.Books)
                {
                    if (book.Files == null || string.IsNullOrWhiteSpace(book.PrimaryTitle) ||
                        string.IsNullOrWhiteSpace(book.ContentType))
                    {
                        throw new ValidationException("Invalid book in EPUB archive manifest.");
                    }

                    foreach (var file in book.Files)
                    {
                        if (file.Path == null || ArchiveSafety.IsTraversal(file.Path))
                        {
                            throw new SuspiciousBookImportException("manifest-path-traversal",
                                "EPUB manifest contains a path traversal attempt.");
                        }

                        if (!ArchiveSafety.IsSafeName(file.Path) ||
                            !file.Path.EndsWith(".epub", StringComparison.OrdinalIgnoreCase) ||
                            !entries.TryGetValue(file.Path, out var entry) || file.SizeBytes != entry.Length ||
                            file.Sha256 == null || file.Sha256.Length != 64 ||
                            !manifestEntries.TryAdd(file.Path, (book, file)))
                        {
                            throw new ValidationException(
                                "EPUB manifest references an invalid, missing or duplicate file.");
                        }
                    }
                }

                if (entries.Values.Any(e =>
                        !e.FullName.EndsWith('/') && e.FullName != "manifest.json" &&
                        !manifestEntries.ContainsKey(e.FullName)))
                {
                    throw new ValidationException("EPUB archive contains files not listed in its manifest.");
                }
            }

            var epubs = entries.Values.Where(e => e.FullName.EndsWith(".epub", StringComparison.OrdinalIgnoreCase))
                .OrderBy(e => e.FullName, NaturalNameComparer.Instance).ToList();
            job.TotalFiles += epubs.Count;
            var ignored = entries.Values.Count(e =>
                !e.FullName.EndsWith('/') && !e.FullName.EndsWith(".epub", StringComparison.OrdinalIgnoreCase));
            if (!library && ignored > 0)
            {
                payload.Warnings.Add(
                    $"{upload.FileName}: ignored {ignored} non-EPUB files; nested ZIP archives are not extracted.");
            }

            foreach (var entry in epubs)
            {
                if (!library && payload.Entries.Count >= _options.MaxFilesPerImport)
                {
                    throw new ValidationException("ZIP contains too many EPUB files.");
                }

                await EnsureRunningAsync(job, ct);
                var name = $"epub-{Guid.NewGuid():N}.epub";
                if (entry.Length <= 0 || entry.Length > _options.MaxFileBytes)
                {
                    payload.Entries.Add(new StagedEpub
                    {
                        FileName = Path.GetFileName(entry.FullName),
                        Title = Path.GetFileNameWithoutExtension(entry.FullName),
                        Error = "EPUB exceeds the file size limit or is empty."
                    });
                    continue;
                }

                await using (var content = entry.Open())
                await using (var target = File.Create(JobPath(job.Id, name)))
                {
                    await ArchiveSafety.CopyAsync(content, target, _options.MaxFileBytes, entry.Length, outerBudget,
                        ct);
                }

                await InspectEpubAsync(job, payload, JobPath(job.Id, name), Path.GetFileName(entry.FullName),
                    manifestEntries?.GetValueOrDefault(entry.FullName),
                    library ? new ArchiveReadBudget(_options.MaxExpandedEpubBytes) : epubBudget, state, ct);
            }
        }

        if (payload.Entries.Count == 0)
        {
            throw new ValidationException("No EPUB files were found.");
        }

        job.TotalFiles = payload.Entries.Count;
    }

    private async Task InspectEpubAsync(BookFileJob job, BookFileJobPayload payload, string path, string fileName,
        (BookFileManifestBook Book, BookFileManifestEntry File)? manifest, ArchiveReadBudget budget,
        ImportInspectionState state, CancellationToken ct)
    {
        if (job.Kind == "BookImport" && payload.Entries.Count >= _options.MaxFilesPerImport)
        {
            throw new ValidationException("Too many EPUB files.");
        }

        var entry = new StagedEpub
        {
            FileName = fileName,
            Title = Path.GetFileNameWithoutExtension(fileName),
            Path = Path.GetFileName(path),
            SizeBytes = new FileInfo(path).Length,
            SortOrder = payload.Entries.Count,
            BookId = job.BookId
        };
        payload.Entries.Add(entry);
        try
        {
            var validation = await EpubValidator.ValidateAsync(path, _options, _security, budget, ct);
            entry.FirstContentLabel = validation.First;
            entry.LastContentLabel = validation.Last;
            entry.Title = ValidateTitle(manifest?.File.Title ?? validation.Title ?? entry.Title);
            entry.Sha256 = validation.Sha256;
            if (manifest.HasValue)
            {
                if (!string.Equals(entry.Sha256, manifest.Value.File.Sha256, StringComparison.OrdinalIgnoreCase))
                {
                    throw new ValidationException("EPUB checksum does not match the manifest.");
                }

                entry.SortOrder = manifest.Value.File.SortOrder;
                entry.FileName = manifest.Value.File.OriginalFileName;
                if (string.IsNullOrWhiteSpace(entry.FileName) || entry.FileName.Length > 250 ||
                    entry.FileName.Any(char.IsControl))
                {
                    throw new ValidationException("Invalid EPUB filename in manifest.");
                }

                entry.BookTitle = manifest.Value.Book.PrimaryTitle;
                entry.ContentType = manifest.Value.Book.ContentType;
                var normalized = MappingExtensions.NormalizeName(entry.BookTitle);
                var key = (manifest.Value.Book.SourceBookId, normalized, entry.ContentType);
                if (!state.BookMatches.TryGetValue(key, out var matched))
                {
                    matched = await context.Books.Where(b => b.OwnerId == job.OwnerId && b.Id == key.Item1)
                        .Select(b => (Guid?)b.Id).SingleOrDefaultAsync(ct);
                    if (!matched.HasValue)
                    {
                        var matches = await context.Books.Where(b =>
                                b.OwnerId == job.OwnerId && b.NormalizedPrimaryTitle == normalized &&
                                b.ContentType.Name == entry.ContentType)
                            .Select(b => b.Id).Take(2).ToListAsync(ct);
                        matched = matches.Count == 1 ? matches[0] : null;
                    }

                    state.BookMatches[key] = matched;
                }

                entry.BookId = matched;
            }
            else if (job.BookId.HasValue)
            {
                var book = await OwnedBookAsync(job.BookId.Value, job.OwnerId, ct);
                entry.BookTitle = book.PrimaryTitle;
                entry.ContentType = book.ContentType.Name;
            }

            if (entry.BookId.HasValue)
            {
                var target = entry.BookId.Value;
                if (!state.ExistingHashes.TryGetValue(target, out var hashes))
                {
                    hashes = (await context.BookFiles.Where(f =>
                            f.BookId == target && f.OwnerId == job.OwnerId && f.DeletedAtUtc == null)
                        .Select(f => f.Sha256).ToListAsync(ct)).ToHashSet();
                    state.ExistingHashes[target] = hashes;
                }

                entry.Duplicate = hashes.Contains(entry.Sha256) || !state.Seen.Add((target, entry.Sha256));
            }
        }
        catch (Exception exception) when (exception is InvalidDataException or ValidationException or XmlException
                                              or JsonException)
        {
            entry.Error = exception.Message[..Math.Min(exception.Message.Length, 500)];
        }

        job.ProcessedFiles = payload.Entries.Count;
        if (payload.Entries.Count % 25 == 0)
        {
            SetPayload(job, payload);
            await context.SaveChangesAsync(ct);
        }
    }

    private async Task CommitImportAsync(BookFileJob job, BookFileJobPayload payload, CancellationToken ct)
    {
        var entries = payload.Entries.ToDictionary(e => e.Id);
        foreach (var group in payload.Selection.GroupBy(s => s.BookId))
        {
            var nextOrder = (await context.BookFiles.Where(f => f.BookId == group.Key && f.DeletedAtUtc == null)
                .MaxAsync(f => (int?)f.SortOrder, ct) ?? -1) + 1;
            foreach (var selection in group.OrderBy(s => s.SortOrder))
            {
                await EnsureRunningAsync(job, ct);
                await OwnedBookAsync(selection.BookId, job.OwnerId, ct);
                var entry = entries[selection.EntryId];
                if (entry.Committed)
                {
                    continue;
                }

                var duplicate = await context.BookFiles.AnyAsync(
                    f => f.OwnerId == job.OwnerId && f.BookId == selection.BookId && f.Sha256 == entry.Sha256 &&
                         f.DeletedAtUtc == null, ct);
                if (duplicate)
                {
                    job.SkippedCount++;
                    entry.Committed = true;
                }
                else
                {
                    var fileId = Guid.NewGuid();
                    var key = $"epubs/{job.OwnerId:N}/{fileId:N}.epub";
                    // Durable compensation is created before writing the external object.
                    await cleanup.EnqueueBookFilesAsync([key], DateTime.UtcNow + _options.JobLifetime, ct);
                    await using (var input = File.OpenRead(JobPath(job.Id, entry.Path)))
                    {
                        await storage.SaveAsync(key, input, ct);
                    }

                    await using var transaction = await LockAsync(job.OwnerId, ct);
                    await OwnedBookAsync(selection.BookId, job.OwnerId, ct);
                    if (entry.SizeBytes > _options.MaxOwnerStorageBytes - await UsedBytesAsync(job.OwnerId, ct))
                    {
                        throw new ValidationException(
                            "Your storage limit was reached while importing. Already imported EPUBs are preserved.");
                    }

                    context.BookFiles.Add(new BookFile
                    {
                        Id = fileId,
                        BookId = selection.BookId,
                        OwnerId = job.OwnerId,
                        StoragePath = key,
                        Title = ValidateTitle(selection.Title),
                        OriginalFileName = entry.FileName,
                        SizeBytes = entry.SizeBytes,
                        Sha256 = entry.Sha256,
                        SortOrder = nextOrder++,
                        FirstContentLabel = entry.FirstContentLabel,
                        LastContentLabel = entry.LastContentLabel
                    });
                    entry.Committed = true;
                    job.ImportedCount++;
                    job.ProcessedFiles++;
                    job.UpdatedAtUtc = DateTime.UtcNow;
                    await context.StorageCleanupQueueItems
                        .Where(q => q.StorageKind == "BookFile" && q.StoragePath == key).ExecuteDeleteAsync(ct);
                    await context.SaveChangesAsync(ct);
                    await transaction.CommitAsync(ct);
                    continue;
                }

                job.ProcessedFiles++;
                job.UpdatedAtUtc = DateTime.UtcNow;
                await context.SaveChangesAsync(ct);
            }
        }
    }

    private async Task EnsureRunningAsync(BookFileJob job, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        var state = await context.BookFileJobs.AsNoTracking().Where(j => j.Id == job.Id)
            .Select(j => new { j.Status, j.ExpiresAtUtc }).SingleAsync(ct);
        if (state.Status == "Cancelled" || state.ExpiresAtUtc <= DateTime.UtcNow)
        {
            throw new OperationCanceledException("EPUB operation was cancelled.");
        }
    }

    internal void DeleteJobDirectory(Guid id)
    {
        var directory = JobPath(id);
        if (Directory.Exists(directory))
        {
            Directory.Delete(directory, true);
        }
    }

    private sealed class ImportInspectionState
    {
        public Dictionary<(Guid, string, string), Guid?> BookMatches { get; } = new();
        public Dictionary<Guid, HashSet<string>> ExistingHashes { get; } = new();
        public HashSet<(Guid, string)> Seen { get; } = new();
    }
}

internal sealed class NaturalNameComparer : IComparer<string>
{
    public static readonly NaturalNameComparer Instance = new();

    public int Compare(string? x, string? y)
    {
        x ??= "";
        y ??= "";
        var a = 0;
        var b = 0;
        while (a < x.Length && b < y.Length)
        {
            if (char.IsAsciiDigit(x[a]) && char.IsAsciiDigit(y[b]))
            {
                var ax = a;
                var by = b;
                while (a < x.Length && char.IsAsciiDigit(x[a]))
                {
                    a++;
                }

                while (b < y.Length && char.IsAsciiDigit(y[b]))
                {
                    b++;
                }

                var xs = x[ax..a].TrimStart('0');
                var ys = y[by..b].TrimStart('0');
                var result = xs.Length.CompareTo(ys.Length);
                if (result == 0)
                {
                    result = string.Compare(xs, ys, StringComparison.Ordinal);
                }

                if (result != 0)
                {
                    return result;
                }
            }
            else
            {
                var result = char.ToUpperInvariant(x[a++]).CompareTo(char.ToUpperInvariant(y[b++]));
                if (result != 0)
                {
                    return result;
                }
            }
        }

        return x.Length.CompareTo(y.Length);
    }
}
