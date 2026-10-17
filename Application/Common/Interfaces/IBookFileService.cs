namespace Application.Common.Interfaces;

using DTOs.Book;

public interface IBookFileService
{
    public BookFileLimitsDto Limits();
    public Task<BookFileListDto> ListAsync(Guid bookId, CancellationToken ct);
    public Task<IReadOnlyList<BookFileDto>> ListPublicAsync(Guid snapshotId, CancellationToken ct);
    public Task UpdateAsync(Guid bookId, Guid fileId, string title, CancellationToken ct);
    public Task ReorderAsync(Guid bookId, IReadOnlyList<Guid> ids, CancellationToken ct);
    public Task DeleteAsync(Guid bookId, Guid fileId, CancellationToken ct);
    public Task RestoreAsync(Guid bookId, Guid fileId, CancellationToken ct);
    public Task ShareAsync(Guid bookId, IReadOnlyList<Guid> ids, CancellationToken ct);
    public Task QueueDeletedBookFilesAsync(Guid ownerId, Guid? bookId, CancellationToken ct);

    public Task<T> ExecuteBookDeletionAsync<T>(Guid ownerId, Guid? bookId, Func<CancellationToken, Task<T>> deletion,
        CancellationToken ct);

    public Task<BookFileJobDto> CreateImportAsync(Guid? bookId, IAsyncEnumerable<BookFileUpload> uploads,
        CancellationToken ct,
        long? requestBytes = null, Guid? operationId = null);

    public Task<BookFileJobDto> GetJobAsync(Guid id, CancellationToken ct);
    public Task<IReadOnlyList<BookFileJobDto>> ListJobsAsync(CancellationToken ct);

    public Task<BookFileJobDto> FinalizeAsync(Guid id, IReadOnlyList<BookFileImportSelection> selection,
        CancellationToken ct);

    public Task CancelAsync(Guid id, CancellationToken ct);
    public Task<IReadOnlyList<BookFileExportCandidateDto>> ExportCandidatesAsync(string? query, CancellationToken ct);

    public Task<BookFileJobDto> CreateExportAsync(IReadOnlyList<Guid> fileIds, Guid? snapshotId, bool includeManifest,
        CancellationToken ct);

    public Task<IReadOnlyList<BookFileDownloadDto>> CreateDownloadsAsync(IReadOnlyList<Guid> fileIds, Guid? snapshotId,
        CancellationToken ct);

    public Task<BookFileDownloadDto> CreateJobDownloadAsync(Guid jobId, CancellationToken ct);
    public Task<BookFileDownloadResult> ConsumeDownloadAsync(Guid id, string token, CancellationToken ct);
}

public interface IBookFileStorage
{
    public Task SaveAsync(string path, Stream content, CancellationToken ct);
    public Task<Stream> OpenReadAsync(string path, CancellationToken ct);
    public Task DeleteIfExistsAsync(string path, CancellationToken ct);
}
