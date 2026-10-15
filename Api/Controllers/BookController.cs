namespace Api.Controllers;

using System.IO.Compression;
using System.Text;
using System.Text.Json;
using Application.Common.DTOs.Book;
using Application.Common.Interfaces;
using Application.Features.BookFeatures.Commands;
using Application.Features.BookFeatures.Queries;
using Application.Features.BookFeatures.Queries.GetBook;
using Domain.Repositories;
using Filters;
using Microsoft.AspNetCore.RateLimiting;
using Observability;

[ApiController]
[Route(ApiRoutes.Book)]
public partial class BookController : ControllerBase
{
    private const string MultipartFormData = "multipart/form-data";
    private const string CsvContentType = "text/csv; charset=utf-8";
    private readonly IBookCoverRepository _bookCoverRepository;
    private readonly IBookCoverStorage _bookCoverStorage;
    private readonly IBookCsvExportService _bookCsvExportService;
    private readonly IBookCsvImportService _bookCsvImportService;
    private readonly ILogger<BookController> _logger;

    private readonly IMediator _mediator;

    public BookController(
        IMediator mediator,
        IBookCsvImportService bookCsvImportService,
        IBookCsvExportService bookCsvExportService,
        IBookCoverRepository bookCoverRepository,
        IBookCoverStorage bookCoverStorage,
        ILogger<BookController> logger)
    {
        _mediator = mediator;
        _bookCsvImportService = bookCsvImportService;
        _bookCsvExportService = bookCsvExportService;
        _bookCoverRepository = bookCoverRepository;
        _bookCoverStorage = bookCoverStorage;
        _logger = logger;
    }

    [HttpPost]
    [Authorize]
    public async Task<IActionResult> Create([FromBody] CreateBookCommand command)
    {
        using var activity = TsundokuTelemetry.ActivitySource.StartActivity("Book.Create", ActivityKind.Internal);
        var bookId = await _mediator.Send(command);
        activity?.SetTag("book.id", bookId);
        TsundokuTelemetry.BooksCreated.Add(1);
        _logger.LogInformation("Book created. BookId={BookId}", bookId);

        return CreatedAtAction(nameof(GetById), new { id = bookId }, new { Id = bookId });
    }

    [HttpGet]
    [Authorize]
    public async Task<IActionResult> GetAll(
        [FromQuery] GetAllBooksQuery getAllBooks,
        CancellationToken cancellationToken)
    {
        using var activity = TsundokuTelemetry.ActivitySource.StartActivity("Book.Search", ActivityKind.Internal);
        activity?.SetTag(TsundokuTelemetryTags.BookQuery, getAllBooks.Query);
        activity?.SetTag(TsundokuTelemetryTags.BookSortBy, getAllBooks.SortBy);
        activity?.SetTag(TsundokuTelemetryTags.BookSortDirection, getAllBooks.SortDirection);
        TsundokuTelemetry.BookSearchRequests.Add(1);
        var books = await _mediator.Send(getAllBooks, cancellationToken);
        activity?.SetTag(TsundokuTelemetryTags.BookResultCount, books.Data.Count);

        return Ok(books);
    }

    [HttpGet("manage")]
    [Authorize]
    public async Task<IActionResult> GetManaged(
        [FromQuery] int skip = 0,
        [FromQuery] int take = 50,
        [FromQuery(Name = "query")] string? searchQuery = null)
    {
        return Ok(await _mediator.Send(new GetManagedBooksQuery(skip, take, searchQuery)));
    }

    [HttpPost("parse-html")]
    [Authorize]
    [RequestSizeLimit(10L * 1024 * 1024)]
    [EnableRateLimiting(DependencyInjection.ExpensiveUserActionRateLimitPolicy)]
    public async Task<IActionResult> ParseHtml([FromBody] ParseBookHtmlQuery query, CancellationToken cancellationToken)
    {
        var inputCharacters = query.Html?.Length ?? 0;
        if (inputCharacters > ParseBookHtmlQueryValidator.MaxHtmlCharacters)
        {
            return StatusCode(StatusCodes.Status413PayloadTooLarge,
                new ProblemDetails
                {
                    Type = "PayloadTooLarge",
                    Title = "Payload Too Large",
                    Status = StatusCodes.Status413PayloadTooLarge,
                    Detail = $"HTML cannot exceed {ParseBookHtmlQueryValidator.MaxHtmlCharacters} characters.",
                    Instance = HttpContext.Request.Path
                });
        }

        var startedAt = Stopwatch.GetTimestamp();
        var result = await _mediator.Send(query, cancellationToken);
        _logger.LogInformation(
            "Book HTML parsed. Source={Source} InputCharacters={InputCharacters} ElapsedMs={ElapsedMs}",
            result.Source,
            inputCharacters,
            Stopwatch.GetElapsedTime(startedAt).TotalMilliseconds);
        return Ok(result);
    }

    [HttpGet("summary")]
    [Authorize]
    public async Task<IActionResult> GetSummary([FromQuery] GetBookSummaryQuery query)
    {
        var summary = await _mediator.Send(query);
        return Ok(summary);
    }

    [HttpGet("search-suggestions")]
    [Authorize]
    public async Task<IActionResult> GetSearchSuggestions(
        [FromQuery] string field,
        [FromQuery] string? search,
        [FromQuery] int take = 10,
        [FromQuery(Name = "query")] string? searchQuery = null,
        CancellationToken cancellationToken = default)
    {
        return Ok(await _mediator.Send(
            new GetBookSearchSuggestionsQuery(field, search, take, searchQuery),
            cancellationToken));
    }

    [HttpGet("analytics")]
    [Authorize]
    public async Task<IActionResult> GetAnalytics(
        [FromQuery(Name = "query")] string? searchQuery,
        [FromQuery] DateOnly? from,
        [FromQuery] DateOnly? to,
        [FromQuery] string? bucket)
    {
        var analytics = await _mediator.Send(new GetBookAnalyticsQuery(searchQuery, from, to, bucket));
        return Ok(analytics);
    }

    [HttpGet(ApiRouteTemplates.Id)]
    [Authorize]
    public async Task<IActionResult> GetById(Guid id)
    {
        var bookDto = await _mediator.Send(new GetBookQuery(id));

        return Ok(bookDto);
    }

    [HttpPut(ApiRouteTemplates.Id)]
    [Authorize]
    public async Task<IActionResult> Update(Guid id, [FromBody] UpdateBookCommand model)
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
            model.Links);
        await _mediator.Send(command);
        TsundokuTelemetry.BooksUpdated.Add(1);
        _logger.LogInformation("Book updated. BookId={BookId}", id);

        return NoContent();
    }

    [HttpPost("import/sessions")]
    [Authorize]
    [Consumes(MultipartFormData)]
    [RequestSizeLimit(10 * 1024 * 1024)]
    [EnableRateLimiting(DependencyInjection.ExpensiveUserActionRateLimitPolicy)]
    public async Task<IActionResult> CreateImportSession(IFormFile? file, CancellationToken cancellationToken)
    {
        if (file == null)
        {
            return BadRequest(new { error = "CSV file is required." });
        }

        if (file.Length == 0)
        {
            return BadRequest(new { error = BookCsvValidationMessages.EmptyFile });
        }

        await using var stream = file.OpenReadStream();
        var result =
            await _bookCsvImportService.CreateSessionAsync(stream, file.FileName, cancellationToken);
        _logger.LogInformation("Book CSV import session created. SessionId={SessionId}", result.SessionId);

        return Ok(result);
    }

    [HttpPost("import/full/sessions")]
    [Authorize]
    [Consumes(MultipartFormData)]
    [FullBackupRequestSizeLimit]
    [RequestFormLimits(
        MultipartBodyLengthLimit = 600L * 1024 * 1024,
        MultipartBoundaryLengthLimit = 128,
        MultipartHeadersCountLimit = 8,
        MultipartHeadersLengthLimit = 4096,
        KeyLengthLimit = 128,
        ValueCountLimit = 8,
        ValueLengthLimit = 1024)]
    [EnableRateLimiting(DependencyInjection.FullBackupRateLimitPolicy)]
    public async Task<IActionResult> CreateFullImportSession(IFormFile? file, CancellationToken cancellationToken)
    {
        if (file == null)
        {
            return BadRequest(new { error = "Full backup ZIP file is required." });
        }

        if (Request.HasFormContentType && Request.Form.Files.Count != 1)
        {
            return BadRequest(new { error = "Exactly one full backup ZIP file is required." });
        }

        if (file.Length == 0)
        {
            return BadRequest(new { error = "Full backup ZIP file is empty." });
        }

        if (!string.Equals(Path.GetExtension(file.FileName), ".zip", StringComparison.OrdinalIgnoreCase))
        {
            return BadRequest(new { error = "Full backup must be a .zip file." });
        }

        await using var stream = file.OpenReadStream();
        var result = await _bookCsvImportService.CreateFullSessionAsync(stream, file.FileName, cancellationToken);
        _logger.LogInformation("Book full import session created. SessionId={SessionId}", result.SessionId);
        return Ok(result);
    }

    [HttpGet("import/template")]
    [Authorize]
    public IActionResult DownloadImportTemplate()
    {
        var template = _bookCsvImportService.CreateTemplate();
        var bytes = Encoding.UTF8.GetBytes(template);
        return File(bytes, CsvContentType, "book-import-template.csv");
    }

    [HttpGet("export")]
    [Authorize]
    public async Task<IActionResult> ExportBooks([FromQuery] string? query, [FromQuery] string? sortBy,
        [FromQuery] string? sortDirection)
    {
        var firstPage =
            await _mediator.Send(new GetAllBooksForExportQuery(0, 1, query, sortBy, sortDirection));
        var allBooks = firstPage.Total > 0
            ? await _mediator.Send(new GetAllBooksForExportQuery(0, firstPage.Total, query, sortBy, sortDirection))
            : firstPage;

        var csv = _bookCsvExportService.Build(allBooks.Data);
        var bytes = Encoding.UTF8.GetBytes(csv);
        return File(bytes, CsvContentType, "books-export.csv");
    }

    [HttpGet("export/full")]
    [Authorize]
    [EnableRateLimiting(DependencyInjection.FullBackupRateLimitPolicy)]
    public async Task<IActionResult> ExportFullBooks([FromQuery] string? query, [FromQuery] string? sortBy,
        [FromQuery] string? sortDirection, CancellationToken cancellationToken)
    {
        var firstPage =
            await _mediator.Send(new GetAllBooksForExportQuery(0, 1, query, sortBy, sortDirection), cancellationToken);
        var allBooks = firstPage.Total > 0
            ? await _mediator.Send(new GetAllBooksForExportQuery(0, firstPage.Total, query, sortBy, sortDirection),
                cancellationToken)
            : firstPage;

        await using var archiveStream = new MemoryStream();
        using (var archive = new ZipArchive(archiveStream, ZipArchiveMode.Create, true))
        {
            var csvEntry = archive.CreateEntry("books.csv", CompressionLevel.NoCompression);
            await using (var csvStream = csvEntry.Open())
            await using (var writer = new StreamWriter(csvStream, Encoding.UTF8, leaveOpen: false))
            {
                await writer.WriteAsync(_bookCsvExportService.Build(allBooks.Data));
            }

            var manifest = new BookFullBackupManifest();
            for (var index = 0; index < allBooks.Data.Count; index++)
            {
                var book = allBooks.Data[index];
                var cover = await _bookCoverRepository.GetByBookIdAsync(book.Id, cancellationToken);
                string? originalCoverPath = null;
                string? thumbnailCoverPath = null;
                if (cover != null)
                {
                    var coverDirectory = $"covers/{index + 1:D6}";
                    originalCoverPath = await AddCoverFileAsync(
                        archive, book.Id, $"{coverDirectory}/original", cover.StoragePath, cancellationToken);
                    thumbnailCoverPath = await AddCoverFileAsync(
                        archive, book.Id, $"{coverDirectory}/thumbnail", cover.ThumbnailStoragePath,
                        cancellationToken);
                }

                manifest.Books.Add(new BookFullBackupManifestItem
                {
                    PrimaryTitle = book.PrimaryTitle,
                    ContentType = book.ContentType,
                    OriginalCoverPath = originalCoverPath,
                    OriginalCoverMimeType = originalCoverPath == null ? null : cover?.MimeType,
                    ThumbnailCoverPath = thumbnailCoverPath,
                    ThumbnailCoverMimeType = thumbnailCoverPath == null ? null : cover?.ThumbnailMimeType
                });
            }

            var manifestEntry = archive.CreateEntry("manifest.json", CompressionLevel.NoCompression);
            await using var manifestStream = manifestEntry.Open();
            await JsonSerializer.SerializeAsync(manifestStream, manifest, cancellationToken: cancellationToken);
        }

        return File(archiveStream.ToArray(), "application/zip", "books-full-export.zip");
    }

    [HttpGet(ApiRouteTemplates.ImportSession)]
    [Authorize]
    public async Task<IActionResult> GetImportSession(Guid sessionId, CancellationToken cancellationToken)
    {
        var result = await _bookCsvImportService.GetSessionAsync(sessionId, cancellationToken);
        return Ok(result);
    }

    [HttpPut(ApiRouteTemplates.ImportSessionRow)]
    [Authorize]
    public async Task<IActionResult> UpdateImportRow(Guid sessionId, Guid rowId,
        [FromBody] UpdateBookImportRowRequest request, CancellationToken cancellationToken)
    {
        var result =
            await _bookCsvImportService.UpdateRowAsync(sessionId, rowId, request, cancellationToken);
        return Ok(result);
    }

    [HttpDelete(ApiRouteTemplates.ImportSessionRow)]
    [Authorize]
    public async Task<IActionResult> DeleteImportRow(Guid sessionId, Guid rowId, CancellationToken cancellationToken)
    {
        var result = await _bookCsvImportService.DeleteRowAsync(sessionId, rowId, cancellationToken);
        return Ok(result);
    }

    [HttpDelete("import/sessions/{sessionId:guid}/rows/invalid")]
    [Authorize]
    public async Task<IActionResult> DeleteInvalidImportRows(Guid sessionId, CancellationToken cancellationToken)
    {
        var result = await _bookCsvImportService.DeleteInvalidRowsAsync(sessionId, cancellationToken);
        return Ok(result);
    }

    [HttpPost("import/sessions/{sessionId:guid}/finalize")]
    [Authorize]
    [EnableRateLimiting(DependencyInjection.ExpensiveUserActionRateLimitPolicy)]
    public async Task<IActionResult> FinalizeImport(Guid sessionId, CancellationToken cancellationToken)
    {
        var result = await _bookCsvImportService.FinalizeAsync(sessionId, cancellationToken);
        _logger.LogInformation("Book CSV import finalized. SessionId={SessionId} Imported={Imported} Skipped={Skipped}",
            sessionId, result.ImportedCount, result.SkippedCount);
        return Ok(result);
    }

    [HttpDelete(ApiRouteTemplates.ImportSession)]
    [Authorize]
    public async Task<IActionResult> CancelImport(Guid sessionId, CancellationToken cancellationToken)
    {
        await _bookCsvImportService.CancelAsync(sessionId, cancellationToken);
        return NoContent();
    }

    [HttpPatch("{id:guid}/progress")]
    [Authorize]
    public async Task<IActionResult> UpdateProgress(Guid id, UpdateBookProgressCommand model)
    {
        var command =
            new UpdateBookProgressCommand(id, model.CurrentChapterNumber, model.CurrentChapterLabel, model.Comment);
        await _mediator.Send(command);
        TsundokuTelemetry.BookProgressUpdated.Add(1);
        _logger.LogInformation("Book progress updated. BookId={BookId}", id);

        return NoContent();
    }

    [HttpPut(ApiRouteTemplates.BookCover)]
    [Authorize]
    [Consumes(MultipartFormData)]
    [RequestSizeLimit(10 * 1024 * 1024)]
    [EnableRateLimiting(DependencyInjection.ExpensiveUserActionRateLimitPolicy)]
    public async Task<IActionResult> UploadCover(Guid id, IFormFile? file)
    {
        if (file == null)
        {
            return BadRequest(new { error = "Cover file is required." });
        }

        if (file.Length == 0)
        {
            return BadRequest(new { error = BookCoverValidationMessages.EmptyFile });
        }

        await using var stream = file.OpenReadStream();
        var cover =
            await _mediator.Send(new UploadBookCoverCommand(id, stream, file.FileName, file.ContentType, file.Length));
        _logger.LogInformation("Book cover uploaded. BookId={BookId}", id);

        return Ok(cover);
    }

    [HttpGet("cover/uploads/{token:guid}")]
    [Authorize]
    public async Task<IActionResult> ResolvePendingCoverUpload(Guid token, CancellationToken cancellationToken)
    {
        var bookId = await _mediator.Send(new ResolvePendingCoverUploadQuery(token), cancellationToken);
        return bookId is null ? NotFound() : Ok(new { BookId = bookId });
    }

    [HttpPut("{id:guid}/cover/url")]
    [Authorize]
    [EnableRateLimiting(DependencyInjection.ExpensiveUserActionRateLimitPolicy)]
    public async Task<IActionResult> SetCoverFromUrl(Guid id, [FromBody] SetBookCoverFromUrlRequest request)
    {
        var cover = await _mediator.Send(new SetBookCoverFromUrlCommand(id, request.ImageUrl));
        _logger.LogInformation("Book cover set from URL. BookId={BookId}", id);

        return Ok(cover);
    }

    [HttpPost("{id:guid}/cover/refresh")]
    [Authorize]
    [EnableRateLimiting(DependencyInjection.ExpensiveUserActionRateLimitPolicy)]
    public async Task<IActionResult> RefreshCover(Guid id)
    {
        var cover = await _mediator.Send(new RefreshBookCoverCommand(id));
        _logger.LogInformation("Book cover refresh queued. BookId={BookId}", id);

        return Accepted(cover);
    }

    [HttpDelete(ApiRouteTemplates.BookCover)]
    [Authorize]
    public async Task<IActionResult> DeleteCover(Guid id)
    {
        await _mediator.Send(new DeleteBookCoverCommand(id));
        _logger.LogInformation("Book cover deleted. BookId={BookId}", id);
        return NoContent();
    }

    [HttpGet("{id:guid}/cover/file")]
    [Authorize]
    public async Task<IActionResult> GetCoverFile(Guid id)
    {
        var result = await _mediator.Send(new GetBookCoverFileQuery(id));
        ApplyCoverCacheHeaders();

        return File(result.Content, result.MimeType, result.FileName);
    }

    [HttpGet("{id:guid}/cover/thumbnail")]
    [Authorize]
    public async Task<IActionResult> GetCoverThumbnail(Guid id)
    {
        var result = await _mediator.Send(new GetBookCoverThumbnailFileQuery(id));
        ApplyCoverCacheHeaders();

        return File(result.Content, result.MimeType, result.FileName);
    }

    [HttpDelete(ApiRouteTemplates.Id)]
    [Authorize]
    public async Task<IActionResult> Delete(Guid id)
    {
        await _mediator.Send(new DeleteBookCommand(id));
        _logger.LogInformation("Book deleted. BookId={BookId}", id);
        return NoContent();
    }
}

public sealed record SetBookCoverFromUrlRequest(string ImageUrl);

partial class BookController
{
    private async Task<string?> AddCoverFileAsync(ZipArchive archive, Guid bookId, string entryPath,
        string? storagePath,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(storagePath))
        {
            return null;
        }

        try
        {
            var extension = Path.GetExtension(storagePath);
            var fullEntryPath = entryPath + extension;
            var entry = archive.CreateEntry(fullEntryPath, CompressionLevel.NoCompression);
            await using var source = await _bookCoverStorage.OpenReadAsync(storagePath, cancellationToken);
            await using var destination = entry.Open();
            await source.CopyToAsync(destination, cancellationToken);
            return fullEntryPath;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Skipping unavailable cover during full export. BookId={BookId}", bookId);
            return null;
        }
    }

    private void ApplyCoverCacheHeaders()
    {
        Response.Headers.CacheControl = "private, max-age=2592000, immutable";
        Response.Headers.Vary = "Authorization";
    }
}
