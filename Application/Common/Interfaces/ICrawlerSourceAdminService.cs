namespace Application.Common.Interfaces;

using DTOs.Book;

public interface ICrawlerSourceAdminService
{
    Task<CrawlerSourceHealthSnapshot> GetAsync(CancellationToken ct);
    Task<CrawlerProcessingState> ProcessingAsync(CancellationToken ct);
    Task<CrawlerProcessingState> SetProcessingAsync(CrawlerProcessingState state, CancellationToken ct);
    Task UpdateAsync(string domain, CrawlerSourceSettings settings, CancellationToken ct);
}
