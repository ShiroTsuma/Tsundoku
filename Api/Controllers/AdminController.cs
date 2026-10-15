namespace Api.Controllers;

using Application.Features.AccountFeatures;
using Application.Features.BookFeatures.Commands;
using Application.Features.BookFeatures.Queries.GetBook;
using Application.Features.GenreFeatures.Commands;
using Application.Features.StatusFeatures.Commands;
using Application.Features.TagFeatures.Commands;
using Application.Features.TypeFeatures.Commands;
using Observability;

[ApiController]
[Authorize(Roles = AuthorizationRoles.Admin)]
[Route(ApiRoutes.Admin)]
public class AdminController : ControllerBase
{
    private readonly ILogger<AdminController> _logger;
    private readonly IMediator _mediator;

    public AdminController(IMediator mediator, ILogger<AdminController> logger)
    {
        _mediator = mediator;
        _logger = logger;
    }

    [HttpGet("books")]
    public async Task<IActionResult> GetBooks(
        [FromQuery] int skip = 0,
        [FromQuery] int take = 100,
        [FromQuery] string? query = null,
        [FromQuery] string? sortBy = BookSortFields.LastModified,
        [FromQuery] string? sortDirection = SortDirections.Descending,
        CancellationToken cancellationToken = default)
    {
        var request = new GetAllAdminBooksQuery(skip, take, query, sortBy, sortDirection);
        using var activity =
            TsundokuTelemetry.ActivitySource.StartActivity("Admin.Book.Search", ActivityKind.Internal);
        activity?.SetTag(TsundokuTelemetryTags.BookQuery, request.Query);
        activity?.SetTag(TsundokuTelemetryTags.BookSortBy, request.SortBy);
        activity?.SetTag(TsundokuTelemetryTags.BookSortDirection, request.SortDirection);
        TsundokuTelemetry.BookSearchRequests.Add(1);
        var books = await _mediator.Send(request, cancellationToken);
        activity?.SetTag(TsundokuTelemetryTags.BookResultCount, books.Data.Count);

        return Ok(books);
    }

    [HttpGet(ApiRouteTemplates.AdminBookById)]
    public async Task<IActionResult> GetBook(Guid id)
    {
        var book = await _mediator.Send(new GetAdminBookQuery(id));

        return Ok(book);
    }

    [HttpPut(ApiRouteTemplates.AdminBookById)]
    public async Task<IActionResult> UpdateBook(Guid id, [FromBody] UpdateBookCommand model)
    {
        var command = new UpdateBookCommand(
            id,
            model.PrimaryTitle,
            model.ContentTypeId,
            model.StatusId,
            model.AuthorId,
            model.AuthorName,
            model.AlternativeTitles,
            model.GenreIds,
            model.Tags,
            model.TotalChapters,
            model.CurrentChapterNumber,
            model.CurrentChapterLabel,
            model.Rating,
            model.Priority,
            model.Description,
            model.Notes,
            model.RawImportedLine,
            model.Links) { AdminScope = true };

        await _mediator.Send(command);
        TsundokuTelemetry.BooksUpdated.Add(1);
        _logger.LogInformation("Admin updated book. BookId={BookId}", id);

        return NoContent();
    }

    [HttpPost("statuses")]
    public async Task<IActionResult> CreateStatus([FromBody] CreateStatusCommand command)
    {
        var status = await _mediator.Send(command);
        TsundokuTelemetry.AdminDictionaryCreated.Add(1,
            new KeyValuePair<string, object?>(TsundokuTelemetryTags.DictionaryType, "status"));
        _logger.LogInformation("Admin created status. StatusId={StatusId}", status.Id);

        return Created(ApiRoutes.StatusById(status.Id), status);
    }

    [HttpPost("types")]
    public async Task<IActionResult> CreateType([FromBody] CreateTypeCommand command)
    {
        var type = await _mediator.Send(command);
        TsundokuTelemetry.AdminDictionaryCreated.Add(1,
            new KeyValuePair<string, object?>(TsundokuTelemetryTags.DictionaryType, "type"));
        _logger.LogInformation("Admin created type. TypeId={TypeId}", type.Id);

        return Created(ApiRoutes.TypeById(type.Id), type);
    }

    [HttpPost("genres")]
    public async Task<IActionResult> CreateGenre([FromBody] CreateGenreCommand command)
    {
        var genre = await _mediator.Send(command);
        TsundokuTelemetry.AdminDictionaryCreated.Add(1,
            new KeyValuePair<string, object?>(TsundokuTelemetryTags.DictionaryType, "genre"));
        _logger.LogInformation("Admin created genre. GenreId={GenreId}", genre.Id);

        return Created(ApiRoutes.GenreById(genre.Id), genre);
    }

    [HttpGet("tags")]
    public async Task<IActionResult> SearchGlobalTags([FromQuery] SearchGlobalTagsQuery query)
    {
        return Ok(await _mediator.Send(query));
    }

    [HttpPost("tags")]
    public async Task<IActionResult> CreateGlobalTag(CreateGlobalTagCommand command)
    {
        var tag = await _mediator.Send(command);
        return Created($"/{ApiRoutes.Admin}/tags/{tag.Id}", tag);
    }

    [HttpPut("tags/{id:guid}")]
    public async Task<IActionResult> UpdateGlobalTag(Guid id, UpdateGlobalTagCommand command)
    {
        command.Id = id;
        return Ok(await _mediator.Send(command));
    }

    [HttpDelete("tags/{id:guid}")]
    public async Task<IActionResult> DeleteGlobalTag(Guid id)
    {
        await _mediator.Send(new DeleteGlobalTagCommand(id));
        return NoContent();
    }

    [HttpDelete("books/owner/{ownerId:guid}")]
    public async Task<IActionResult> DeleteBooksByOwner(Guid ownerId, CancellationToken cancellationToken)
    {
        var result =
            await _mediator.Send(new DeleteBooksByOwnerCommand(ownerId), cancellationToken);
        _logger.LogInformation(
            "Admin purged owner library. OwnerId={OwnerId} DeletedBooks={DeletedBooks} DeletedAuthors={DeletedAuthors} DeletedTags={DeletedTags}",
            ownerId,
            result.DeletedBooks,
            result.DeletedAuthors,
            result.DeletedTags);
        return Ok(result);
    }

    [HttpGet("users")]
    public async Task<IActionResult> GetUsers([FromQuery] GetAdminUsersQuery query,
        CancellationToken cancellationToken)
    {
        return Ok(await _mediator.Send(query, cancellationToken));
    }

    [HttpDelete("users/{userId:guid}")]
    public async Task<IActionResult> DeleteUser(Guid userId, CancellationToken cancellationToken)
    {
        var result = await _mediator.Send(new DeleteAdminUserCommand(userId), cancellationToken);
        _logger.LogInformation(
            "Admin deleted account. UserId={UserId} DeletedBooks={DeletedBooks} DeletedAuthors={DeletedAuthors} DeletedTags={DeletedTags}",
            result.UserId, result.DeletedBooks, result.DeletedAuthors, result.DeletedTags);
        return Ok(result);
    }
}
