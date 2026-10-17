namespace Application.UnitTests;

using System.IO.Compression;
using System.Text;
using System.Text.Json;
using Api.Controllers;
using Common.DTOs.Book;
using Common.Interfaces;
using Common.Models;
using Domain.Entities;
using Domain.Repositories;
using Features.BookFeatures.Commands;
using Features.BookFeatures.Queries;
using Features.BookFeatures.Queries.GetBook;
using MediatR;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;

public class BookControllerTests
{
    [Fact]
    public async Task Create_ShouldSendCommandAndReturnCreatedBookId()
    {
        var bookId = Guid.NewGuid();
        var command = CreateBookCommand("New Book");
        var mediator = new Mock<IMediator>();
        mediator.Setup(mock => mock.Send(command, It.IsAny<CancellationToken>())).ReturnsAsync(bookId);
        var controller = CreateController(mediator.Object);

        var result = await controller.Create(command);

        var created = Assert.IsType<CreatedAtActionResult>(result);
        Assert.Equal(nameof(BookController.GetById), created.ActionName);
        Assert.Equal(bookId, created.RouteValues!["id"]);
        mediator.Verify(mock => mock.Send(command, It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task GetAll_ShouldReturnMediatorPage()
    {
        var query = new GetAllBooksQuery(0, 20, "status:reading", "title", "asc");
        var expected = PaginatedResult<BookListItemDto>.Create(
            0,
            20,
            1,
            [
                new BookListItemDto
                {
                    Id = Guid.NewGuid(), PrimaryTitle = "Book", ContentType = "Novel", Status = "Reading"
                }
            ]);
        var mediator = new Mock<IMediator>();
        mediator.Setup(mock => mock.Send(query, It.IsAny<CancellationToken>())).ReturnsAsync(expected);
        var controller = CreateController(mediator.Object);

        var result = await controller.GetAll(query, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result);
        Assert.Same(expected, ok.Value);
    }

    [Fact]
    public async Task GetManaged_ShouldReturnMediatorPage()
    {
        var query = new GetManagedBooksQuery(50, 50, "tag:fantasy");
        var expected = PaginatedResult<ManagedBookListItemDto>.Create(50, 50, 0, []);
        var mediator = new Mock<IMediator>();
        mediator.Setup(mock => mock.Send(query, It.IsAny<CancellationToken>())).ReturnsAsync(expected);
        var controller = CreateController(mediator.Object);

        var result = await controller.GetManaged(query.Skip, query.Take, query.Query);

        Assert.Same(expected, Assert.IsType<OkObjectResult>(result).Value);
        mediator.Verify(mock => mock.Send(
            It.Is<GetManagedBooksQuery>(request =>
                request.Skip == 50 &&
                request.Take == 50 &&
                request.Query == "tag:fantasy"),
            It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task GetSearchSuggestions_ShouldForwardScopeQueryWithEmptySearch()
    {
        var expected = new[] { new BookSearchSuggestionDto("Reading", 3, false, true) };
        var mediator = new Mock<IMediator>();
        mediator
            .Setup(mock => mock.Send(
                new GetBookSearchSuggestionsQuery("status", null, 10, "type:\"Novel\""),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(expected);
        var controller = CreateController(mediator.Object);

        var result =
            await controller.GetSearchSuggestions("status", null, 10, "type:\"Novel\"", CancellationToken.None);

        Assert.Same(expected, Assert.IsType<OkObjectResult>(result).Value);
        mediator.Verify(mock => mock.Send(
            It.Is<GetBookSearchSuggestionsQuery>(request =>
                request.Field == "status" &&
                request.Search == null &&
                request.Take == 10 &&
                request.Query == "type:\"Novel\""),
            It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task ParseHtml_ShouldReturnResolvedDraftWithoutPersistingAnything()
    {
        var query = new ParseBookHtmlQuery("<html>NovelUpdates</html>");
        var expected = new BookHtmlParseResult(
            "NovelUpdates",
            "Book",
            "Author",
            null,
            [],
            [],
            [],
            null,
            null,
            null,
            []);
        var mediator = new Mock<IMediator>();
        mediator.Setup(mock => mock.Send(query, It.IsAny<CancellationToken>())).ReturnsAsync(expected);
        var controller = CreateController(mediator.Object);

        var result = await controller.ParseHtml(query, CancellationToken.None);

        Assert.Same(expected, Assert.IsType<OkObjectResult>(result).Value);
        mediator.Verify(mock => mock.Send(query, CancellationToken.None), Times.Once);
    }

    [Fact]
    public async Task ParseHtml_ShouldReturnPayloadTooLargeBeforeParsingOversizedInput()
    {
        var query = new ParseBookHtmlQuery(new string('x', ParseBookHtmlQueryValidator.MaxHtmlCharacters + 1));
        var mediator = new Mock<IMediator>();
        var controller = CreateController(mediator.Object);

        var result = await controller.ParseHtml(query, CancellationToken.None);

        var response = Assert.IsType<ObjectResult>(result);
        Assert.Equal(StatusCodes.Status413PayloadTooLarge, response.StatusCode);
        Assert.Equal(StatusCodes.Status413PayloadTooLarge, Assert.IsType<ProblemDetails>(response.Value).Status);
        mediator.Verify(mock => mock.Send(It.IsAny<ParseBookHtmlQuery>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task GetById_ShouldReturnMediatorBook()
    {
        var book = Book("Details");
        var mediator = new Mock<IMediator>();
        mediator.Setup(mock => mock.Send(new GetBookQuery(book.Id), It.IsAny<CancellationToken>())).ReturnsAsync(book);
        var controller = CreateController(mediator.Object);

        var result = await controller.GetById(book.Id);

        Assert.Same(book, Assert.IsType<OkObjectResult>(result).Value);
    }

    [Fact]
    public async Task Update_ShouldSendRouteIdAndReturnNoContent()
    {
        var bookId = Guid.NewGuid();
        var model = UpdateBookCommand(Guid.Empty, "Updated");
        var mediator = new Mock<IMediator>();
        var controller = CreateController(mediator.Object);

        var result = await controller.Update(bookId, model);

        Assert.IsType<NoContentResult>(result);
        mediator.Verify(mock => mock.Send(
            It.Is<UpdateBookCommand>(command => command.Id == bookId && command.PrimaryTitle == "Updated"),
            It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task CreateImportSession_ShouldRejectMissingFile()
    {
        var controller = CreateController();

        var result = await controller.CreateImportSession(null, CancellationToken.None);

        var badRequest = Assert.IsType<BadRequestObjectResult>(result);
        Assert.Equal("CSV file is required.", ReadError(badRequest.Value));
    }

    [Fact]
    public async Task CreateImportSession_ShouldRejectEmptyFile()
    {
        var controller = CreateController();
        var file = CreateFormFile(string.Empty, "books.csv");

        var result = await controller.CreateImportSession(file, CancellationToken.None);

        var badRequest = Assert.IsType<BadRequestObjectResult>(result);
        Assert.Equal("CSV file is empty.", ReadError(badRequest.Value));
    }

    [Fact]
    public async Task CreateImportSession_ShouldReturnServiceResult()
    {
        var expected = new BookImportSessionDto
        {
            SessionId = Guid.NewGuid(), FileName = "books.csv", Rows = Array.Empty<BookImportRowDto>()
        };
        var importService = new Mock<IBookCsvImportService>();
        importService
            .Setup(service => service.CreateSessionAsync(It.IsAny<Stream>(), "books.csv", CancellationToken.None))
            .ReturnsAsync(expected);
        var controller = CreateController(importService: importService.Object);
        var file = CreateFormFile("primaryTitle,contentType,status\nBook,Novel,Reading", "books.csv");

        var result = await controller.CreateImportSession(file, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result);
        Assert.Same(expected, ok.Value);
    }

    [Fact]
    public async Task CreateFullImportSession_ShouldReturnServiceResult()
    {
        var expected = new BookImportSessionDto
        {
            SessionId = Guid.NewGuid(), FileName = "backup.csv", Rows = Array.Empty<BookImportRowDto>()
        };
        var importService = new Mock<IBookCsvImportService>();
        importService
            .Setup(service => service.CreateFullSessionAsync(It.IsAny<Stream>(), "backup.zip",
                CancellationToken.None))
            .ReturnsAsync(expected);
        var controller = CreateController(importService: importService.Object);
        var file = CreateFormFile("zip-content", "backup.zip", "application/zip");

        var result = await controller.CreateFullImportSession(file, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result);
        Assert.Same(expected, ok.Value);
    }

    [Fact]
    public async Task CreateFullImportSession_ShouldRejectNonZipFile()
    {
        var controller = CreateController();
        var file = CreateFormFile("csv-content", "books.csv");

        var result = await controller.CreateFullImportSession(file, CancellationToken.None);

        var badRequest = Assert.IsType<BadRequestObjectResult>(result);
        Assert.Equal("Full backup must be a .zip file.", ReadError(badRequest.Value));
    }

    [Fact]
    public async Task FinalizeImport_ShouldReturnFinalizeResult()
    {
        var sessionId = Guid.NewGuid();
        var expected = new BookImportFinalizeResultDto
        {
            ImportedCount = 2, SkippedCount = 1, Errors = ["Line 4 skipped"]
        };
        var importService = new Mock<IBookCsvImportService>();
        importService
            .Setup(service => service.FinalizeAsync(sessionId, CancellationToken.None))
            .ReturnsAsync(expected);
        var controller = CreateController(importService: importService.Object);

        var result = await controller.FinalizeImport(sessionId, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result);
        Assert.Same(expected, ok.Value);
    }

    [Fact]
    public void DownloadImportTemplate_ShouldReturnCsvTemplate()
    {
        var importService = new Mock<IBookCsvImportService>();
        importService.Setup(service => service.CreateTemplate()).Returns("template,csv\n");
        var controller = CreateController(importService: importService.Object);

        var result = controller.DownloadImportTemplate();

        var file = Assert.IsType<FileContentResult>(result);
        Assert.Equal("book-import-template.csv", file.FileDownloadName);
        Assert.Equal("template,csv\n", Encoding.UTF8.GetString(file.FileContents));
    }

    [Fact]
    public async Task ImportSessionEndpoints_ShouldReturnServiceResults()
    {
        var sessionId = Guid.NewGuid();
        var rowId = Guid.NewGuid();
        var expected = new BookImportSessionDto
        {
            SessionId = sessionId,
            FileName = "books.csv",
            Rows = [new BookImportRowDto { RowId = rowId, LineNumber = 2, IsValid = true, PrimaryTitle = "Book" }]
        };
        var request = new UpdateBookImportRowRequest("Book", null, "Novel", "Reading", null, null, null, null, null,
            null,
            null, null, null, null);
        var importService = new Mock<IBookCsvImportService>();
        importService.Setup(service => service.GetSessionAsync(sessionId, CancellationToken.None))
            .ReturnsAsync(expected);
        importService.Setup(service => service.UpdateRowAsync(sessionId, rowId, request, CancellationToken.None))
            .ReturnsAsync(expected);
        importService.Setup(service => service.DeleteRowAsync(sessionId, rowId, CancellationToken.None))
            .ReturnsAsync(expected);
        var controller = CreateController(importService: importService.Object);

        Assert.Same(expected,
            Assert.IsType<OkObjectResult>(await controller.GetImportSession(sessionId, CancellationToken.None)).Value);
        Assert.Same(expected,
            Assert.IsType<OkObjectResult>(await controller.UpdateImportRow(sessionId, rowId, request,
                CancellationToken.None)).Value);
        Assert.Same(expected,
            Assert.IsType<OkObjectResult>(await controller.DeleteImportRow(sessionId, rowId, CancellationToken.None))
                .Value);
    }

    [Fact]
    public async Task CancelImport_ShouldCancelSessionAndReturnNoContent()
    {
        var sessionId = Guid.NewGuid();
        var importService = new Mock<IBookCsvImportService>();
        var controller = CreateController(importService: importService.Object);

        var result = await controller.CancelImport(sessionId, CancellationToken.None);

        Assert.IsType<NoContentResult>(result);
        importService.Verify(service => service.CancelAsync(sessionId, CancellationToken.None), Times.Once);
    }

    [Fact]
    public async Task DeleteInvalidImportRows_ShouldReturnUpdatedSession()
    {
        var sessionId = Guid.NewGuid();
        var expected = new BookImportSessionDto
        {
            SessionId = sessionId,
            FileName = "books.csv",
            TotalRows = 1,
            ValidRows = 1,
            InvalidRows = 0,
            CanFinalize = true,
            Rows = Array.Empty<BookImportRowDto>()
        };
        var importService = new Mock<IBookCsvImportService>();
        importService
            .Setup(service => service.DeleteInvalidRowsAsync(sessionId, CancellationToken.None))
            .ReturnsAsync(expected);
        var controller = CreateController(importService: importService.Object);

        var result = await controller.DeleteInvalidImportRows(sessionId, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result);
        Assert.Same(expected, ok.Value);
    }

    [Fact]
    public async Task UploadCover_ShouldRejectMissingFile()
    {
        var controller = CreateController();

        var result = await controller.UploadCover(Guid.NewGuid(), null);

        var badRequest = Assert.IsType<BadRequestObjectResult>(result);
        Assert.Equal("Cover file is required.", ReadError(badRequest.Value));
    }

    [Fact]
    public async Task UploadCover_ShouldRejectEmptyFile()
    {
        var controller = CreateController();
        var file = CreateFormFile(string.Empty, "cover.jpg", "image/jpeg");

        var result = await controller.UploadCover(Guid.NewGuid(), file);

        var badRequest = Assert.IsType<BadRequestObjectResult>(result);
        Assert.Equal("Cover file is empty.", ReadError(badRequest.Value));
    }

    [Fact]
    public async Task UploadCover_ShouldSendUploadCommandAndReturnCover()
    {
        var bookId = Guid.NewGuid();
        var expected = Cover("Uploaded");
        var mediator = new Mock<IMediator>();
        mediator
            .Setup(mock => mock.Send(It.Is<UploadBookCoverCommand>(command =>
                command.BookId == bookId &&
                command.FileName == "cover.jpg" &&
                command.ContentType == "image/jpeg" &&
                command.Length == 3), It.IsAny<CancellationToken>()))
            .ReturnsAsync(expected);
        var controller = CreateController(mediator.Object);

        var result = await controller.UploadCover(bookId, CreateFormFile("abc", "cover.jpg", "image/jpeg"));

        Assert.Same(expected, Assert.IsType<OkObjectResult>(result).Value);
    }

    [Fact]
    public async Task CoverMutationEndpoints_ShouldSendCommands()
    {
        var bookId = Guid.NewGuid();
        var expected = Cover("Found");
        var mediator = new Mock<IMediator>();
        mediator.Setup(mock => mock.Send(new SetBookCoverFromUrlCommand(bookId, "https://example.com/cover.jpg"),
            It.IsAny<CancellationToken>())).ReturnsAsync(expected);
        mediator.Setup(mock => mock.Send(new RefreshBookCoverCommand(bookId), It.IsAny<CancellationToken>()))
            .ReturnsAsync(expected);
        var controller = CreateController(mediator.Object);

        Assert.Same(expected,
            Assert.IsType<OkObjectResult>(await controller.SetCoverFromUrl(bookId,
                new SetBookCoverFromUrlRequest("https://example.com/cover.jpg"))).Value);
        Assert.Same(expected, Assert.IsType<AcceptedResult>(await controller.RefreshCover(bookId)).Value);
        Assert.IsType<NoContentResult>(await controller.DeleteCover(bookId));
        mediator.Verify(mock => mock.Send(new DeleteBookCoverCommand(bookId), It.IsAny<CancellationToken>()),
            Times.Once);
    }

    [Fact]
    public async Task GetCoverFile_ShouldReturnFileResultFromMediator()
    {
        var bookId = Guid.NewGuid();
        var mediator = new Mock<IMediator>();
        mediator
            .Setup(m => m.Send(It.Is<GetBookCoverFileQuery>(q => q.BookId == bookId), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new BookCoverFileResult(
                new MemoryStream(Encoding.UTF8.GetBytes("abc")),
                "image/jpeg",
                "cover.jpg"));
        var controller = CreateController(mediator.Object);

        var result = await controller.GetCoverFile(bookId);

        var file = Assert.IsType<FileStreamResult>(result);
        Assert.Equal("image/jpeg", file.ContentType);
        Assert.Equal("cover.jpg", file.FileDownloadName);
        Assert.Equal("private, max-age=2592000, immutable", controller.Response.Headers.CacheControl);
        Assert.Equal("Authorization", controller.Response.Headers.Vary);
    }

    [Fact]
    public async Task GetCoverThumbnail_ShouldReturnFileResultFromMediator()
    {
        var bookId = Guid.NewGuid();
        var mediator = new Mock<IMediator>();
        mediator
            .Setup(m => m.Send(It.Is<GetBookCoverThumbnailFileQuery>(q => q.BookId == bookId),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(new BookCoverFileResult(
                new MemoryStream(Encoding.UTF8.GetBytes("thumb")),
                "image/jpeg",
                "cover.thumb.jpg"));
        var controller = CreateController(mediator.Object);

        var result = await controller.GetCoverThumbnail(bookId);

        var file = Assert.IsType<FileStreamResult>(result);
        Assert.Equal("image/jpeg", file.ContentType);
        Assert.Equal("cover.thumb.jpg", file.FileDownloadName);
        Assert.Equal("private, max-age=2592000, immutable", controller.Response.Headers.CacheControl);
        Assert.Equal("Authorization", controller.Response.Headers.Vary);
    }

    [Fact]
    public async Task ExportBooks_ShouldReturnCsvForCurrentQueryAndSort()
    {
        var mediator = new Mock<IMediator>();
        var importService = new Mock<IBookCsvImportService>();
        var exportService = new Mock<IBookCsvExportService>();
        var logger = new Mock<ILogger<BookController>>();
        var firstPage = new PaginatedResult<BookDto> { Skip = 0, Take = 1, Total = 2, Data = [Book("Placeholder")] };
        var fullPage = new PaginatedResult<BookDto>
        {
            Skip = 0,
            Take = 2,
            Total = 2,
            Data =
            [
                Book("Alpha, Book", "Toika", notes: "Line 1\nLine 2"),
                Book("Beta", tags: ["favorite", "mystery"])
            ]
        };
        mediator
            .SetupSequence(mock => mock.Send(It.IsAny<GetAllBooksForExportQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(firstPage)
            .ReturnsAsync(fullPage);
        exportService
            .Setup(service => service.Build(fullPage.Data))
            .Returns("exported,csv\n");
        var controller = new BookController(
            mediator.Object,
            importService.Object,
            exportService.Object,
            Mock.Of<IBookCoverRepository>(),
            Mock.Of<IBookCoverStorage>(),
            logger.Object);

        var result = await controller.ExportBooks("author:Toika", "title", "asc");

        var file = Assert.IsType<FileContentResult>(result);
        var csv = Encoding.UTF8.GetString(file.FileContents);

        Assert.Equal("books-export.csv", file.FileDownloadName);
        Assert.Equal("exported,csv\n", csv);
        mediator.Verify(
            mock => mock.Send(new GetAllBooksForExportQuery(0, 1, "author:Toika", "title", "asc"),
                It.IsAny<CancellationToken>()), Times.Once);
        mediator.Verify(
            mock => mock.Send(new GetAllBooksForExportQuery(0, 2, "author:Toika", "title", "asc"),
                It.IsAny<CancellationToken>()), Times.Once);
        exportService.Verify(service => service.Build(fullPage.Data), Times.Once);
    }

    [Fact]
    public async Task ExportBooks_ShouldUseFirstPageWhenNoBooksExist()
    {
        var mediator = new Mock<IMediator>();
        var exportService = new Mock<IBookCsvExportService>();
        var emptyPage = new PaginatedResult<BookDto> { Skip = 0, Take = 1, Total = 0, Data = [] };
        mediator.Setup(mock => mock.Send(It.IsAny<GetAllBooksForExportQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(emptyPage);
        exportService.Setup(service => service.Build(emptyPage.Data)).Returns("headers\n");
        var controller = CreateController(mediator.Object, exportService: exportService.Object);

        var result = await controller.ExportBooks(null, null, null);

        Assert.Equal("headers\n", Encoding.UTF8.GetString(Assert.IsType<FileContentResult>(result).FileContents));
        mediator.Verify(mock => mock.Send(It.IsAny<GetAllBooksForExportQuery>(), It.IsAny<CancellationToken>()),
            Times.Once);
    }

    [Fact]
    public async Task ExportFullBooks_ShouldIncludeCsvAndIdFreeManifest()
    {
        var mediator = new Mock<IMediator>();
        var exportService = new Mock<IBookCsvExportService>();
        var page = new PaginatedResult<BookDto> { Skip = 0, Take = 1, Total = 1, Data = [Book("Backup Book")] };
        var coverRepository = new Mock<IBookCoverRepository>();
        var coverStorage = new Mock<IBookCoverStorage>();
        mediator.Setup(mock => mock.Send(It.IsAny<GetAllBooksForExportQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(page);
        exportService.Setup(service => service.Build(page.Data)).Returns("primaryTitle\nBackup Book\n");
        coverRepository
            .Setup(repository => repository.GetByBookIdAsync(page.Data[0].Id, CancellationToken.None))
            .ReturnsAsync(new BookCover
            {
                BookId = page.Data[0].Id,
                StoragePath = "original.jpg",
                ThumbnailStoragePath = "thumbnail.webp",
                MimeType = "image/jpeg",
                ThumbnailMimeType = "image/webp"
            });
        coverStorage.Setup(storage => storage.OpenReadAsync("original.jpg", CancellationToken.None))
            .ReturnsAsync(new MemoryStream([1, 2, 3]));
        coverStorage.Setup(storage => storage.OpenReadAsync("thumbnail.webp", CancellationToken.None))
            .ReturnsAsync(new MemoryStream([4, 5]));
        var controller = CreateController(mediator.Object, exportService: exportService.Object,
            coverRepository: coverRepository.Object, coverStorage: coverStorage.Object);

        var result = await controller.ExportFullBooks(null, null, null, CancellationToken.None);

        var file = Assert.IsType<FileContentResult>(result);
        using var archiveStream = new MemoryStream(file.FileContents);
        using var archive = new ZipArchive(archiveStream, ZipArchiveMode.Read);
        Assert.NotNull(archive.GetEntry("books.csv"));
        var manifestEntry = archive.GetEntry("manifest.json");
        Assert.NotNull(manifestEntry);
        using var manifest = JsonDocument.Parse(manifestEntry!.Open());
        var item = Assert.Single(manifest.RootElement.GetProperty("Books").EnumerateArray());
        Assert.Equal("Backup Book", item.GetProperty("PrimaryTitle").GetString());
        Assert.Equal("Novel", item.GetProperty("ContentType").GetString());
        Assert.False(item.TryGetProperty("Id", out _));
        Assert.Equal("covers/000001/original.jpg", item.GetProperty("OriginalCoverPath").GetString());
        Assert.Equal("covers/000001/thumbnail.webp", item.GetProperty("ThumbnailCoverPath").GetString());
        Assert.NotNull(archive.GetEntry("covers/000001/original.jpg"));
        Assert.NotNull(archive.GetEntry("covers/000001/thumbnail.webp"));
    }

    [Fact]
    public async Task GetSummary_ShouldReturnMediatorSummary()
    {
        var expected = new BookSummaryDto
        {
            TotalBooks = 3,
            RatedBooks = 2,
            UnratedBooks = 1,
            AverageRating = 8.5,
            CurrentChapters = 480,
            BooksWithKnownCurrentChapter = 2,
            BooksWithoutKnownCurrentChapter = 1,
            StatusCounts =
            [
                new BookSummaryStatusCountDto { Status = "Reading", Count = 2 },
                new BookSummaryStatusCountDto { Status = "Completed", Count = 1 }
            ],
            TypeCounts =
            [
                new BookSummaryTypeCountDto { Type = "Novel", BookCount = 3, CurrentChapters = 480 }
            ],
            GenreCounts =
            [
                new BookSummaryGenreCountDto { Genre = "Fantasy", BookCount = 2 }
            ],
            RatingCounts =
            [
                new BookSummaryRatingCountDto { Rating = 8, BookCount = 1 },
                new BookSummaryRatingCountDto { Rating = 9, BookCount = 1 }
            ]
        };
        var mediator = new Mock<IMediator>();
        mediator
            .Setup(mock => mock.Send(new GetBookSummaryQuery("author:Toika"), It.IsAny<CancellationToken>()))
            .ReturnsAsync(expected);
        var controller = CreateController(mediator.Object);

        var result = await controller.GetSummary(new GetBookSummaryQuery("author:Toika"));

        var ok = Assert.IsType<OkObjectResult>(result);
        Assert.Same(expected, ok.Value);
    }

    [Fact]
    public async Task GetAnalytics_ShouldSendExplicitQueryStringFilters()
    {
        var expected = new BookAnalyticsDto
        {
            GeneratedAt = DateTimeOffset.UtcNow,
            Scope = new BookAnalyticsScopeDto
            {
                Query = "author:Toika",
                From = new DateOnly(2026, 1, 1),
                To = new DateOnly(2026, 2, 1),
                Bucket = "month"
            },
            Overview = new BookAnalyticsOverviewDto()
        };
        var mediator = new Mock<IMediator>();
        mediator
            .Setup(mock => mock.Send(
                new GetBookAnalyticsQuery("author:Toika", new DateOnly(2026, 1, 1), new DateOnly(2026, 2, 1), "month"),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(expected);
        var controller = CreateController(mediator.Object);

        var result = await controller.GetAnalytics(
            "author:Toika",
            new DateOnly(2026, 1, 1),
            new DateOnly(2026, 2, 1),
            "month");

        var ok = Assert.IsType<OkObjectResult>(result);
        Assert.Same(expected, ok.Value);
    }

    [Fact]
    public async Task UpdateProgressAndDelete_ShouldSendCommandsAndReturnNoContent()
    {
        var bookId = Guid.NewGuid();
        var mediator = new Mock<IMediator>();
        var controller = CreateController(mediator.Object);

        var progress =
            await controller.UpdateProgress(bookId, new UpdateBookProgressCommand(Guid.Empty, 12, "12", "done", true));
        var delete = await controller.Delete(bookId);

        Assert.IsType<NoContentResult>(progress);
        Assert.IsType<NoContentResult>(delete);
        mediator.Verify(mock => mock.Send(
            It.Is<UpdateBookProgressCommand>(command =>
                command.Id == bookId && command.CurrentChapterNumber == 12 && command.Comment == "done" && command.Completed),
            It.IsAny<CancellationToken>()), Times.Once);
        mediator.Verify(mock => mock.Send(new DeleteBookCommand(bookId), It.IsAny<CancellationToken>()), Times.Once);
    }

    private static BookController CreateController(
        IMediator? mediator = null,
        IBookCsvImportService? importService = null,
        IBookCsvExportService? exportService = null,
        IBookCoverRepository? coverRepository = null,
        IBookCoverStorage? coverStorage = null)
    {
        return new BookController(
            mediator ?? Mock.Of<IMediator>(),
            importService ?? Mock.Of<IBookCsvImportService>(),
            exportService ?? Mock.Of<IBookCsvExportService>(),
            coverRepository ?? Mock.Of<IBookCoverRepository>(),
            coverStorage ?? Mock.Of<IBookCoverStorage>(),
            NullLogger<BookController>.Instance)
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() }
        };
    }

    private static IFormFile CreateFormFile(string content, string fileName, string contentType = "text/csv")
    {
        var bytes = Encoding.UTF8.GetBytes(content);
        var stream = new MemoryStream(bytes);
        return new FormFile(stream, 0, bytes.Length, "file", fileName)
        {
            Headers = new HeaderDictionary(), ContentType = contentType
        };
    }

    private static BookDto Book(
        string title,
        string? author = null,
        string contentType = "Novel",
        string status = "Reading",
        IEnumerable<string>? genres = null,
        IEnumerable<string>? tags = null,
        string? notes = null)
    {
        return new BookDto
        {
            Id = Guid.NewGuid(),
            Created = DateTimeOffset.Parse("2026-01-01T00:00:00Z"),
            LastModified = DateTimeOffset.Parse("2026-01-02T00:00:00Z"),
            PrimaryTitle = title,
            AlternativeTitles = [],
            Author = author,
            ContentType = contentType,
            Status = status,
            ProgressHistory = [],
            Genres = genres?.ToList() ?? [],
            Tags = tags?.ToList() ?? [],
            Links = [],
            Notes = notes
        };
    }

    private static BookCoverDto Cover(string status)
    {
        return new BookCoverDto { Id = Guid.NewGuid(), Status = status, MimeType = "image/jpeg" };
    }

    private static CreateBookCommand CreateBookCommand(string title)
    {
        return new CreateBookCommand(
            title,
            Guid.NewGuid(),
            Guid.NewGuid(),
            null,
            null,
            [],
            [],
            [],
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            []);
    }

    private static UpdateBookCommand UpdateBookCommand(Guid id, string title)
    {
        return new UpdateBookCommand(
            id,
            title,
            Guid.NewGuid(),
            Guid.NewGuid(),
            null,
            null,
            [],
            [],
            [],
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            []);
    }

    private static string? ReadError(object? value)
    {
        return value?.GetType().GetProperty("error")?.GetValue(value) as string;
    }
}
