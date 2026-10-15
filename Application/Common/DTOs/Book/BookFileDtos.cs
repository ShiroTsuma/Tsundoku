namespace Application.Common.DTOs.Book;

public sealed record BookFileDto(
    Guid Id,
    Guid BookId,
    string Title,
    string OriginalFileName,
    int SortOrder,
    long SizeBytes,
    DateTimeOffset CreatedAt,
    DateTime? DeletedAtUtc,
    bool IsShared,
    string? FirstContentLabel = null,
    string? LastContentLabel = null);

public sealed record BookFileListDto(
    IReadOnlyList<BookFileDto> Files,
    Guid? SnapshotId,
    long UsedStorageBytes,
    long MaxStorageBytes,
    long MaxFileBytes,
    long MaxUploadBytes);

public sealed record BookFileImportEntryDto(
    Guid Id,
    Guid? BookId,
    string BookTitle,
    string ContentType,
    string Title,
    string OriginalFileName,
    int SortOrder,
    long SizeBytes,
    string? Error,
    bool IsDuplicate,
    string? FirstContentLabel = null,
    string? LastContentLabel = null);

public sealed record BookFileJobDto(
    Guid Id,
    Guid? BookId,
    string Kind,
    string Status,
    int ProcessedFiles,
    int TotalFiles,
    DateTime ExpiresAtUtc,
    string? Error,
    IReadOnlyList<BookFileImportEntryDto> Entries,
    IReadOnlyList<string> Warnings,
    int ImportedCount,
    int SkippedCount);

public sealed record BookFileImportSelection(Guid EntryId, Guid BookId, string Title, int SortOrder);

public sealed record BookFileDownloadDto(Guid FileId, string Title, string Url);

public sealed record BookFileExportCandidateDto(
    Guid BookId,
    string BookTitle,
    string ContentType,
    IReadOnlyList<BookFileDto> Files);

public sealed record BookFileDownloadResult(Stream Content, string MimeType, string FileName);

public sealed record BookFileUpload(Stream Content, string FileName);

public sealed record BookFileLimitsDto(
    long MaxFileBytes,
    long MaxUploadBytes,
    int MaxFilesPerImport,
    long MaxLibraryArchiveBytes,
    double RetentionDays);

public sealed record BookFileManifest
{
    public string Format { get; init; } = "tsundoku-epubs";
    public int Version { get; init; } = 1;
    public List<BookFileManifestBook> Books { get; init; } = [];
}

public sealed record BookFileManifestBook(
    Guid SourceBookId,
    string PrimaryTitle,
    string ContentType,
    List<BookFileManifestEntry> Files);

public sealed record BookFileManifestEntry(
    string Path,
    string Title,
    string OriginalFileName,
    int SortOrder,
    long SizeBytes,
    string Sha256);
