namespace Api.Controllers;

using Application.Common.Interfaces;
using Application.Common.DTOs.Book;

[ApiController]
[Authorize]
public sealed class CrawlerMonitorController(ICrawlerMonitorService service) : ControllerBase
{
    [HttpGet(ApiRoutes.Book + "/crawler-status")]
    public async Task<IActionResult> Owner(CancellationToken ct) =>
        Ok(await service.GetAsync(false, "active", 0, 10, ct));

    [Authorize(Roles = AuthorizationRoles.Admin)]
    [HttpGet(ApiRoutes.Admin + "/crawler")]
    public async Task<IActionResult> Admin([FromQuery] string filter = "active", [FromQuery] int skip = 0,
        [FromQuery] int take = 20, CancellationToken ct = default) =>
        Ok(await service.GetAsync(true, filter, skip, take, ct));

    [Authorize(Roles = AuthorizationRoles.Admin)]
    [HttpGet(ApiRoutes.Admin + "/crawler/processing")]
    public async Task<IActionResult> Processing([FromServices] ICrawlerSourceAdminService sources, CancellationToken ct) =>
        Ok(await sources.ProcessingAsync(ct));

    [Authorize(Roles = AuthorizationRoles.Admin)]
    [HttpPut(ApiRoutes.Admin + "/crawler/processing")]
    public async Task<IActionResult> SetProcessing([FromBody] CrawlerProcessingState state,
        [FromServices] ICrawlerSourceAdminService sources, CancellationToken ct) =>
        Ok(await sources.SetProcessingAsync(state, ct));

    [Authorize(Roles = AuthorizationRoles.Admin)]
    [HttpGet(ApiRoutes.Admin + "/crawler/sources")]
    public async Task<IActionResult> Sources([FromServices] ICrawlerSourceAdminService sources, CancellationToken ct) =>
        Ok(await sources.GetAsync(ct));

    [Authorize(Roles = AuthorizationRoles.Admin)]
    [HttpPut(ApiRoutes.Admin + "/crawler/sources/{domain}")]
    public async Task<IActionResult> UpdateSource(string domain, [FromBody] CrawlerSourceSettings settings,
        [FromServices] ICrawlerSourceAdminService sources, CancellationToken ct)
    {
        await sources.UpdateAsync(domain, settings, ct);
        return NoContent();
    }
}
