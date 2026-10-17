namespace Api.Controllers;

using Application.Common.DTOs.Book;
using Application.Common.Interfaces;
using Microsoft.AspNetCore.RateLimiting;

[ApiController]
[Authorize]
[Route(ApiRoutes.Book)]
public sealed class EpubCrawlerController(IEpubCrawlerService service) : ControllerBase
{
    [HttpPost("{bookId:guid}/epub-searches")]
    [EnableRateLimiting(DependencyInjection.ExpensiveUserActionRateLimitPolicy)]
    public async Task<IActionResult> Search(Guid bookId, EpubSearchRequest request, CancellationToken ct) =>
        Accepted(await service.SearchAsync(bookId, request, ct));

    [HttpGet("epub-searches/{id:guid}")]
    public async Task<IActionResult> SearchJob(Guid id, CancellationToken ct) =>
        Ok(await service.GetSearchAsync(id, ct));

    [HttpPost("{bookId:guid}/epub-downloads")]
    [EnableRateLimiting(DependencyInjection.ExpensiveUserActionRateLimitPolicy)]
    public async Task<IActionResult> Download(Guid bookId, EpubDownloadRequest request, CancellationToken ct) =>
        Accepted(await service.DownloadAsync(bookId, request, ct));

    [HttpGet("epub-downloads/{id:guid}")]
    public async Task<IActionResult> DownloadJob(Guid id, CancellationToken ct) =>
        Ok(await service.GetDownloadAsync(id, ct));

    [HttpGet("{bookId:guid}/epub-downloads")]
    public async Task<IActionResult> Downloads(Guid bookId, CancellationToken ct) =>
        Ok(await service.ListDownloadsAsync(bookId, ct));

    [HttpGet("epub-downloads")]
    public async Task<IActionResult> OwnerDownloads(CancellationToken ct) =>
        Ok(await service.ListOwnerDownloadsAsync(ct));

    [HttpPost("epub-downloads/{id:guid}/cancel")]
    public async Task<IActionResult> Cancel(Guid id, CancellationToken ct) =>
        Ok(await service.CancelAsync(id, ct));
}
