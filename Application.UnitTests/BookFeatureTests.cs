namespace Application.UnitTests;

using Common;
using Common.DTOs.Book;
using Common.Interfaces;
using Domain.Associations;
using Domain.Entities;
using Domain.Exceptions;
using Domain.Models;
using Domain.Repositories;
using Features.BookFeatures.Commands;
using Features.BookFeatures.Queries.GetBook;
using Features.BookFeatures.Validators;
using FluentValidation;

public class BookFeatureTests
{
    private static readonly Guid OwnerId = Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    private static readonly Guid ContentTypeId = Guid.Parse("10000000-0000-0000-0000-000000000001");
    private static readonly Guid StatusId = Guid.Parse("20000000-0000-0000-0000-000000000001");

    [Fact]
    public async Task CreateBook_ShouldStorePrimaryAndAlternativeTitles()
    {
        var fixture = CreateFixture();
        var command = ValidCreateCommand(new[] { new BookTitleInput("Everyone Else is a Returnee") });

        await fixture.Handler.Handle(command, CancellationToken.None);

        Assert.NotNull(fixture.BookRepository.LastBook);
        Assert.Equal("Na Bbaego Da Gwihwanja", fixture.BookRepository.LastBook.PrimaryTitle);
        Assert.Contains(fixture.BookRepository.LastBook.Titles,
            t => t.IsPrimary && t.Title == "Na Bbaego Da Gwihwanja");
        Assert.Contains(fixture.BookRepository.LastBook.Titles,
            t => !t.IsPrimary && t.Title == "Everyone Else is a Returnee");
        Assert.NotNull(fixture.BookRepository.LastBook.Cover);
        Assert.Equal(BookCoverStatus.Pending, fixture.BookRepository.LastBook.Cover.Status);
        Assert.Equal(fixture.BookRepository.LastBook.Id, fixture.BookCoverQueue.QueuedBookId);
    }

    [Fact]
    public async Task CreateBook_ShouldQueueAnInitialManualCoverUrl()
    {
        var fixture = CreateFixture();
        var command = ValidCreateCommand() with { InitialCoverUrl = "https://cdn.example.com/covers/returnee.jpg" };

        await fixture.Handler.Handle(command, CancellationToken.None);

        var cover = Assert.IsType<BookCover>(fixture.BookRepository.LastBook!.Cover);
        Assert.Equal(BookCoverStatus.Pending, cover.Status);
        Assert.Equal(BookCoverSource.ManualUrl, cover.Source);
        Assert.Equal("https://cdn.example.com/covers/returnee.jpg", cover.OriginalImageUrl);
        Assert.Equal(fixture.BookRepository.LastBook.Id, fixture.BookCoverQueue.QueuedBookId);
    }

    [Fact]
    public async Task CreateBook_ShouldKeepAnInitialManualUploadPendingForTheBrowserOutbox()
    {
        var fixture = CreateFixture();
        var token = Guid.NewGuid();
        var command = ValidCreateCommand() with { InitialCoverUploadToken = token };

        await fixture.Handler.Handle(command, CancellationToken.None);

        var cover = Assert.IsType<BookCover>(fixture.BookRepository.LastBook!.Cover);
        Assert.Equal(BookCoverStatus.Pending, cover.Status);
        Assert.Equal(BookCoverSource.ManualUpload, cover.Source);
        Assert.Equal(token, cover.PendingUploadToken);
    }

    [Fact]
    public async Task CreateBook_ShouldIgnoreAlternativeTitlesThatNormalizeToAnExistingTitle()
    {
        var fixture = CreateFixture();
        var command = ValidCreateCommand(new[]
            {
                new BookTitleInput("MEMORIZE"), new BookTitleInput("m e m o r i z e"),
                new BookTitleInput("Memorize: The Second Coming")
            }) with
            {
                PrimaryTitle = "MEMORIZE"
            };

        await fixture.Handler.Handle(command, CancellationToken.None);

        var titles = fixture.BookRepository.LastBook!.Titles;
        Assert.Equal(2, titles.Count);
        Assert.Contains(titles, title => title.IsPrimary && title.Title == "MEMORIZE");
        Assert.Contains(titles, title => !title.IsPrimary && title.Title == "Memorize: The Second Coming");
    }

    [Fact]
    public async Task CreateBook_ShouldCreateAuthorFromName()
    {
        var fixture = CreateFixture();
        var command = ValidCreateCommand(authorName: "Toika");

        await fixture.Handler.Handle(command, CancellationToken.None);

        Assert.Single(fixture.AuthorRepository.Authors);
        Assert.Equal("Toika", fixture.AuthorRepository.Authors[0].PrimaryName);
        Assert.Equal(fixture.AuthorRepository.Authors[0].Id, fixture.BookRepository.LastBook!.AuthorId);
    }

    [Fact]
    public async Task CreateBook_ShouldPreserveDescriptionLineBreaks()
    {
        var fixture = CreateFixture();
        var command = ValidCreateCommand() with { Description = "First paragraph.\n\nSecond paragraph." };

        await fixture.Handler.Handle(command, CancellationToken.None);

        Assert.Equal("First paragraph.\n\nSecond paragraph.", fixture.BookRepository.LastBook!.Description);
    }

    [Fact]
    public async Task ResolveTags_ShouldReuseExistingTagForNearIdenticalImportedName()
    {
        var fixture = CreateFixture();
        var existing = new Tag
        {
            OwnerId = OwnerId,
            Name = "Slice Of Life",
            NormalizedName = MappingExtensions.NormalizeName("Slice Of Life")
        };
        await fixture.TagRepository.AddAsync(existing, CancellationToken.None);

        await fixture.Handler.Handle(
            ValidCreateCommand(tags: ["SLICEOFLIFEE"]),
            CancellationToken.None);

        Assert.Same(existing, Assert.Single(fixture.BookRepository.LastBook!.BookTags).Tag);
    }

    [Fact]
    public async Task CreateBook_ShouldUseCurrentChapterAsTotalWhenCompletedTotalIsMissing()
    {
        var completed = new Status { Id = StatusId, Name = "Completed", Slug = "completed" };
        var fixture = CreateFixture(completed);

        await fixture.Handler.Handle(ValidCreateCommand(currentChapterNumber: 42), CancellationToken.None);

        Assert.Equal(42, fixture.BookRepository.LastBook!.TotalChapters);
    }

    [Fact]
    public async Task CreateBook_ShouldKeepExplicitTotalWhenCompleted()
    {
        var completed = new Status { Id = StatusId, Name = "Completed", Slug = "completed" };
        var fixture = CreateFixture(completed);
        var command = ValidCreateCommand(currentChapterNumber: 42) with { TotalChapters = 50 };

        await fixture.Handler.Handle(command, CancellationToken.None);

        Assert.Equal(50, fixture.BookRepository.LastBook!.TotalChapters);
    }

    [Fact]
    public async Task CreateBook_ShouldStoreLinksTagsAndInitialProgressHistory()
    {
        var fixture = CreateFixture();
        var command = ValidCreateCommand(
            tags: new[] { "favorite", "cultivation" },
            links: new[] { new BookLinkInput("https://novelupdates.com/example", "NU", "NovelUpdates", true, true) },
            currentChapterNumber: 348,
            currentChapterLabel: "ex4");
        command = command with { Notes = "Private notes" };

        await fixture.Handler.Handle(command, CancellationToken.None);

        var book = fixture.BookRepository.LastBook!;
        Assert.Equal(2, book.BookTags.Count);
        Assert.Single(book.Links);
        Assert.Single(book.ProgressHistory);
        Assert.Equal("Private notes", book.Notes);
        Assert.Equal(348, book.ProgressHistory.First().ChapterNumber);
        Assert.Equal("ex4", book.ProgressHistory.First().ChapterLabel);
    }

    [Fact]
    public async Task CreateBook_ShouldThrowWhenTitleAlreadyExists()
    {
        var fixture = CreateFixture();
        fixture.BookRepository.Seed(new Book
        {
            Id = Guid.NewGuid(),
            OwnerId = OwnerId,
            PrimaryTitle = "Na Bbaego Da Gwihwanja",
            NormalizedPrimaryTitle = "NABBAEGODAGWIHWANJA",
            ContentTypeId = ContentTypeId,
            StatusId = StatusId
        });
        var command = ValidCreateCommand();

        await Assert.ThrowsAsync<EntityAlreadyExistsException<Book, Guid>>(() =>
            fixture.Handler.Handle(command, CancellationToken.None));
    }

    [Fact]
    public async Task CreateBook_ShouldAllowTitleThatOnlyMatchesInsideAnotherTitle()
    {
        var fixture = CreateFixture();
        fixture.BookRepository.Seed(new Book
        {
            Id = Guid.NewGuid(),
            OwnerId = OwnerId,
            PrimaryTitle = "History's Greatest Husband",
            NormalizedPrimaryTitle = "HISTORY'SGREATESTHUSBAND",
            ContentTypeId = ContentTypeId,
            StatusId = StatusId
        });

        await fixture.Handler.Handle(ValidCreateCommand() with { PrimaryTitle = "test" }, CancellationToken.None);

        Assert.Equal("test", fixture.BookRepository.LastBook!.PrimaryTitle);
    }

    [Fact]
    public async Task UpdateBook_ShouldReplaceEditableDetailsAndAppendProgressHistory()
    {
        var fixture = CreateFixture();
        var book = new Book
        {
            Id = Guid.NewGuid(),
            OwnerId = OwnerId,
            PrimaryTitle = "Old Title",
            NormalizedPrimaryTitle = "OLDTITLE",
            ContentTypeId = ContentTypeId,
            StatusId = StatusId,
            CurrentChapterNumber = 1,
            CurrentChapterLabel = "1"
        };
        book.Titles.Add("Old Title".ToPrimaryTitle());
        book.Links.Add(new BookLink { Url = "https://old.example.com", SourceType = "Other" });
        fixture.BookRepository.Seed(book);
        var handler = new UpdateBookHandler(
            fixture.BookRepository,
            fixture.AuthorRepository,
            new FakeTypeRepository(),
            new FakeStatusRepository(),
            new FakeGenreRepository(),
            new FakeTagRepository(),
            new FakeBookListCacheInvalidator(),
            new FakeUser());
        var command = new UpdateBookCommand(
            book.Id,
            "New Title",
            ContentTypeId,
            StatusId,
            null,
            "Toika",
            new[] { new BookTitleInput("New Alias") },
            null,
            new[] { "favorite" },
            100,
            20,
            "20",
            8,
            2,
            "Description",
            "Notes",
            null,
            new[] { new BookLinkInput("https://new.example.com", "New", "Other", true, true) });

        await handler.Handle(command, CancellationToken.None);

        Assert.Equal("New Title", book.PrimaryTitle);
        Assert.Contains(book.Titles, t => t.IsPrimary && t.Title == "New Title");
        Assert.Contains(book.Titles, t => !t.IsPrimary && t.Title == "New Alias");
        Assert.Single(book.Links);
        Assert.Equal("https://new.example.com", book.Links.First().Url);
        Assert.Single(book.BookTags);
        Assert.Single(book.ProgressHistory);
        Assert.Equal(20, book.ProgressHistory.First().ChapterNumber);
        Assert.True(fixture.BookRepository.Saved);
    }

    [Fact]
    public async Task UpdateBook_ShouldUseCurrentChapterAsTotalWhenChangedToCompleted()
    {
        var fixture = CreateFixture();
        var book = new Book
        {
            Id = Guid.NewGuid(),
            OwnerId = OwnerId,
            PrimaryTitle = "Finishing Book",
            NormalizedPrimaryTitle = "FINISHINGBOOK",
            ContentTypeId = ContentTypeId,
            StatusId = StatusId,
            CurrentChapterNumber = 20
        };
        fixture.BookRepository.Seed(book);
        var completed = new Status { Id = StatusId, Name = "Completed", Slug = "completed" };
        var handler = new UpdateBookHandler(
            fixture.BookRepository,
            fixture.AuthorRepository,
            new FakeTypeRepository(),
            new FakeStatusRepository(completed),
            new FakeGenreRepository(),
            new FakeTagRepository(),
            new FakeBookListCacheInvalidator(),
            new FakeUser());
        var command = new UpdateBookCommand(
            book.Id, "Finishing Book", ContentTypeId, StatusId, null, null, null, null, null,
            null, 24, "24", null, null, null, null, null, null);

        await handler.Handle(command, CancellationToken.None);

        Assert.Equal(24, book.TotalChapters);
    }

    [Fact]
    public async Task UpdateBook_ShouldAllowAdminScopeToUpdateBookOwnedByAnotherUser()
    {
        var fixture = CreateFixture();
        var otherOwnerId = Guid.Parse("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
        var book = new Book
        {
            Id = Guid.NewGuid(),
            OwnerId = otherOwnerId,
            PrimaryTitle = "Other Owner Book",
            NormalizedPrimaryTitle = "OTHEROWNERBOOK",
            ContentTypeId = ContentTypeId,
            StatusId = StatusId
        };
        book.Titles.Add("Other Owner Book".ToPrimaryTitle());
        fixture.BookRepository.Seed(book);
        var handler = new UpdateBookHandler(
            fixture.BookRepository,
            fixture.AuthorRepository,
            new FakeTypeRepository(),
            new FakeStatusRepository(),
            new FakeGenreRepository(),
            new FakeTagRepository(),
            new FakeBookListCacheInvalidator(),
            new FakeUser());
        var command = new UpdateBookCommand(
            book.Id,
            "Admin Updated",
            ContentTypeId,
            StatusId,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null) { AdminScope = true };

        await handler.Handle(command, CancellationToken.None);

        Assert.Equal("Admin Updated", book.PrimaryTitle);
        Assert.Equal(otherOwnerId, book.OwnerId);
        Assert.True(fixture.BookRepository.Saved);
    }

    [Fact]
    public async Task UpdateBook_ShouldRejectNonAdminScopeForBookOwnedByAnotherUser()
    {
        var fixture = CreateFixture();
        var book = new Book
        {
            Id = Guid.NewGuid(),
            OwnerId = Guid.Parse("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"),
            PrimaryTitle = "Other Owner Book",
            NormalizedPrimaryTitle = "OTHEROWNERBOOK",
            ContentTypeId = ContentTypeId,
            StatusId = StatusId
        };
        fixture.BookRepository.Seed(book);
        var handler = new UpdateBookHandler(
            fixture.BookRepository,
            fixture.AuthorRepository,
            new FakeTypeRepository(),
            new FakeStatusRepository(),
            new FakeGenreRepository(),
            new FakeTagRepository(),
            new FakeBookListCacheInvalidator(),
            new FakeUser());
        var command = new UpdateBookCommand(
            book.Id,
            "User Updated",
            ContentTypeId,
            StatusId,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null);

        await Assert.ThrowsAsync<EntityNotFoundException<Book, Guid>>(() =>
            handler.Handle(command, CancellationToken.None));
    }

    [Fact]
    public async Task UpdateProgress_ShouldRejectChapterGreaterThanTotal()
    {
        var fixture = CreateFixture();
        var book = new Book
        {
            Id = Guid.NewGuid(),
            OwnerId = OwnerId,
            PrimaryTitle = "Old Title",
            NormalizedPrimaryTitle = "OLDTITLE",
            ContentTypeId = ContentTypeId,
            StatusId = StatusId,
            TotalChapters = 10
        };
        fixture.BookRepository.Seed(book);
        var handler =
            new UpdateBookProgressHandler(fixture.BookRepository, new FakeBookListCacheInvalidator(), new FakeUser());

        await Assert.ThrowsAsync<ValidationException>(() =>
            handler.Handle(new UpdateBookProgressCommand(book.Id, 11, "11", "too much"), CancellationToken.None));
    }

    [Fact]
    public void CreateBookValidator_ShouldRejectInvalidFrontendInput()
    {
        var command = ValidCreateCommand(
            links: new[] { new BookLinkInput("not-a-url") },
            currentChapterNumber: 11);
        command = command with { TotalChapters = 10, Rating = 11, Priority = 0 };
        var validator = new CreateBookCommandValidator();

        var result = validator.Validate(command);

        Assert.False(result.IsValid);
        Assert.Contains(result.Errors, e => e.PropertyName == "CurrentChapterNumber");
        Assert.Contains(result.Errors, e => e.PropertyName == "Rating");
        Assert.Contains(result.Errors, e => e.PropertyName == "Priority");
        Assert.Contains(result.Errors, e => e.PropertyName == "Links[0].Url");
    }

    [Fact]
    public void CreateBookValidator_ShouldRejectZeroTotalChapters()
    {
        var validator = new CreateBookCommandValidator();
        var command = ValidCreateCommand() with { TotalChapters = 0 };

        var result = validator.Validate(command);

        Assert.False(result.IsValid);
        Assert.Contains(result.Errors,
            e => e.PropertyName == "TotalChapters" && e.ErrorMessage == "Total chapters must be greater than 0.");
    }

    [Fact]
    public void CreateBookValidator_ShouldRejectWhitespaceOnlyPrimaryTitle()
    {
        var validator = new CreateBookCommandValidator();
        var command = ValidCreateCommand() with { PrimaryTitle = "   " };

        var result = validator.Validate(command);

        Assert.False(result.IsValid);
        Assert.Contains(result.Errors, e => e.PropertyName == "PrimaryTitle" && e.ErrorMessage == "Title is required.");
    }

    [Fact]
    public void UpdateBookValidator_ShouldRejectWhitespaceOnlyPrimaryTitle()
    {
        var validator = new UpdateBookCommandValidator();
        var command = new UpdateBookCommand(
            Guid.NewGuid(),
            "   ",
            ContentTypeId,
            StatusId,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null);

        var result = validator.Validate(command);

        Assert.False(result.IsValid);
        Assert.Contains(result.Errors, e => e.PropertyName == "PrimaryTitle" && e.ErrorMessage == "Title is required.");
    }

    [Fact]
    public void CreateBookValidator_ShouldRejectOverlongScalarFields()
    {
        var validator = new CreateBookCommandValidator();
        var command = ValidCreateCommand(authorName: new string('a', 301)) with
        {
            PrimaryTitle = new string('t', 501),
            CurrentChapterLabel = new string('c', 101),
            Description = new string('d', 4001),
            Notes = new string('n', 4001),
            RawImportedLine = new string('r', 4001)
        };

        var result = validator.Validate(command);

        Assert.False(result.IsValid);
        Assert.Contains(result.Errors,
            e => e.PropertyName == "PrimaryTitle" && e.ErrorMessage == "Title must be 500 characters or fewer.");
        Assert.Contains(result.Errors, e => e.PropertyName == "AuthorName");
        Assert.Contains(result.Errors, e => e.PropertyName == "CurrentChapterLabel");
        Assert.Contains(result.Errors, e => e.PropertyName == "Description");
        Assert.Contains(result.Errors, e => e.PropertyName == "Notes");
        Assert.Contains(result.Errors, e => e.PropertyName == "RawImportedLine");
    }

    [Fact]
    public void CreateBookValidator_ShouldRejectInvalidAlternativeTitlesTagsAndLinks()
    {
        var validator = new CreateBookCommandValidator();
        var command = ValidCreateCommand(
            [
                new BookTitleInput(" ", "pl", "Manual"),
                new BookTitleInput(new string('t', 501), new string('l', 11), new string('s', 51))
            ],
            tags: [" ", new string('x', 101)],
            links:
            [
                new BookLinkInput(""),
                new BookLinkInput("ftp://example.com/cover.jpg", new string('l', 201), ""),
                new BookLinkInput(new string('h', 2001), "label", new string('s', 51))
            ]);

        var result = validator.Validate(command);

        Assert.False(result.IsValid);
        Assert.Contains(result.Errors, e => e.PropertyName == "AlternativeTitles[0].Title");
        Assert.Contains(result.Errors, e => e.PropertyName == "AlternativeTitles[1].Title");
        Assert.Contains(result.Errors, e => e.PropertyName == "AlternativeTitles[1].Language");
        Assert.Contains(result.Errors, e => e.PropertyName == "AlternativeTitles[1].Source");
        Assert.Contains(result.Errors, e => e.PropertyName == "Tags[0]");
        Assert.Contains(result.Errors, e => e.PropertyName == "Tags[1]");
        Assert.Contains(result.Errors, e => e.PropertyName == "Links[0].Url");
        Assert.Contains(result.Errors, e => e.PropertyName == "Links[1].Url");
        Assert.Contains(result.Errors, e => e.PropertyName == "Links[1].Label");
        Assert.Contains(result.Errors, e => e.PropertyName == "Links[1].SourceType");
        Assert.Contains(result.Errors, e => e.PropertyName == "Links[2].Url");
        Assert.Contains(result.Errors, e => e.PropertyName == "Links[2].SourceType");
    }

    [Fact]
    public void UpdateBookProgressValidator_ShouldRejectNegativeChapterNumber()
    {
        var validator = new UpdateBookProgressCommandValidator();
        var command = new UpdateBookProgressCommand(Guid.NewGuid(), -1, "-1", null);

        var result = validator.Validate(command);

        Assert.False(result.IsValid);
        Assert.Contains(result.Errors, e => e.PropertyName == "CurrentChapterNumber");
    }

    [Fact]
    public void UpdateBookProgressValidator_ShouldRejectOverlongLabelAndComment()
    {
        var validator = new UpdateBookProgressCommandValidator();
        var command = new UpdateBookProgressCommand(
            Guid.NewGuid(),
            1,
            new string('x', 101),
            new string('x', 1001));

        var result = validator.Validate(command);

        Assert.False(result.IsValid);
        Assert.Contains(result.Errors,
            e => e.PropertyName == "CurrentChapterLabel" &&
                 e.ErrorMessage == "Chapter label must be 100 characters or fewer.");
        Assert.Contains(result.Errors,
            e => e.PropertyName == "Comment" && e.ErrorMessage == "Comment must be 1000 characters or fewer.");
    }

    [Fact]
    public async Task UpdateProgress_ShouldIgnoreLegacyZeroTotalChapters()
    {
        var fixture = CreateFixture();
        var book = new Book
        {
            Id = Guid.NewGuid(),
            OwnerId = OwnerId,
            PrimaryTitle = "Old Title",
            NormalizedPrimaryTitle = "OLDTITLE",
            ContentTypeId = ContentTypeId,
            StatusId = StatusId,
            TotalChapters = 0
        };
        fixture.BookRepository.Seed(book);
        var handler =
            new UpdateBookProgressHandler(fixture.BookRepository, new FakeBookListCacheInvalidator(), new FakeUser());

        await handler.Handle(new UpdateBookProgressCommand(book.Id, 11, "11", null), CancellationToken.None);

        Assert.Equal(11, book.CurrentChapterNumber);
    }

    [Fact]
    public async Task GetBookSummary_ShouldMapRepositoryAggregateIntoDto()
    {
        var summaryQueryService = new FakeBookSummaryQueryService
        {
            Summary = new BookSummarySnapshot(
                4,
                3,
                8.333333333,
                900,
                3,
                [
                    new BookStatusCountSnapshot("Reading", 2),
                    new BookStatusCountSnapshot("Completed", 2)
                ],
                [
                    new BookTypeSummarySnapshot("Novel", 3, 900)
                ],
                [
                    new BookGenreCountSnapshot("Fantasy", 2)
                ],
                [
                    new BookRatingCountSnapshot(8, 1),
                    new BookRatingCountSnapshot(9, 2)
                ])
        };
        var handler = new GetBookSummaryHandler(summaryQueryService, new FakeUser());

        var result = await handler.Handle(new GetBookSummaryQuery("author:Toika"), CancellationToken.None);

        Assert.Equal(4, result.TotalBooks);
        Assert.Equal(3, result.RatedBooks);
        Assert.Equal(1, result.UnratedBooks);
        Assert.Equal(8.333333333, result.AverageRating);
        Assert.Equal(900, result.CurrentChapters);
        Assert.Equal(3, result.BooksWithKnownCurrentChapter);
        Assert.Equal(1, result.BooksWithoutKnownCurrentChapter);
        Assert.Equal(2, result.StatusCounts.Count);
        Assert.Equal("Reading", result.StatusCounts[0].Status);
        Assert.Equal("Novel", result.TypeCounts[0].Type);
        Assert.Equal("Fantasy", result.GenreCounts[0].Genre);
        Assert.Equal(9, result.RatingCounts[1].Rating);
    }

    private static Fixture CreateFixture(Status? status = null)
    {
        var bookRepository = new FakeBookRepository();
        var authorRepository = new FakeAuthorRepository();
        var typeRepository = new FakeTypeRepository();
        var statusRepository = new FakeStatusRepository(status);
        var genreRepository = new FakeGenreRepository();
        var tagRepository = new FakeTagRepository();
        var user = new FakeUser();
        var bookCoverQueue = new FakeBookCoverQueue();
        var handler = new CreateBookHandler(
            bookRepository,
            authorRepository,
            typeRepository,
            statusRepository,
            genreRepository,
            tagRepository,
            bookCoverQueue,
            new FakeBookListCacheInvalidator(),
            user);
        return new Fixture(bookRepository, authorRepository, tagRepository, bookCoverQueue, handler);
    }

    private static CreateBookCommand ValidCreateCommand(
        IEnumerable<BookTitleInput>? alternativeTitles = null,
        string? authorName = null,
        IEnumerable<string>? tags = null,
        IEnumerable<BookLinkInput>? links = null,
        decimal? currentChapterNumber = null,
        string? currentChapterLabel = null)
    {
        return new CreateBookCommand(
            "Na Bbaego Da Gwihwanja",
            ContentTypeId,
            StatusId,
            null,
            authorName,
            alternativeTitles,
            null,
            tags,
            null,
            currentChapterNumber,
            currentChapterLabel,
            9,
            1,
            null,
            null,
            null,
            links);
    }

    private sealed record Fixture(
        FakeBookRepository BookRepository,
        FakeAuthorRepository AuthorRepository,
        FakeTagRepository TagRepository,
        FakeBookCoverQueue BookCoverQueue,
        CreateBookHandler Handler);

    private sealed class FakeUser : IUser
    {
        public Guid? Id => OwnerId;
        public Guid RequiredId => OwnerId;
        public string? Email => "reader@example.com";
        public string? Username => "reader";
        public IEnumerable<string> Roles => Array.Empty<string>();
        public bool IsAuthenticated => true;
        public bool Valid => true;
    }

    private sealed class FakeBookRepository : IBookRepository
    {
        public Book? LastBook { get; private set; }
        public bool Saved { get; private set; }

        public Task AddAsync(Book book, CancellationToken cancellationToken)
        {
            LastBook = book;
            return Task.CompletedTask;
        }

        public Task DeleteAsync(Guid id, Guid ownerId, CancellationToken cancellationToken)
        {
            return Task.CompletedTask;
        }

        public Task<Book?> GetByIdAsync(Guid id, Guid ownerId, CancellationToken cancellationToken)
        {
            return Task.FromResult(LastBook?.Id == id && LastBook.OwnerId == ownerId ? LastBook : null);
        }

        public Task<Book?> GetByIdAsync(Guid id, CancellationToken cancellationToken)
        {
            return Task.FromResult(LastBook?.Id == id ? LastBook : null);
        }

        public Task<Book?> GetForUpdateAsync(Guid id, Guid ownerId, CancellationToken cancellationToken)
        {
            return GetByIdAsync(id, ownerId, cancellationToken);
        }

        public Task<Book?> GetForUpdateAsync(Guid id, CancellationToken cancellationToken)
        {
            return GetByIdAsync(id, cancellationToken);
        }

        public Task<Book?> GetByNameAsync(string name, Guid ownerId, Guid contentTypeId,
            CancellationToken cancellationToken)
        {
            var normalized = MappingExtensions.NormalizeName(name);
            var match = LastBook != null &&
                        LastBook.OwnerId == ownerId &&
                        LastBook.ContentTypeId == contentTypeId &&
                        (LastBook.NormalizedPrimaryTitle == normalized ||
                         LastBook.Titles.Any(t => t.NormalizedTitle == normalized));
            return Task.FromResult(match ? LastBook : null);
        }

        public Task<int> GetCountAsync(Guid ownerId, CancellationToken cancellationToken)
        {
            return Task.FromResult(LastBook == null ? 0 : 1);
        }

        public Task ReplaceEditableCollectionsAsync(
            Guid bookId,
            IEnumerable<BookTitle> titles,
            IEnumerable<BookLink> links,
            IEnumerable<Guid> genreIds,
            IEnumerable<Guid> tagIds,
            BookProgressHistory? progressHistory,
            CancellationToken cancellationToken)
        {
            if (LastBook == null || LastBook.Id != bookId)
            {
                return Task.CompletedTask;
            }

            LastBook.Titles.Clear();
            foreach (var title in titles)
            {
                title.BookId = bookId;
                LastBook.Titles.Add(title);
            }

            LastBook.Links.Clear();
            foreach (var link in links)
            {
                link.BookId = bookId;
                LastBook.Links.Add(link);
            }

            LastBook.BookGenres.Clear();
            foreach (var genreId in genreIds.Distinct())
            {
                LastBook.BookGenres.Add(new BookGenre { BookId = bookId, GenreId = genreId });
            }

            LastBook.BookTags.Clear();
            foreach (var tagId in tagIds.Distinct())
            {
                LastBook.BookTags.Add(new BookTag { BookId = bookId, TagId = tagId });
            }

            if (progressHistory != null)
            {
                progressHistory.BookId = bookId;
                LastBook.ProgressHistory.Add(progressHistory);
            }

            return Task.CompletedTask;
        }

        public Task<bool> UpdateProgressAsync(
            Guid id,
            Guid ownerId,
            decimal? currentChapterNumber,
            string? currentChapterLabel,
            string? comment,
            CancellationToken cancellationToken,
            bool completed = false)
        {
            if (LastBook == null || LastBook.Id != id || LastBook.OwnerId != ownerId)
            {
                throw new EntityNotFoundException<Book, Guid>(id);
            }

            LastBook.CurrentChapterNumber = currentChapterNumber;
            LastBook.CurrentChapterLabel = currentChapterLabel;
            if (currentChapterNumber.HasValue || !string.IsNullOrWhiteSpace(currentChapterLabel) ||
                !string.IsNullOrWhiteSpace(comment))
            {
                LastBook.ProgressHistory.Add(new BookProgressHistory
                {
                    BookId = id,
                    ChapterNumber = currentChapterNumber,
                    ChapterLabel = currentChapterLabel,
                    Comment = comment
                });
            }

            Saved = true;
            return Task.FromResult(true);
        }

        public Task SaveAsync(CancellationToken cancellationToken)
        {
            Saved = true;
            return Task.CompletedTask;
        }

        public void Seed(Book book)
        {
            LastBook = book;
        }
    }

    private sealed class FakeBookCoverQueue : IBookCoverQueue
    {
        public Guid? QueuedBookId { get; private set; }

        public ValueTask QueueAsync(Guid bookId, CancellationToken cancellationToken)
        {
            QueuedBookId = bookId;
            return ValueTask.CompletedTask;
        }
    }

    private sealed class FakeBookListCacheInvalidator : IBookListCacheInvalidator
    {
        public Task InvalidateBooksAsync(Guid ownerId, CancellationToken cancellationToken)
        {
            return Task.CompletedTask;
        }
    }

    private sealed class FakeBookSummaryQueryService : IBookSummaryQueryService
    {
        public BookSummarySnapshot Summary { get; set; } = new(0, 0, null, 0, 0, [], [], [], []);

        public Task<BookSummarySnapshot> GetSummaryAsync(Guid ownerId, BookSearchCriteria criteria,
            CancellationToken cancellationToken)
        {
            return Task.FromResult(Summary);
        }
    }

    private sealed class FakeAuthorRepository : IAuthorRepository
    {
        public List<Author> Authors { get; } = new();

        public Task AddAsync(Author author, CancellationToken cancellationToken)
        {
            Authors.Add(author);
            return Task.CompletedTask;
        }

        public void AddName(Author author, AuthorName name)
        {
            author.Names.Add(name);
        }

        public Task DeleteAsync(Author author, CancellationToken cancellationToken)
        {
            Authors.Remove(author);
            return Task.CompletedTask;
        }

        public Task<Author?> GetByIdAsync(Guid id, CancellationToken cancellationToken)
        {
            return Task.FromResult(Authors.FirstOrDefault(a => a.Id == id));
        }

        public Task<Author?> GetByNameAsync(Guid ownerId, string name, CancellationToken cancellationToken)
        {
            return Task.FromResult(Authors.FirstOrDefault(a =>
                a.NormalizedPrimaryName == MappingExtensions.NormalizeName(name) ||
                a.Names.Any(alias => alias.NormalizedName == MappingExtensions.NormalizeName(name))));
        }

        public Task<Author?> GetPublicByNameAsync(string name, CancellationToken cancellationToken)
        {
            return GetByNameAsync(Guid.Empty, name, cancellationToken);
        }

        public Task<IEnumerable<Author>> SearchAsync(Guid ownerId, string? search, int take,
            CancellationToken cancellationToken, int skip = 0)
        {
            return Task.FromResult<IEnumerable<Author>>(Authors.Take(take));
        }

        public Task<IEnumerable<Author>> SearchOwnedAsync(Guid ownerId, string? search, int take,
            CancellationToken cancellationToken, int skip = 0)
        {
            return Task.FromResult<IEnumerable<Author>>(Authors.Where(author => author.OwnerId == ownerId)
                .Take(take));
        }

        public Task SaveAsync(CancellationToken cancellationToken)
        {
            return Task.CompletedTask;
        }
    }

    private sealed class FakeTypeRepository : ITypeRepository
    {
        private readonly ContentType _type = new() { Id = ContentTypeId, Name = "Novel", Slug = "novel" };

        public Task AddAsync(ContentType type, CancellationToken cancellationToken)
        {
            return Task.CompletedTask;
        }

        public Task DeleteAsync(Guid id, CancellationToken cancellationToken)
        {
            return Task.CompletedTask;
        }

        public Task<IEnumerable<ContentType>> GetAllAsync(int Skip, int Take, CancellationToken cancellationToken)
        {
            return Task.FromResult<IEnumerable<ContentType>>(new[] { _type });
        }

        public Task<ContentType?> GetByIdAsync(Guid id, CancellationToken cancellationToken)
        {
            return Task.FromResult<ContentType?>(id == ContentTypeId ? _type : null);
        }

        public Task<ContentType?> GetByNameAsync(string name, CancellationToken cancellationToken)
        {
            return Task.FromResult<ContentType?>(_type);
        }

        public Task<int> GetCountAsync(CancellationToken cancellationToken)
        {
            return Task.FromResult(1);
        }

        public Task SaveAsync(CancellationToken cancellationToken)
        {
            return Task.CompletedTask;
        }
    }

    private sealed class FakeStatusRepository : IStatusRepository
    {
        private readonly Status _status;

        public FakeStatusRepository(Status? status = null)
        {
            _status = status ?? new Status { Id = StatusId, Name = "Reading", Slug = "reading" };
        }

        public Task AddAsync(Status status, CancellationToken cancellationToken)
        {
            return Task.CompletedTask;
        }

        public Task DeleteAsync(Guid id, CancellationToken cancellationToken)
        {
            return Task.CompletedTask;
        }

        public Task<IEnumerable<Status>> GetAllAsync(int Skip, int Take, CancellationToken cancellationToken)
        {
            return Task.FromResult<IEnumerable<Status>>(new[] { _status });
        }

        public Task<Status?> GetByIdAsync(Guid id, CancellationToken cancellationToken)
        {
            return Task.FromResult<Status?>(id == StatusId ? _status : null);
        }

        public Task<Status?> GetByNameAsync(string name, CancellationToken cancellationToken)
        {
            return Task.FromResult<Status?>(_status);
        }

        public Task<int> GetCountAsync(CancellationToken cancellationToken)
        {
            return Task.FromResult(1);
        }

        public Task SaveAsync(CancellationToken cancellationToken)
        {
            return Task.CompletedTask;
        }
    }

    private sealed class FakeGenreRepository : IGenreRepository
    {
        public Task AddAsync(Genre genre, CancellationToken cancellationToken)
        {
            return Task.CompletedTask;
        }

        public Task DeleteAsync(Guid id, CancellationToken cancellationToken)
        {
            return Task.CompletedTask;
        }

        public Task<IEnumerable<Genre>> GetAllAsync(int Skip, int Take, CancellationToken cancellationToken)
        {
            return Task.FromResult<IEnumerable<Genre>>(Array.Empty<Genre>());
        }

        public Task<Genre?> GetByIdAsync(Guid id, CancellationToken cancellationToken)
        {
            return Task.FromResult<Genre?>(null);
        }

        public Task<IEnumerable<Genre>> GetByIdsAsync(IEnumerable<Guid> ids, CancellationToken cancellationToken)
        {
            return Task.FromResult<IEnumerable<Genre>>(Array.Empty<Genre>());
        }

        public Task<Genre?> GetByNameAsync(string name, CancellationToken cancellationToken)
        {
            return Task.FromResult<Genre?>(null);
        }

        public Task<int> GetCountAsync(CancellationToken cancellationToken)
        {
            return Task.FromResult(0);
        }

        public Task SaveAsync(CancellationToken cancellationToken)
        {
            return Task.CompletedTask;
        }
    }

    private sealed class FakeTagRepository : ITagRepository
    {
        private readonly List<Tag> _tags = new();

        public Task AddAsync(Tag tag, CancellationToken cancellationToken)
        {
            _tags.Add(tag);
            return Task.CompletedTask;
        }

        public Task DeleteAsync(Tag tag, CancellationToken cancellationToken)
        {
            _tags.Remove(tag);
            return Task.CompletedTask;
        }

        public Task<Tag?> GetByIdAsync(Guid ownerId, Guid id, CancellationToken cancellationToken)
        {
            return Task.FromResult(_tags.FirstOrDefault(tag => tag.OwnerId == ownerId && tag.Id == id));
        }

        public Task<IEnumerable<Tag>> GetByNamesAsync(Guid ownerId, IEnumerable<string> names,
            CancellationToken cancellationToken)
        {
            var requested = names.ToList();
            return Task.FromResult<IEnumerable<Tag>>(_tags
                .Where(t => (t.IsGlobal || t.OwnerId == ownerId) &&
                            requested.Any(name => MetadataNameSimilarity.IsPracticalMatch(t.Name, name))).ToList());
        }

        public Task<Tag?> GetByNameAsync(Guid ownerId, string name, CancellationToken cancellationToken)
        {
            return Task.FromResult(_tags.FirstOrDefault(t =>
                (t.IsGlobal || t.OwnerId == ownerId) &&
                MetadataNameSimilarity.IsPracticalMatch(t.Name, name)));
        }

        public Task<IEnumerable<Tag>> SearchAsync(Guid ownerId, string? search, int take,
            CancellationToken cancellationToken, int skip = 0)
        {
            return Task.FromResult<IEnumerable<Tag>>(_tags.Take(take));
        }

        public Task SaveAsync(CancellationToken cancellationToken)
        {
            return Task.CompletedTask;
        }
    }
}
