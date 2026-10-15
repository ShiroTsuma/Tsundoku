namespace Infrastructure.BookFiles;

using System.Diagnostics.Metrics;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

public static class BookFileTelemetry
{
    public static readonly Meter Meter = new("Tsundoku.BookFiles");
    public static readonly Counter<long> Operations = Meter.CreateCounter<long>("tsundoku.epub.operations");
    public static readonly Histogram<long> StagingBytes = Meter.CreateHistogram<long>("tsundoku.epub.staging.bytes");
}

public sealed class BookFileBackgroundService(
    IServiceScopeFactory scopes,
    IOptions<BookFileOptions> options,
    ILogger<BookFileBackgroundService> logger) : BackgroundService
{
    protected override Task ExecuteAsync(CancellationToken stoppingToken)
    {
        return Task.WhenAll(
            Enumerable.Range(0, options.Value.MaxConcurrentOperations).Select(_ => WorkerAsync(stoppingToken))
                .Append(MaintenanceAsync(stoppingToken)));
    }

    private async Task WorkerAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            try
            {
                using var scope = scopes.CreateScope();
                if (await scope.ServiceProvider.GetRequiredService<BookFileService>().ProcessNextAsync(ct))
                {
                    continue;
                }
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                break;
            }
            catch (Exception e)
            {
                logger.LogError(e, "EPUB worker failed.");
            }

            try
            {
                await Task.Delay(TimeSpan.FromSeconds(2), ct);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }
    }

    private async Task MaintenanceAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            try
            {
                using var scope = scopes.CreateScope();
                var context = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
                var files = scope.ServiceProvider.GetRequiredService<BookFileService>();
                var now = DateTime.UtcNow;
                var stale = now - options.Value.ProcessingTimeout - TimeSpan.FromMinutes(1);
                var jobs = await context.BookFileJobs.Where(j => j.ExpiresAtUtc <= now ||
                                                                 ((j.Status == "Processing" ||
                                                                   j.Status == "Committing" ||
                                                                   j.Status == "Uploading") &&
                                                                  j.UpdatedAtUtc < stale) ||
                                                                 (j.Status == "Cancelled" &&
                                                                  j.UpdatedAtUtc < now.AddMinutes(-1)) ||
                                                                 j.Status == "Failed" || j.Status == "Completed")
                    .ToListAsync(ct);
                foreach (var job in jobs)
                {
                    if (job.ExpiresAtUtc <= now)
                    {
                        context.BookFileJobs.Remove(job);
                    }
                    else if (job.Status is "Processing" or "Committing" or "Uploading")
                    {
                        job.Status = "Failed";
                        job.Error =
                            "The EPUB operation was interrupted. Imported files are preserved; start a new import to continue.";
                    }

                    job.ReservedBytes = 0;
                    files.DeleteJobDirectory(job.Id);
                }

                await context.SaveChangesAsync(ct);
                await context.BookFileDownloadTickets.Where(t => t.ExpiresAtUtc <= now).ExecuteDeleteAsync(ct);
                var activeIds = await context.BookFileJobs.Select(j => j.Id.ToString("N")).ToListAsync(ct);
                var root = Path.GetFullPath(options.Value.StagingRoot);
                if (Directory.Exists(root))
                {
                    foreach (var directory in Directory.EnumerateDirectories(root))
                    {
                        // Generated UUID directories only, never follow external links or delete another tree.
                        var info = new DirectoryInfo(directory);
                        if (Guid.TryParseExact(info.Name, "N", out var id) && !activeIds.Contains(info.Name) &&
                            (info.Attributes & FileAttributes.ReparsePoint) == 0 &&
                            info.LastWriteTimeUtc < now.AddHours(-2))
                        {
                            files.DeleteJobDirectory(id);
                        }
                    }
                }

                BookFileTelemetry.StagingBytes.Record(
                    await context.BookFileJobs.SumAsync(j => (long?)j.ReservedBytes, ct) ?? 0);
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                break;
            }
            catch (Exception e)
            {
                logger.LogError(e, "EPUB maintenance failed.");
            }

            try
            {
                await Task.Delay(TimeSpan.FromSeconds(30), ct);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }
    }
}
