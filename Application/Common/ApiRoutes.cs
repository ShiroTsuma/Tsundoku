namespace Application.Common;

public static class ApiRoutes
{
    public const string VersionPrefix = "api/v1";
    public const string Account = VersionPrefix + "/account";
    public const string Admin = VersionPrefix + "/admin";
    public const string AdminCrawler = Admin + "/crawler";
    public const string AdminMetadata = Admin + "/metadata";
    public const string Author = VersionPrefix + "/author";
    public const string Book = VersionPrefix + "/book";
    public const string PublicBook = VersionPrefix + "/public-book";
    public const string Genre = VersionPrefix + "/genre";
    public const string Status = VersionPrefix + "/status";
    public const string Tag = VersionPrefix + "/tag";
    public const string Type = VersionPrefix + "/type";

    public static string BookCoverFile(Guid bookId, long version)
    {
        return $"/{Book}/{bookId}/cover/file?v={version}";
    }

    public static string BookCoverThumbnail(Guid bookId, long version)
    {
        return $"/{Book}/{bookId}/cover/thumbnail?v={version}";
    }

    public static string PublicBookCover(Guid snapshotId, long version)
    {
        return $"/{PublicBook}/{snapshotId}/cover?v={version}";
    }

    public static string GenreById(Guid genreId)
    {
        return $"/{Genre}/{genreId}";
    }

    public static string StatusById(Guid statusId)
    {
        return $"/{Status}/{statusId}";
    }

    public static string TypeById(Guid typeId)
    {
        return $"/{Type}/{typeId}";
    }
}
