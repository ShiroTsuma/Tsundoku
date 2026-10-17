namespace Application.Common.Interfaces;

using DTOs.Book;

public interface IEpubCrawlerService
{
    Task<EpubSearchJob> SearchAsync(Guid bookId, EpubSearchRequest request, CancellationToken ct);
    Task<EpubSearchJob> GetSearchAsync(Guid id, CancellationToken ct);
    Task<EpubDownloadJob> DownloadAsync(Guid bookId, EpubDownloadRequest request, CancellationToken ct);
    Task<EpubDownloadJob> GetDownloadAsync(Guid id, CancellationToken ct);
    Task<IReadOnlyList<EpubDownloadJob>> ListDownloadsAsync(Guid bookId, CancellationToken ct);
    Task<IReadOnlyList<EpubDownloadJob>> ListOwnerDownloadsAsync(CancellationToken ct);
    Task<EpubDownloadJob> CancelAsync(Guid id, CancellationToken ct);
}
