namespace Infrastructure.BookCovers;

public sealed class BookCoverOptions
{
    public const string DefaultUserAgent = "Tsundoku/1.0";

    public string StorageRoot { get; set; } = "storage/covers";
    public long MaxBytes { get; set; } = 10 * 1024 * 1024;
    public int MaxWidth { get; set; } = 12_000;
    public int MaxHeight { get; set; } = 12_000;
    public long MaxPixels { get; set; } = 40_000_000;
    public string UserAgent { get; set; } = DefaultUserAgent;
    public BookCoverS3Options? S3 { get; set; }
}

public sealed class BookCoverS3Options
{
    public string? Endpoint { get; set; }
    public string? Region { get; set; }
    public string? AccessKey { get; set; }
    public string? SecretKey { get; set; }
    public string? Bucket { get; set; }
}
