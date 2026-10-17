namespace Infrastructure.Crawler;

using Application.Common.DTOs.Book;

public sealed class CrawlerSourceAdminService(ICrawlerClient remote, IUser user) : ICrawlerSourceAdminService
{
    private void Admin()
    {
        if (!user.Roles.Contains(AuthorizationRoles.Admin)) throw new UnauthorizedAccessException();
    }

    public Task<CrawlerSourceHealthSnapshot> GetAsync(CancellationToken ct)
    {
        Admin();
        return remote.SourceHealthAsync(ct);
    }

    public Task<CrawlerProcessingState> ProcessingAsync(CancellationToken ct)
    {
        Admin();
        return remote.ProcessingAsync(ct);
    }

    public Task<CrawlerProcessingState> SetProcessingAsync(CrawlerProcessingState state, CancellationToken ct)
    {
        Admin();
        return remote.SetProcessingAsync(state, ct);
    }

    public Task UpdateAsync(string domain, CrawlerSourceSettings settings, CancellationToken ct)
    {
        Admin();
        if (Uri.CheckHostName(domain) != UriHostNameType.Dns || domain.Length > 253 || !CrawlerPlan.AllowedHost(domain))
            throw new ValidationException("Choose a supported crawler source.");
        return remote.UpdateSourceHealthAsync(domain, settings, ct);
    }
}
