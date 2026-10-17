namespace Application.Common.Interfaces;

using DTOs.Book;

public interface ICrawlerMonitorService
{
    Task<CrawlerMonitorSnapshot> GetAsync(bool allAccounts, string filter, int skip, int take, CancellationToken ct);
}
