namespace Infrastructure.Crawler;

using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

public sealed class CrawlerBackgroundService(IServiceScopeFactory scopes, IOptions<CrawlerOptions> options,
    ILogger<CrawlerBackgroundService> logger) : BackgroundService
{
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
                var worker = scope.ServiceProvider.GetRequiredService<CrawlerWorker>();
                await worker.TickAsync(ct);
                if (DateTime.UtcNow >= maintenanceAt)
                {
                    await worker.MaintainAsync(ct);
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
