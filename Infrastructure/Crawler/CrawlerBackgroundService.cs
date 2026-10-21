namespace Infrastructure.Crawler;

using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

public sealed class CrawlerBackgroundService(IServiceScopeFactory scopes, IOptions<CrawlerOptions> options,
    ILogger<CrawlerBackgroundService> logger) : BackgroundService
{
    private const int MaxJobsPerPass = 50;

    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        if (!options.Value.Enabled || !options.Value.RunJobs) return;
        var maintenanceAt = DateTime.MinValue;
        while (!ct.IsCancellationRequested)
        {
            try
            {
                using var scope = scopes.CreateScope();
                var remote = scope.ServiceProvider.GetRequiredService<ICrawlerClient>();
                if (!(await remote.ProcessingAsync(ct)).ProcessingEnabled)
                {
                    await Task.Delay(TimeSpan.FromSeconds(2), ct);
                    continue;
                }
                // Drain due jobs before waiting; a scope per job keeps each DbContext small.
                for (var admitted = 0; admitted < MaxJobsPerPass; admitted++)
                {
                    using var jobScope = scopes.CreateScope();
                    if (!await jobScope.ServiceProvider.GetRequiredService<CrawlerWorker>().TickAsync(ct)) break;
                }
                if (DateTime.UtcNow >= maintenanceAt)
                {
                    await scope.ServiceProvider.GetRequiredService<CrawlerWorker>().MaintainAsync(ct);
                    maintenanceAt = DateTime.UtcNow.AddSeconds(30);
                }
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested) { break; }
            catch (Exception ex) { logger.LogError(ex, "Crawler worker iteration failed; will retry."); }
            try { await Task.Delay(TimeSpan.FromSeconds(2), ct); }
            catch (OperationCanceledException) { break; }
        }
    }
}
