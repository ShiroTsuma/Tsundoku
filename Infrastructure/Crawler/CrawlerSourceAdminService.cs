namespace Infrastructure.Crawler;

using Application.Common.DTOs.Book;

// Admin-only: the controller's [Authorize(Roles = Admin)] guards every call, as in AdminController.
public sealed class CrawlerSourceAdminService(ICrawlerClient remote) : ICrawlerSourceAdminService
{
    public Task<CrawlerSourceHealthSnapshot> GetAsync(CancellationToken ct)
    {
        return remote.SourceHealthAsync(ct);
    }

    public Task<CrawlerProcessingState> ProcessingAsync(CancellationToken ct)
    {
        return remote.ProcessingAsync(ct);
    }

    public Task<CrawlerProcessingState> SetProcessingAsync(CrawlerProcessingState state, CancellationToken ct)
    {
        return remote.SetProcessingAsync(state, ct);
    }

    public Task UpdateAsync(string domain, CrawlerSourceSettings settings, CancellationToken ct)
    {
        if (Uri.CheckHostName(domain) != UriHostNameType.Dns || domain.Length > 253 || !CrawlerPlan.AllowedHost(domain))
            throw new ValidationException("Choose a supported crawler source.");
        return remote.UpdateSourceHealthAsync(domain, settings, ct);
    }
}
