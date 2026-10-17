namespace Application.UnitTests;

using Common.DTOs.Book;
using Common.Interfaces;
using Common.Models;
using Domain.Entities;
using Domain.Exceptions;
using Domain.Models;
using Domain.Repositories;
using Features.BookFeatures.Queries.GetBook;
using FluentValidation;

public class BookQueryHandlerTests
{
    private static readonly Guid OwnerId = Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");

    [Fact]
    public async Task GetBooks_ShouldReturnCachedResultWithoutQueryingService()
    {
        var cached = PaginatedResult<BookListItemDto>.Create(0, 10, 1, [ListItem("Cached")]);
        var cache = new FakeBookListCache { Cached = cached };
        var service = new FakeBookListQueryService();
        var handler = new GetBooksQueryHandler(service, cache, new FakeUser());

        var result =
            await handler.Handle(new GetAllBooksQuery(0, 10, "title:Cached", "title", "asc"), CancellationToken.None);

        Assert.Same(cached, result);
        Assert.False(service.GetBooksCalled);
    }

    [Fact]
    public async Task GetBooks_ShouldAdvanceCyclicSortAndCacheResult()
    {
        var cache = new FakeBookListCache();
        var service = new FakeBookListQueryService
        {
            Books = [ListItem("Reading")], Count = 1, NextCycleSortDirection = "Completed"
        };
        var handler = new GetBooksQueryHandler(service, cache, new FakeUser());

        var result = await handler.Handle(
            new GetAllBooksQuery(0, 10, "status:reading", "status", "Reading", true), CancellationToken.None);

        Assert.Single(result.Data);
        Assert.Equal("Completed", service.SortDirectionUsed);
        Assert.Equal("Completed", cache.StoredSortDirection);
        Assert.NotNull(cache.Stored);
    }

    [Fact]
    public async Task GetManagedBooks_ShouldReturnCombinedServicePage()
    {
        var managedBook = new ManagedBookListItemDto
        {
            Book = ListItem("Listed"),
            Listing = new ManagedBookListingDto
            {
                Id = Guid.NewGuid(), SourceBookId = Guid.NewGuid(), SnapshotAt = DateTimeOffset.UtcNow
            }
        };
        var service = new FakeBookListQueryService { ManagedBooks = [managedBook], Count = 1 };
        var handler = new GetManagedBooksQueryHandler(service, new FakeUser());

        var result = await handler.Handle(
            new GetManagedBooksQuery(0, 50, "tag:fantasy"), CancellationToken.None);

        Assert.Equal(1, result.Total);
        Assert.Same(managedBook, Assert.Single(result.Data));
    }

    [Fact]
    public async Task GetAllAdminBooks_ShouldReturnServicePage()
    {
        var service = new FakeBookListQueryService
        {
            AdminBooks =
            [
                new AdminBookListItemDto
                {
                    Id = Guid.NewGuid(),
                    PrimaryTitle = "Admin",
                    ContentType = "Novel",
                    Status = "Reading",
                    OwnerId = OwnerId
                }
            ],
            AdminCount = 1
        };
        var handler = new GetAllAdminBooksHandler(service);

        var result =
            await handler.Handle(new GetAllAdminBooksQuery(5, 10, "status:reading", "title", "asc"),
                CancellationToken.None);

        Assert.Equal(5, result.Skip);
        Assert.Equal(10, result.Take);
        Assert.Equal(1, result.Total);
        Assert.Single(result.Data);
    }

    [Fact]
    public async Task GetBooksForExport_ShouldPassOwnerCriteriaAndPaging()
    {
        var exportService = new FakeBookExportQueryService();
        var handler = new GetBooksForExportQueryHandler(exportService, new FakeUser());

        var result =
            await handler.Handle(new GetAllBooksForExportQuery(2, 3, "rating:>=8", "rating", "desc"),
                CancellationToken.None);

        Assert.Equal(OwnerId, exportService.OwnerId);
        Assert.Equal(2, exportService.Skip);
        Assert.Equal(3, exportService.Take);
        Assert.Equal("rating", exportService.SortBy);
        Assert.Equal("desc", exportService.SortDirection);
        Assert.Single(result.Data);
    }

    [Fact]
    public async Task GetBook_ShouldReturnMappedBook()
    {
        var book = new Book
        {
            Id = Guid.NewGuid(),
            OwnerId = OwnerId,
            PrimaryTitle = "Book",
            NormalizedPrimaryTitle = "BOOK",
            ContentTypeId = Guid.NewGuid(),
            ContentType = new ContentType { Id = Guid.NewGuid(), Name = "Novel", Slug = "novel" },
            StatusId = Guid.NewGuid(),
            Status = new Status { Id = Guid.NewGuid(), Name = "Reading", Slug = "reading" }
        };
        var repository = new FakeSingleBookRepository(book);
        var handler = new GetBookHandler(repository, new FakeUser());

        var result = await handler.Handle(new GetBookQuery(book.Id), CancellationToken.None);

        Assert.Equal(book.Id, result.Id);
        Assert.Equal("Book", result.PrimaryTitle);
    }

    [Fact]
    public async Task GetBook_ShouldThrowWhenBookDoesNotExist()
    {
        var handler = new GetBookHandler(new FakeSingleBookRepository(null), new FakeUser());

        await Assert.ThrowsAsync<EntityNotFoundException<Book, Guid>>(() =>
            handler.Handle(new GetBookQuery(Guid.NewGuid()), CancellationToken.None));
    }

    [Fact]
    public async Task GetAdminBook_ShouldReturnMappedAdminBook()
    {
        var book = new Book
        {
            Id = Guid.NewGuid(),
            OwnerId = OwnerId,
            PrimaryTitle = "Admin Book",
            NormalizedPrimaryTitle = "ADMINBOOK",
            ContentTypeId = Guid.NewGuid(),
            ContentType = new ContentType { Id = Guid.NewGuid(), Name = "Novel", Slug = "novel" },
            StatusId = Guid.NewGuid(),
            Status = new Status { Id = Guid.NewGuid(), Name = "Reading", Slug = "reading" }
        };
        var handler = new GetAdminBookHandler(new FakeSingleBookRepository(book));

        var result = await handler.Handle(new GetAdminBookQuery(book.Id), CancellationToken.None);

        Assert.Equal(book.Id, result.Id);
        Assert.Equal(OwnerId, result.OwnerId);
    }

    [Fact]
    public async Task GetAdminBook_ShouldThrowWhenBookDoesNotExist()
    {
        var handler = new GetAdminBookHandler(new FakeSingleBookRepository(null));

        await Assert.ThrowsAsync<EntityNotFoundException<Book, Guid>>(() =>
            handler.Handle(new GetAdminBookQuery(Guid.NewGuid()), CancellationToken.None));
    }

    [Fact]
    public async Task GetBookAnalytics_ShouldApplyDefaultScopeAndOwner()
    {
        var service = new FakeBookAnalyticsQueryService();
        var handler = new GetBookAnalyticsHandler(service, new FakeUser());

        var result =
            await handler.Handle(new GetBookAnalyticsQuery("rating:none"), CancellationToken.None);

        Assert.Equal(OwnerId, service.OwnerId);
        Assert.Equal("rating:none", service.Scope!.Query);
        Assert.Equal("week", service.Scope.Bucket);
        Assert.Equal(84, service.Scope.To.DayNumber - service.Scope.From.DayNumber);
        Assert.Equal(0, result.Overview.TotalBooks);
        Assert.Empty(result.Composition.StatusByType);
        Assert.Empty(result.Composition.Genres);
        Assert.Empty(result.Composition.Tags);
    }

    [Theory]
    [InlineData("year")]
    [InlineData("quarter")]
    public async Task GetBookAnalytics_ShouldRejectInvalidBucket(string bucket)
    {
        var handler = new GetBookAnalyticsHandler(new FakeBookAnalyticsQueryService(), new FakeUser());

        await Assert.ThrowsAsync<ValidationException>(() =>
            handler.Handle(new GetBookAnalyticsQuery(Bucket: bucket), CancellationToken.None));
    }

    [Fact]
    public async Task GetBookAnalytics_ShouldRejectInvalidDateRange()
    {
        var handler = new GetBookAnalyticsHandler(new FakeBookAnalyticsQueryService(), new FakeUser());

        await Assert.ThrowsAsync<ValidationException>(() =>
            handler.Handle(new GetBookAnalyticsQuery(
                From: new DateOnly(2026, 7, 15),
                To: new DateOnly(2026, 7, 15)), CancellationToken.None));
    }

    [Fact]
    public async Task GetBookAnalytics_ShouldAllowBeginningRange()
    {
        var service = new FakeBookAnalyticsQueryService();
        var handler = new GetBookAnalyticsHandler(service, new FakeUser());

        await handler.Handle(new GetBookAnalyticsQuery(
            From: new DateOnly(1900, 1, 1),
            To: new DateOnly(2026, 7, 16)), CancellationToken.None);

        Assert.Equal(new DateOnly(1900, 1, 1), service.Scope!.From);
        Assert.Equal(new DateOnly(2026, 7, 16), service.Scope.To);
        Assert.Equal("month", service.Scope.Bucket);
    }

    [Fact]
    public async Task GetBookAnalytics_ShouldClampFromToAccountCreationDate()
    {
        var service = new FakeBookAnalyticsQueryService();
        var handler = new GetBookAnalyticsHandler(service,
            new FakeUser { CreatedAt = DateTimeOffset.Parse("2026-01-10T10:30:00Z") });

        await handler.Handle(new GetBookAnalyticsQuery(
            From: new DateOnly(1900, 1, 1),
            To: new DateOnly(2026, 2, 1),
            Bucket: "week"), CancellationToken.None);

        Assert.Equal(new DateOnly(2026, 1, 10), service.Scope!.From);
        Assert.Equal("week", service.Scope.Bucket);
    }

    private static BookListItemDto ListItem(string title)
    {
        return new BookListItemDto
        {
            Id = Guid.NewGuid(), PrimaryTitle = title, ContentType = "Novel", Status = "Reading"
        };
    }

    private sealed class FakeUser : IUser
    {
        public Guid? Id => OwnerId;
        public Guid RequiredId => OwnerId;
        public string? Email => "reader@example.com";
        public string? Username => "reader";
        public IEnumerable<string> Roles => [];
        public DateTimeOffset? CreatedAt { get; init; }
        public bool IsAuthenticated => true;
        public bool Valid => true;
    }

    private sealed class FakeBookListCache : IBookListCache
    {
        public PaginatedResult<BookListItemDto>? Cached { get; init; }
        public PaginatedResult<BookListItemDto>? Stored { get; private set; }
        public string? StoredSortDirection { get; private set; }

        public Task<PaginatedResult<BookListItemDto>?> GetBooksAsync(Guid ownerId, int skip, int take, string? query,
            string? sortBy, string? sortDirection, CancellationToken cancellationToken)
        {
            return Task.FromResult(Cached);
        }

        public Task SetBooksAsync(Guid ownerId, int skip, int take, string? query, string? sortBy,
            string? sortDirection, PaginatedResult<BookListItemDto> value, CancellationToken cancellationToken)
        {
            Stored = value;
            StoredSortDirection = sortDirection;
            return Task.CompletedTask;
        }
    }

    private sealed class FakeBookListQueryService : IBookListQueryService
    {
        public IReadOnlyCollection<BookListItemDto> Books { get; init; } = [];
        public IReadOnlyCollection<ManagedBookListItemDto> ManagedBooks { get; init; } = [];
        public IReadOnlyCollection<AdminBookListItemDto> AdminBooks { get; init; } = [];
        public int Count { get; init; }
        public int AdminCount { get; init; }
        public string? NextCycleSortDirection { get; init; }
        public string? SortDirectionUsed { get; private set; }
        public bool GetBooksCalled { get; private set; }

        public Task<IReadOnlyCollection<BookListItemDto>> GetBooksAsync(Guid ownerId, BookSearchCriteria criteria,
            int skip, int take, string? sortBy, string? sortDirection, CancellationToken cancellationToken)
        {
            GetBooksCalled = true;
            SortDirectionUsed = sortDirection;
            return Task.FromResult(Books);
        }

        public Task<int> GetBookCountAsync(Guid ownerId, BookSearchCriteria criteria,
            CancellationToken cancellationToken)
        {
            return Task.FromResult(Count);
        }

        public Task<IReadOnlyCollection<ManagedBookListItemDto>> GetManagedBooksAsync(
            Guid ownerId, BookSearchCriteria criteria, int skip, int take,
            CancellationToken cancellationToken)
        {
            return Task.FromResult(ManagedBooks);
        }

        public Task<IReadOnlyCollection<AdminBookListItemDto>> GetAdminBooksAsync(BookSearchCriteria criteria, int skip,
            int take, string? sortBy, string? sortDirection, CancellationToken cancellationToken)
        {
            return Task.FromResult(AdminBooks);
        }

        public Task<int> GetAdminBookCountAsync(BookSearchCriteria criteria, CancellationToken cancellationToken)
        {
            return Task.FromResult(AdminCount);
        }

        public Task<string?> GetNextCycleSortDirectionAsync(Guid ownerId, BookSearchCriteria criteria, string sortBy,
            string? currentSortDirection, CancellationToken cancellationToken)
        {
            return Task.FromResult(NextCycleSortDirection);
        }
    }

    private sealed class FakeBookExportQueryService : IBookExportQueryService
    {
        public Guid OwnerId { get; private set; }
        public int Skip { get; private set; }
        public int Take { get; private set; }
        public string? SortBy { get; private set; }
        public string? SortDirection { get; private set; }

        public Task<PaginatedResult<BookDto>> GetBooksForExportAsync(Guid ownerId, BookSearchCriteria criteria,
            int skip, int take, string? sortBy, string? sortDirection, CancellationToken cancellationToken)
        {
            OwnerId = ownerId;
            Skip = skip;
            Take = take;
            SortBy = sortBy;
            SortDirection = sortDirection;
            return Task.FromResult(PaginatedResult<BookDto>.Create(skip, take, 1,
            [
                new BookDto { Id = Guid.NewGuid(), PrimaryTitle = "Export", ContentType = "Novel", Status = "Reading" }
            ]));
        }
    }

    private sealed class FakeBookAnalyticsQueryService : IBookAnalyticsQueryService
    {
        public Guid OwnerId { get; private set; }
        public BookAnalyticsScopeSnapshot? Scope { get; private set; }

        public Task<BookAnalyticsSnapshot> GetAnalyticsAsync(
            Guid ownerId,
            BookSearchCriteria criteria,
            BookAnalyticsScopeSnapshot scope,
            CancellationToken cancellationToken)
        {
            OwnerId = ownerId;
            Scope = scope;
            return Task.FromResult(new BookAnalyticsSnapshot(
                DateTimeOffset.UtcNow,
                scope,
                new BookAnalyticsOverviewSnapshot(0, 0, 0, null, 0, 0, 0),
                BookAnalyticsCompositionSnapshot.Empty,
                BookAnalyticsRatingsSnapshot.Empty,
                BookAnalyticsPlanningSnapshot.Empty,
                BookAnalyticsProgressSnapshot.Empty,
                BookAnalyticsActivitySnapshot.Empty,
                BookAnalyticsLibraryGrowthSnapshot.Empty,
                BookAnalyticsQualitySnapshot.Empty));
        }
    }

    private sealed class FakeSingleBookRepository : IBookRepository
    {
        private readonly Book? _book;

        public FakeSingleBookRepository(Book? book)
        {
            _book = book;
        }

        public Task<Book?> GetByIdAsync(Guid id, Guid ownerId, CancellationToken cancellationToken)
        {
            return Task.FromResult(_book?.Id == id && _book.OwnerId == ownerId ? _book : null);
        }

        public Task<Book?> GetByIdAsync(Guid id, CancellationToken cancellationToken)
        {
            return Task.FromResult(_book?.Id == id ? _book : null);
        }

        public Task<Book?> GetForUpdateAsync(Guid id, Guid ownerId, CancellationToken cancellationToken)
        {
            return Task.FromResult<Book?>(null);
        }

        public Task<Book?> GetForUpdateAsync(Guid id, CancellationToken cancellationToken)
        {
            return Task.FromResult<Book?>(null);
        }

        public Task<Book?> GetByNameAsync(string name, Guid ownerId, Guid contentTypeId,
            CancellationToken cancellationToken)
        {
            return Task.FromResult<Book?>(null);
        }

        public Task<int> GetCountAsync(Guid ownerId, CancellationToken cancellationToken)
        {
            return Task.FromResult(0);
        }

        public Task<int> GetCountAsync(CancellationToken cancellationToken)
        {
            return Task.FromResult(0);
        }

        public Task<decimal?> GetTotalChaptersAsync(Guid id, Guid ownerId, CancellationToken cancellationToken)
        {
            return Task.FromResult<decimal?>(null);
        }

        public Task<bool> UpdateProgressAsync(Guid id, Guid ownerId, decimal? currentChapterNumber,
            string? currentChapterLabel, string? comment, CancellationToken cancellationToken, bool completed = false)
        {
            return Task.FromResult(false);
        }

        public Task AddAsync(Book book, CancellationToken cancellationToken)
        {
            return Task.CompletedTask;
        }

        public Task DeleteAsync(Guid id, Guid ownerId, CancellationToken cancellationToken)
        {
            return Task.CompletedTask;
        }

        public Task ReplaceEditableCollectionsAsync(Guid bookId, IEnumerable<BookTitle> titles,
            IEnumerable<BookLink> links, IEnumerable<Guid> genreIds, IEnumerable<Guid> tagIds,
            BookProgressHistory? progressHistory, CancellationToken cancellationToken)
        {
            return Task.CompletedTask;
        }

        public Task SaveAsync(CancellationToken cancellationToken)
        {
            return Task.CompletedTask;
        }
    }
}
