namespace Infrastructure.IntegrationTests;

using System.Data.Common;
using System.Globalization;
using System.Text;
using System.Text.Json;
using Application.Common;
using Contexts;
using Domain.Associations;
using Domain.Entities;
using Domain.Models;
using Domain.Repositories;
using FluentValidation;
using Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Persistence;
using TestSupport;
using Xunit.Abstractions;

public class RepositoryTests
{
    private readonly ITestOutputHelper _output;

    public RepositoryTests(ITestOutputHelper output)
    {
        _output = output;
    }

    private static BookReadQueryService CreateReadQueryService(ApplicationDbContext context)
    {
        var criteriaApplier = new BookSearchCriteriaApplier(context);
        var sortBuilder = new BookSortBuilder(context);
        var projectionQuery = new BookListProjectionQuery(context, sortBuilder);
        return new BookReadQueryService(context, criteriaApplier, sortBuilder, projectionQuery);
    }

    private static BookSummaryQueryService CreateSummaryQueryService(ApplicationDbContext context)
    {
        return new BookSummaryQueryService(context, new BookSearchCriteriaApplier(context));
    }

    private static BookAnalyticsQueryService CreateAnalyticsQueryService(ApplicationDbContext context)
    {
        return new BookAnalyticsQueryService(context, new BookSearchCriteriaApplier(context));
    }

    private static BookExportQueryService CreateExportQueryService(ApplicationDbContext context)
    {
        var criteriaApplier = new BookSearchCriteriaApplier(context);
        return new BookExportQueryService(context, criteriaApplier, new BookSortBuilder(context));
    }

    private static Task SetBookAuditDatesAsync(ApplicationDbContext context, Guid bookId, DateTimeOffset value)
    {
        return context.Database.ExecuteSqlInterpolatedAsync(
            $"UPDATE Books SET Created = {value}, LastModified = {value}, LastProgressUpdatedAt = {value} WHERE Id = {bookId}");
    }

    private static Task SetBookAuditDatesAsync(ApplicationDbContext context, DateTimeOffset value, params Book[] books)
    {
        return Task.WhenAll(books.Select(book => SetBookAuditDatesAsync(context, book.Id, value)));
    }

    private static BookAnalyticsScopeSnapshot AnalyticsScope(string? query = null)
    {
        return new BookAnalyticsScopeSnapshot(
            query,
            new DateOnly(2026, 1, 1),
            new DateOnly(2026, 4, 1),
            "week");
    }

    [Fact]
    public async Task BookCsvDatasetSeeder_ShouldLoadLargeBalancedDataset()
    {
        using var database = new SqliteTestDatabase();
        await using var context = database.CreateContext();

        var snapshot = await BookCsvDatasetSeeder.SeedAsync(context, database.UserId);

        Assert.True(snapshot.BookCount >= 500);
        BookCsvDatasetSeeder.AssertBalancedTypeDistribution(snapshot);
        BookCsvDatasetSeeder.AssertBalancedStatusDistribution(snapshot);
        Assert.True(snapshot.BooksWithGenres >= snapshot.BookCount * 9 / 10);
        Assert.True(snapshot.PreservedTaggedBooks > 0);
        Assert.True(snapshot.PreservedRatedBooks > 0);
        Assert.True(snapshot.PreservedProgressBooks >= snapshot.BookCount * 9 / 10);
        Assert.Contains(snapshot.Samples, sample => sample.Tags.Count > 0);
        Assert.Contains(snapshot.Samples, sample => sample.Rating != null);
        Assert.Contains(snapshot.Samples, sample => sample.CurrentChapterNumber != null);
    }

    [Fact]
    public async Task BookRepository_ShouldScopeListAndGetByOwner()
    {
        using var database = new SqliteTestDatabase();
        await using var context = database.CreateContext();
        var otherOwnerId = Guid.Parse("33333333-3333-3333-3333-333333333333");
        context.Users.Add(new User { Id = otherOwnerId, UserName = "other", NormalizedUserName = "OTHER" });
        var snapshot = await BookCsvDatasetSeeder.SeedAsync(context, database.UserId);
        await TestData.AddBookAsync(context, otherOwnerId, "Other");
        var repository = new BookRepository(context);
        var queryService = CreateReadQueryService(context);

        var books = (await queryService.GetBooksAsync(database.UserId, BookSearchCriteria.Empty, 0, 25, null, null,
            CancellationToken.None)).ToList();
        var count = await queryService.GetBookCountAsync(database.UserId, BookSearchCriteria.Empty,
            CancellationToken.None);
        var otherBook = await repository.GetByNameAsync("Other", database.UserId,
            Guid.Parse("10000000-0000-0000-0000-000000000001"), CancellationToken.None);

        Assert.Equal(25, books.Count);
        Assert.Equal(snapshot.BookCount, count);
        Assert.DoesNotContain(books, book => book.PrimaryTitle == "Other");
        Assert.Null(otherBook);
    }

    [Fact]
    public async Task BookRepository_ShouldProjectDescriptionsAndAuthorAliasesForListMetadata()
    {
        using var database = new SqliteTestDatabase();
        await using var context = database.CreateContext();
        var author = TestData.Author("Primary Author", database.UserId, false);
        author.Names.Add(new AuthorName
        {
            Name = "Alternative Author",
            NormalizedName = MappingExtensions.NormalizeName("Alternative Author"),
            IsPrimary = false,
            Source = "Test"
        });
        var genre = TestData.Genre("Projection Genre");
        genre.Description = "Genre description";
        var tag = TestData.Tag(database.UserId, "projection-tag");
        tag.Description = "Tag description";
        var book = TestData.Book(database.UserId, "Metadata projection", author);
        for (var index = 1; index <= 6; index++)
        {
            book.Titles.Add(new BookTitle
            {
                Title = $"Alternative title {index}",
                NormalizedTitle = MappingExtensions.NormalizeName($"Alternative title {index}")
            });
        }

        book.BookGenres.Add(new BookGenre { Book = book, Genre = genre });
        book.BookTags.Add(new BookTag { Book = book, Tag = tag });
        for (var index = 1; index <= 5; index++)
        {
            book.BookGenres.Add(new BookGenre { Book = book, Genre = TestData.Genre($"Projection Genre {index}") });
            book.BookTags.Add(new BookTag
            {
                Book = book, Tag = TestData.Tag(database.UserId, $"projection-tag-{index}")
            });
        }

        context.Books.Add(book);
        await context.SaveChangesAsync();
        var queryService = CreateReadQueryService(context);

        var result = (await queryService.GetBooksAsync(database.UserId, BookSearchCriteria.Empty, 0, 10, null, null,
            CancellationToken.None)).Single();

        Assert.Equal(["Alternative Author"], result.AuthorOtherNames);
        Assert.Equal(6, result.AlternativeTitles.Count);
        Assert.Equal(6, result.Genres.Count);
        Assert.Equal(6, result.Tags.Count);
        Assert.Equal("Genre description", result.GenreDescriptions["Projection Genre"]);
        Assert.Equal("Tag description", result.TagDescriptions["projection-tag"]);
    }

    [Fact]
    public async Task BookRepository_ShouldIncludeBookDetails()
    {
        using var database = new SqliteTestDatabase();
        await using var context = database.CreateContext();
        var book = await TestData.AddBookWithRelationsAsync(context, database.UserId);
        var repository = new BookRepository(context);

        var result = await repository.GetByIdAsync(book.Id, database.UserId, CancellationToken.None);

        Assert.NotNull(result);
        Assert.NotNull(result.Author);
        Assert.NotEmpty(result.Titles);
        Assert.NotEmpty(result.BookGenres);
        Assert.NotEmpty(result.BookTags);
        Assert.NotEmpty(result.Links);
        Assert.NotEmpty(result.ProgressHistory);
        Assert.NotNull(result.Cover);
        Assert.Equal(BookCoverStatus.Found, result.Cover.Status);
        Assert.Equal("Novel", result.ContentType.Name);
        Assert.Equal("Reading", result.Status.Name);
    }

    [Fact]
    public async Task BookRepository_ShouldSupportCountsAdminLookupAddDeleteAndProgress()
    {
        using var database = new SqliteTestDatabase();
        await using var context = database.CreateContext();
        var otherOwnerId = Guid.Parse("66666666-6666-6666-6666-666666666666");
        context.Users.Add(new User
        {
            Id = otherOwnerId, UserName = "other-progress", NormalizedUserName = "OTHER-PROGRESS"
        });
        await context.SaveChangesAsync();
        var repository = new BookRepository(context);
        var book = TestData.Book(database.UserId, "Repository Path");
        book.TotalChapters = 20;

        await repository.AddAsync(book, CancellationToken.None);
        await TestData.AddBookAsync(context, otherOwnerId, "Other Owner Path");

        Assert.Equal(1, await repository.GetCountAsync(database.UserId, CancellationToken.None));
        Assert.Equal(2, await repository.GetCountAsync(CancellationToken.None));
        Assert.NotNull(await repository.GetByIdAsync(book.Id, CancellationToken.None));
        Assert.NotNull(await repository.GetForUpdateAsync(book.Id, database.UserId, CancellationToken.None));
        Assert.NotNull(await repository.GetForUpdateAsync(book.Id, CancellationToken.None));
        Assert.Equal(20, await repository.GetTotalChaptersAsync(book.Id, database.UserId, CancellationToken.None));
        Assert.False(await repository.UpdateProgressAsync(Guid.NewGuid(), database.UserId, 1, "1", null,
            CancellationToken.None));
        await Assert.ThrowsAsync<ValidationException>(() =>
            repository.UpdateProgressAsync(book.Id, database.UserId, 21, "21", null, CancellationToken.None));

        Assert.True(await repository.UpdateProgressAsync(book.Id, database.UserId, 10, "10", null,
            CancellationToken.None));
        Assert.True(await repository.UpdateProgressAsync(book.Id, database.UserId, 10, "10", "note",
            CancellationToken.None));
        var history = await context.BookProgressHistory
            .Where(history => history.BookId == book.Id)
            .ToListAsync();
        var entry = Assert.Single(history);
        Assert.Equal("note", entry.Comment);

        Assert.True(await repository.UpdateProgressAsync(book.Id, database.UserId, 9, "9", "older chapter",
            CancellationToken.None));
        Assert.Equal(2, await context.BookProgressHistory.CountAsync(history => history.BookId == book.Id));
        await repository.DeleteAsync(Guid.NewGuid(), database.UserId, CancellationToken.None);
        await repository.DeleteAsync(book.Id, database.UserId, CancellationToken.None);

        Assert.Equal(0, await repository.GetCountAsync(database.UserId, CancellationToken.None));
    }

    [Fact]
    public async Task BookRepository_ShouldSearchByCustomCriteria()
    {
        using var database = new SqliteTestDatabase();
        await using var context = database.CreateContext();
        var snapshot = await BookCsvDatasetSeeder.SeedAsync(context, database.UserId);
        var sample = snapshot.WithTagAndRating;
        var queryService = CreateReadQueryService(context);
        var criteria = new BookSearchCriteria(
            Array.Empty<string>(),
            [new BookSearchFieldFilter(BookSearchField.Tag, sample.Tags[0])],
            [
                new BookSearchNumberFilter(BookSearchNumberField.Rating, BookSearchOperator.GreaterThanOrEqual,
                    sample.Rating!.Value)
            ]);

        var books = (await queryService.GetBooksAsync(database.UserId, criteria, 0, snapshot.BookCount, null, null,
            CancellationToken.None)).ToList();
        var count = await queryService.GetBookCountAsync(database.UserId, criteria, CancellationToken.None);

        Assert.NotEmpty(books);
        Assert.Equal(books.Count, count);
        Assert.Contains(books, book => book.Id == sample.Id);
        Assert.All(books, book =>
        {
            Assert.True(book.TagsCount > 0);
            Assert.True(book.Rating >= sample.Rating);
        });
    }

    [Fact]
    public async Task BookRepository_ShouldSearchByWildcardTitleCriteria()
    {
        using var database = new SqliteTestDatabase();
        await using var context = database.CreateContext();
        var snapshot = await BookCsvDatasetSeeder.SeedAsync(context, database.UserId);
        var sample = snapshot.Any;
        var queryService = CreateReadQueryService(context);
        var prefix = sample.PrimaryTitle[..Math.Min(5, sample.PrimaryTitle.Length)];
        var criteria = new BookSearchCriteria(
            Array.Empty<string>(),
            [new BookSearchFieldFilter(BookSearchField.Title, $"{prefix}*")],
            Array.Empty<BookSearchNumberFilter>());

        var books = (await queryService.GetBooksAsync(database.UserId, criteria, 0, snapshot.BookCount, null, null,
            CancellationToken.None)).ToList();

        Assert.Contains(books, book => book.Id == sample.Id);
    }

    [Fact]
    public async Task BookRepository_ShouldSearchByProgressAndChaptersAliases()
    {
        using var database = new SqliteTestDatabase();
        await using var context = database.CreateContext();
        var snapshot = await BookCsvDatasetSeeder.SeedAsync(context, database.UserId);
        var sample = snapshot.WithTotalChapters;
        var queryService = CreateReadQueryService(context);
        var criteria =
            BookSearchQueryParser.Parse($"progress:>={sample.CurrentChapterNumber} chapters:>={sample.TotalChapters}");

        var books = (await queryService.GetBooksAsync(database.UserId, criteria, 0, snapshot.BookCount, null, null,
            CancellationToken.None)).ToList();

        Assert.Contains(books, book => book.Id == sample.Id);
        Assert.All(books, book =>
        {
            Assert.True(book.CurrentChapterNumber >= sample.CurrentChapterNumber);
            Assert.True(book.TotalChapters >= sample.TotalChapters);
        });
    }

    [Fact]
    public async Task BookRepository_ShouldSearchByMissingValueFiltersWithOwnerIsolation()
    {
        using var database = new SqliteTestDatabase();
        await using var context = database.CreateContext();
        var otherOwnerId = Guid.Parse("77777777-7777-7777-7777-777777777777");
        context.Users.Add(new User
        {
            Id = otherOwnerId, UserName = "other-missing", NormalizedUserName = "OTHER-MISSING"
        });

        var complete = AddBookWithMetadata("Complete");
        var missingRating = AddBookWithMetadata("Missing Rating", BookSearchMissingField.Rating);
        var missingPriority = AddBookWithMetadata("Missing Priority", BookSearchMissingField.Priority);
        var missingAuthor = AddBookWithMetadata("Missing Author", BookSearchMissingField.Author);
        var missingDescription = AddBookWithMetadata("Missing Description", BookSearchMissingField.Description);
        var missingGenre = AddBookWithMetadata("Missing Genre", BookSearchMissingField.Genre);
        var missingTag = AddBookWithMetadata("Missing Tag", BookSearchMissingField.Tag);
        var missingCurrent = AddBookWithMetadata("Missing Current Chapter", BookSearchMissingField.CurrentChapter);
        var missingTotal = AddBookWithMetadata("Missing Total Chapters", BookSearchMissingField.TotalChapters);
        var missingAlternateTitle =
            AddBookWithMetadata("Missing Alternate Title", BookSearchMissingField.AlternateTitle);
        var missingCover = AddBookWithMetadata("Missing Cover", BookSearchMissingField.Cover);
        var missingLink = AddBookWithMetadata("Missing Link", BookSearchMissingField.Link);
        var missingGenreAndTag = AddBookWithMetadata(
            "Missing Genre And Tag",
            BookSearchMissingField.Genre,
            BookSearchMissingField.Tag);
        var otherOwnerMissing = TestData.Book(otherOwnerId, "Other Owner Missing Fields");
        context.Books.Add(otherOwnerMissing);
        await context.SaveChangesAsync();
        var queryService = CreateReadQueryService(context);

        foreach (var (query, expectedIds) in new[]
                 {
                     ("rating:none", new[] { missingRating.Id }), ("priority:NONE", new[] { missingPriority.Id }),
                     ("author:'none'", new[] { missingAuthor.Id }),
                     ("description:none", new[] { missingDescription.Id }),
                     ("genre:none", new[] { missingGenre.Id, missingGenreAndTag.Id }),
                     ("tag:none", new[] { missingTag.Id, missingGenreAndTag.Id }),
                     ("current:none", new[] { missingCurrent.Id }),
                     ("currentChapter:none", new[] { missingCurrent.Id }),
                     ("progress:none", new[] { missingCurrent.Id }), ("total:none", new[] { missingTotal.Id }),
                     ("alternateTitle:none", new[] { missingAlternateTitle.Id }),
                     ("alternativeTitle:none", new[] { missingAlternateTitle.Id }),
                     ("cover:none", new[] { missingCover.Id }), ("link:none", new[] { missingLink.Id }),
                     ("links:none", new[] { missingLink.Id }),
                     ("genre:none tag:none", new[] { missingGenreAndTag.Id })
                 })
        {
            var books = (await queryService.GetBooksAsync(
                database.UserId,
                BookSearchQueryParser.Parse(query),
                0,
                10,
                "title",
                "asc",
                CancellationToken.None)).ToList();

            Assert.Equal(expectedIds.Order(), books.Select(book => book.Id).Order());
            Assert.DoesNotContain(books, item => item.Id == complete.Id);
            Assert.DoesNotContain(books, item => item.Id == otherOwnerMissing.Id);
        }

        Book AddBookWithMetadata(
            string title,
            BookSearchMissingField? missing = null,
            BookSearchMissingField? secondMissing = null)
        {
            bool IsMissing(BookSearchMissingField field)
            {
                return missing == field || secondMissing == field;
            }

            var author = IsMissing(BookSearchMissingField.Author) ? null : TestData.Author($"{title} Author");
            var book = TestData.Book(database.UserId, title, author);
            book.Description = IsMissing(BookSearchMissingField.Description) ? null : $"{title} description";
            book.Rating = IsMissing(BookSearchMissingField.Rating) ? null : 8;
            book.Priority = IsMissing(BookSearchMissingField.Priority) ? null : 2;
            book.CurrentChapterNumber = IsMissing(BookSearchMissingField.CurrentChapter) ? null : 50;
            book.TotalChapters = IsMissing(BookSearchMissingField.TotalChapters) ? null : 100;

            if (!IsMissing(BookSearchMissingField.Genre))
            {
                book.BookGenres.Add(new BookGenre { Book = book, Genre = TestData.Genre($"{title} Genre") });
            }

            if (!IsMissing(BookSearchMissingField.Tag))
            {
                book.BookTags.Add(new BookTag { Book = book, Tag = TestData.Tag(database.UserId, $"{title} Tag") });
            }

            if (!IsMissing(BookSearchMissingField.AlternateTitle))
            {
                book.Titles.Add(new BookTitle
                {
                    Title = $"{title} Alternate",
                    NormalizedTitle = MappingExtensions.NormalizeName($"{title} Alternate"),
                    IsPrimary = false,
                    Source = "Test"
                });
            }

            if (!IsMissing(BookSearchMissingField.Cover))
            {
                book.Cover = new BookCover { Status = BookCoverStatus.Found, StoragePath = $"{book.Id:N}/cover.jpg" };
            }

            if (!IsMissing(BookSearchMissingField.Link))
            {
                book.Links.Add(new BookLink { Url = $"https://example.com/{book.Id}", SourceType = "Test" });
            }

            context.Books.Add(book);
            return book;
        }
    }

    [Fact]
    public async Task BookRepository_ShouldSearchCreatedAndUpdatedDatesByDateOnly()
    {
        using var database = new SqliteTestDatabase();
        await using var context = database.CreateContext();
        var oldBook = await TestData.AddBookAsync(context, database.UserId, "Old Date Match");
        var midBook = await TestData.AddBookAsync(context, database.UserId, "Middle Date Match");
        var lateBook = await TestData.AddBookAsync(context, database.UserId, "Late Date Match");
        await SetBookAuditDatesAsync(context, oldBook.Id, new DateTimeOffset(2026, 7, 14, 23, 59, 0, TimeSpan.Zero));
        await SetBookAuditDatesAsync(context, midBook.Id, new DateTimeOffset(2026, 7, 15, 12, 30, 0, TimeSpan.Zero));
        await SetBookAuditDatesAsync(context, lateBook.Id, new DateTimeOffset(2026, 7, 16, 0, 1, 0, TimeSpan.Zero));
        var queryService = CreateReadQueryService(context);

        var equal = await SearchIdsAsync("createDate:=15.07.2026");
        var greaterThan = await SearchIdsAsync("createDate:>2026-07-15");
        var lessThanOrEqual = await SearchIdsAsync("createDate:<=15/07/2026");
        var updatedBefore = await SearchIdsAsync("updateDate:<16.07.2026");

        Assert.Equal([midBook.Id], equal);
        Assert.Equal([lateBook.Id], greaterThan);
        Assert.Equal([oldBook.Id, midBook.Id], lessThanOrEqual);
        Assert.Equal([oldBook.Id, midBook.Id], updatedBefore);

        async Task<IReadOnlyCollection<Guid>> SearchIdsAsync(string query)
        {
            var books = await queryService.GetBooksAsync(
                database.UserId,
                BookSearchQueryParser.Parse(query),
                0,
                10,
                "created",
                "asc",
                CancellationToken.None);

            return books.Select(book => book.Id).ToArray();
        }
    }

    [Fact]
    public async Task BookAnalytics_ShouldReturnEmptyOverviewAndCollectionsForEmptyLibrary()
    {
        using var database = new SqliteTestDatabase();
        await using var context = database.CreateContext();
        var service = CreateAnalyticsQueryService(context);
        var scope = AnalyticsScope();

        var result = await service.GetAnalyticsAsync(database.UserId, BookSearchCriteria.Empty, scope,
            CancellationToken.None);

        Assert.Equal(0, result.Overview.TotalBooks);
        Assert.Equal(0, result.Overview.RatedBooks);
        Assert.Equal(0, result.Overview.UnratedBooks);
        Assert.Null(result.Overview.AverageRating);
        Assert.Empty(result.Composition.StatusByType);
        Assert.Empty(result.Composition.Genres);
        Assert.Empty(result.Composition.Tags);
    }

    [Fact]
    public async Task BookAnalytics_ShouldScopeOverviewByOwnerAndQueryButNotByDateRange()
    {
        using var database = new SqliteTestDatabase();
        await using var context = database.CreateContext();
        var otherOwnerId = Guid.Parse("99999999-9999-9999-9999-999999999999");
        context.Users.Add(new User
        {
            Id = otherOwnerId, UserName = "analytics-other", NormalizedUserName = "ANALYTICS-OTHER"
        });
        var matched = TestData.Book(database.UserId, "Analytics Match");
        matched.Rating = 8;
        matched.CurrentChapterNumber = 10;
        var unmatched = TestData.Book(database.UserId, "Analytics Other");
        unmatched.Rating = null;
        var outOfRangeMatch = TestData.Book(database.UserId, "Analytics Match Old");
        outOfRangeMatch.Rating = 10;
        var otherOwner = TestData.Book(otherOwnerId, "Analytics Match Other Owner");
        otherOwner.Rating = 10;
        context.Books.AddRange(matched, unmatched, outOfRangeMatch, otherOwner);
        await context.SaveChangesAsync();
        await SetBookAuditDatesAsync(context, new DateTimeOffset(2026, 1, 15, 10, 0, 0, TimeSpan.Zero), matched,
            unmatched, otherOwner);
        await SetBookAuditDatesAsync(context, outOfRangeMatch.Id,
            new DateTimeOffset(2025, 12, 31, 10, 0, 0, TimeSpan.Zero));
        var service = CreateAnalyticsQueryService(context);

        var result = await service.GetAnalyticsAsync(
            database.UserId,
            BookSearchQueryParser.Parse("title:\"Analytics Match\""),
            AnalyticsScope("title:\"Analytics Match\""),
            CancellationToken.None);

        // The book added before the range still counts: the range only scopes activity and growth.
        Assert.Equal(2, result.Overview.TotalBooks);
        Assert.Equal(2, result.Overview.RatedBooks);
        Assert.Equal(0, result.Overview.UnratedBooks);
        Assert.Equal(9, result.Overview.AverageRating);
        Assert.Equal(10 + (outOfRangeMatch.CurrentChapterNumber ?? 0), result.Overview.CurrentChapters);
    }

    [Fact]
    public async Task BookAnalytics_ShouldAggregateCompositionByStatusTypeGenresAndTags()
    {
        using var database = new SqliteTestDatabase();
        await using var context = database.CreateContext();
        var otherOwnerId = Guid.Parse("88888888-8888-8888-8888-888888888888");
        context.Users.Add(new User
        {
            Id = otherOwnerId, UserName = "composition-other", NormalizedUserName = "COMPOSITION-OTHER"
        });
        var fantasy = TestData.Genre("Fantasy");
        var drama = TestData.Genre("Drama");
        var favorite = TestData.Tag(database.UserId, "favorite");
        var backlog = TestData.Tag(database.UserId, "backlog");
        var otherOwnerTag = TestData.Tag(otherOwnerId, "favorite");
        context.Genres.AddRange(fantasy, drama);
        context.Tags.AddRange(favorite, backlog, otherOwnerTag);

        var novelReading = TestData.Book(database.UserId, "Novel Reading");
        novelReading.BookGenres.Add(new BookGenre { Book = novelReading, Genre = fantasy });
        novelReading.BookGenres.Add(new BookGenre { Book = novelReading, Genre = drama });
        novelReading.BookTags.Add(new BookTag { Book = novelReading, Tag = favorite });
        novelReading.BookTags.Add(new BookTag { Book = novelReading, Tag = backlog });

        var novelCompleted = TestData.Book(database.UserId, "Novel Completed");
        novelCompleted.StatusId = Guid.Parse("20000000-0000-0000-0000-000000000002");
        novelCompleted.BookGenres.Add(new BookGenre { Book = novelCompleted, Genre = fantasy });
        novelCompleted.BookTags.Add(new BookTag { Book = novelCompleted, Tag = favorite });

        var mangaReading = TestData.Book(database.UserId, "Manga Reading");
        mangaReading.ContentTypeId = Guid.Parse("10000000-0000-0000-0000-000000000002");
        mangaReading.BookTags.Add(new BookTag { Book = mangaReading, Tag = backlog });

        var otherOwnerBook = TestData.Book(otherOwnerId, "Other Owner Composition");
        otherOwnerBook.BookGenres.Add(new BookGenre { Book = otherOwnerBook, Genre = fantasy });
        otherOwnerBook.BookTags.Add(new BookTag { Book = otherOwnerBook, Tag = otherOwnerTag });

        context.Books.AddRange(novelReading, novelCompleted, mangaReading, otherOwnerBook);
        await context.SaveChangesAsync();
        await SetBookAuditDatesAsync(context, new DateTimeOffset(2026, 1, 15, 10, 0, 0, TimeSpan.Zero), novelReading,
            novelCompleted, mangaReading, otherOwnerBook);
        var service = CreateAnalyticsQueryService(context);

        var result = await service.GetAnalyticsAsync(database.UserId, BookSearchCriteria.Empty,
            AnalyticsScope(), CancellationToken.None);

        Assert.Equal(3, result.Overview.TotalBooks);
        var novel = Assert.Single(result.Composition.StatusByType,
            item => item.Type == "Novel");
        Assert.Equal(2, novel.TotalBooks);
        Assert.Contains(novel.Statuses, status => status.Status == "Reading" && status.BookCount == 1);
        Assert.Contains(novel.Statuses, status => status.Status == "Completed" && status.BookCount == 1);
        var manga = Assert.Single(result.Composition.StatusByType,
            item => item.Type == "Manga");
        Assert.Equal(1, manga.TotalBooks);
        Assert.Contains(manga.Statuses, status => status.Status == "Reading" && status.BookCount == 1);

        Assert.Equal(["Fantasy", "Drama"], result.Composition.Genres.Select(item => item.Name).ToArray());
        Assert.Equal(2, result.Composition.Genres[0].BookCount);
        Assert.Equal(2d / 3d, result.Composition.Genres[0].ShareOfBooks, 6);
        Assert.Equal(["backlog", "favorite"], result.Composition.Tags.Select(item => item.Name).ToArray());
        Assert.All(result.Composition.Tags, item => Assert.Equal(2, item.BookCount));
    }

    [Fact]
    public async Task BookAnalytics_ShouldAggregateRatingsAndPrioritiesByStatusWithOwnerAndQueryScope()
    {
        using var database = new SqliteTestDatabase();
        await using var context = database.CreateContext();
        var otherOwnerId = Guid.Parse("12121212-1212-1212-1212-121212121212");
        context.Users.Add(new User
        {
            Id = otherOwnerId, UserName = "ratings-other", NormalizedUserName = "RATINGS-OTHER"
        });

        var unratedReading = TestData.Book(database.UserId, "Rating Scope Alpha");
        unratedReading.Rating = null;
        unratedReading.Priority = null;

        var singleRatedReading = TestData.Book(database.UserId, "Rating Scope Beta");
        singleRatedReading.Rating = 7;
        singleRatedReading.Priority = 2;

        var completed = TestData.Book(database.UserId, "Rating Scope Gamma");
        completed.StatusId = Guid.Parse("20000000-0000-0000-0000-000000000002");
        completed.Rating = 10;
        completed.Priority = 5;

        var unmatched = TestData.Book(database.UserId, "Rating Outside");
        unmatched.Rating = 1;
        unmatched.Priority = 1;

        var otherOwner = TestData.Book(otherOwnerId, "Rating Scope Other Owner");
        otherOwner.Rating = 10;
        otherOwner.Priority = 5;

        context.Books.AddRange(unratedReading, singleRatedReading, completed, unmatched, otherOwner);
        await context.SaveChangesAsync();
        await SetBookAuditDatesAsync(context, new DateTimeOffset(2026, 1, 15, 10, 0, 0, TimeSpan.Zero), unratedReading,
            singleRatedReading, completed, unmatched, otherOwner);
        var service = CreateAnalyticsQueryService(context);

        var result = await service.GetAnalyticsAsync(
            database.UserId,
            BookSearchQueryParser.Parse("title:\"Rating Scope\""),
            AnalyticsScope("title:\"Rating Scope\""),
            CancellationToken.None);

        Assert.Equal(3, result.Overview.TotalBooks);
        Assert.Equal(2, result.Ratings.RatedBooks);
        Assert.Equal(1, result.Ratings.UnratedBooks);
        Assert.Equal(8.5, result.Ratings.AverageRating);
        Assert.Equal(Enumerable.Range(1, 10), result.Ratings.Counts.Select(item => item.Rating));
        Assert.Equal(0, result.Ratings.Counts.Single(item => item.Rating == 1).BookCount);
        Assert.Equal(1, result.Ratings.Counts.Single(item => item.Rating == 7).BookCount);
        Assert.Equal(1, result.Ratings.Counts.Single(item => item.Rating == 10).BookCount);
        Assert.Equal(2, result.Planning.PrioritiesByStatus.Count);

        var reading =
            Assert.Single(result.Planning.PrioritiesByStatus, item => item.Status == "Reading");
        Assert.Equal(2, reading.TotalBooks);
        Assert.Equal(["1", "2", "3", "4", "5", "Unset"], reading.Priorities.Select(item => item.Priority).ToArray());
        Assert.Equal(1, reading.Priorities.Single(item => item.Priority == "2").BookCount);
        Assert.Equal(1, reading.Priorities.Single(item => item.Priority == "Unset").BookCount);
        Assert.Equal(0, reading.Priorities.Single(item => item.Priority == "5").BookCount);

        var completedStatus =
            Assert.Single(result.Planning.PrioritiesByStatus, item => item.Status == "Completed");
        Assert.Equal(1, completedStatus.TotalBooks);
        Assert.Equal(1, completedStatus.Priorities.Single(item => item.Priority == "5").BookCount);
        Assert.All(completedStatus.Priorities.Where(item => item.Priority != "5"),
            item => Assert.Equal(0, item.BookCount));
    }

    [Fact]
    public async Task BookAnalytics_ShouldAggregateTypeVolumesWithPortableMedianAndScope()
    {
        using var database = new SqliteTestDatabase();
        await using var context = database.CreateContext();
        var otherOwnerId = Guid.Parse("13131313-1313-1313-1313-131313131313");
        context.Users.Add(new User
        {
            Id = otherOwnerId, UserName = "volumes-other", NormalizedUserName = "VOLUMES-OTHER"
        });

        var novelLow = TestData.Book(database.UserId, "Volume Scope Novel Low");
        novelLow.CurrentChapterNumber = 10.5m;
        var novelHigh = TestData.Book(database.UserId, "Volume Scope Novel High");
        novelHigh.CurrentChapterNumber = 20.5m;
        var novelUnknown = TestData.Book(database.UserId, "Volume Scope Novel Unknown");
        novelUnknown.CurrentChapterNumber = null;

        var mangaTieA = TestData.Book(database.UserId, "Volume Scope Manga Tie A");
        mangaTieA.ContentTypeId = Guid.Parse("10000000-0000-0000-0000-000000000002");
        mangaTieA.CurrentChapterNumber = 3m;
        var mangaTieB = TestData.Book(database.UserId, "Volume Scope Manga Tie B");
        mangaTieB.ContentTypeId = Guid.Parse("10000000-0000-0000-0000-000000000002");
        mangaTieB.CurrentChapterNumber = 3m;
        var mangaHigh = TestData.Book(database.UserId, "Volume Scope Manga High");
        mangaHigh.ContentTypeId = Guid.Parse("10000000-0000-0000-0000-000000000002");
        mangaHigh.CurrentChapterNumber = 9m;

        var manhwaUnknown = TestData.Book(database.UserId, "Volume Scope Manhwa Unknown");
        manhwaUnknown.ContentTypeId = Guid.Parse("10000000-0000-0000-0000-000000000003");
        manhwaUnknown.CurrentChapterNumber = null;

        var unmatched = TestData.Book(database.UserId, "Volume Outside Novel");
        unmatched.CurrentChapterNumber = 100m;
        var otherOwner = TestData.Book(otherOwnerId, "Volume Scope Other Owner");
        otherOwner.CurrentChapterNumber = 100m;

        context.Books.AddRange(
            novelLow,
            novelHigh,
            novelUnknown,
            mangaTieA,
            mangaTieB,
            mangaHigh,
            manhwaUnknown,
            unmatched,
            otherOwner);
        await context.SaveChangesAsync();
        await SetBookAuditDatesAsync(
            context,
            new DateTimeOffset(2026, 1, 15, 10, 0, 0, TimeSpan.Zero),
            novelLow,
            novelHigh,
            novelUnknown,
            mangaTieA,
            mangaTieB,
            mangaHigh,
            manhwaUnknown,
            unmatched,
            otherOwner);
        var service = CreateAnalyticsQueryService(context);

        var result = await service.GetAnalyticsAsync(
            database.UserId,
            BookSearchQueryParser.Parse("title:\"Volume Scope\""),
            AnalyticsScope("title:\"Volume Scope\""),
            CancellationToken.None);

        Assert.Equal(7, result.Overview.TotalBooks);
        Assert.Equal(["Manga", "Novel", "Manhwa"], result.Progress.TypeVolumes.Select(item => item.Type).ToArray());

        var
            novel = Assert.Single(result.Progress.TypeVolumes, item => item.Type == "Novel");
        Assert.Equal(3, novel.BookCount);
        Assert.Equal(31m, novel.CurrentChapters);
        Assert.Equal(15.5m, novel.AverageCurrentChapter);
        Assert.Equal(15.5m, novel.MedianCurrentChapter);

        var
            manga = Assert.Single(result.Progress.TypeVolumes, item => item.Type == "Manga");
        Assert.Equal(3, manga.BookCount);
        Assert.Equal(15m, manga.CurrentChapters);
        Assert.Equal(5m, manga.AverageCurrentChapter);
        Assert.Equal(3m, manga.MedianCurrentChapter);

        var manhwa =
            Assert.Single(result.Progress.TypeVolumes, item => item.Type == "Manhwa");
        Assert.Equal(1, manhwa.BookCount);
        Assert.Equal(0m, manhwa.CurrentChapters);
        Assert.Null(manhwa.AverageCurrentChapter);
        Assert.Null(manhwa.MedianCurrentChapter);
    }

    [Fact]
    public async Task BookAnalytics_ShouldAggregateReadingActivityFromProgressHistory()
    {
        using var database = new SqliteTestDatabase();
        await using var context = database.CreateContext();
        var otherOwnerId = Guid.Parse("14141414-1414-1414-1414-141414141414");
        context.Users.Add(new User
        {
            Id = otherOwnerId, UserName = "activity-other", NormalizedUserName = "ACTIVITY-OTHER"
        });

        var active = TestData.Book(database.UserId, "Activity Scope Active");
        AddProgress(active,
            ProgressHistory("00000000-0000-0000-0000-000000000001",
                new DateTimeOffset(2025, 12, 31, 8, 0, 0, TimeSpan.Zero), 1m, "1"),
            ProgressHistory("00000000-0000-0000-0000-000000000002",
                new DateTimeOffset(2026, 1, 1, 10, 0, 0, TimeSpan.Zero), 1m, "Chapter One"),
            ProgressHistory("00000000-0000-0000-0000-000000000003",
                new DateTimeOffset(2026, 1, 1, 10, 0, 0, TimeSpan.Zero), 3m, "3"),
            ProgressHistory("00000000-0000-0000-0000-000000000004",
                new DateTimeOffset(2026, 1, 2, 10, 0, 0, TimeSpan.Zero), 2m, "2"),
            ProgressHistory("00000000-0000-0000-0000-000000000005",
                new DateTimeOffset(2026, 1, 3, 10, 0, 0, TimeSpan.Zero), null, "unknown"),
            ProgressHistory("00000000-0000-0000-0000-000000000006",
                new DateTimeOffset(2026, 1, 4, 10, 0, 0, TimeSpan.Zero), 5m, "5"),
            ProgressHistory("00000000-0000-0000-0000-000000000007",
                new DateTimeOffset(2026, 1, 8, 10, 0, 0, TimeSpan.Zero), 8m, "8")
        );

        var singleEntry = TestData.Book(database.UserId, "Activity Scope Single");
        singleEntry.ProgressHistory.Add(ProgressHistory("00000000-0000-0000-0000-000000000101",
            new DateTimeOffset(2026, 1, 3, 10, 0, 0, TimeSpan.Zero), 50m, "50"));

        var yearEdge = TestData.Book(database.UserId, "Activity Scope Year Edge");
        AddProgress(yearEdge,
            ProgressHistory("00000000-0000-0000-0000-000000000201",
                new DateTimeOffset(2025, 12, 30, 10, 0, 0, TimeSpan.Zero), 2m, "2"),
            ProgressHistory("00000000-0000-0000-0000-000000000202",
                new DateTimeOffset(2025, 12, 31, 10, 0, 0, TimeSpan.Zero), 4m, "4")
        );

        var unmatched = TestData.Book(database.UserId, "Activity Outside");
        AddProgress(unmatched,
            ProgressHistory("00000000-0000-0000-0000-000000000301",
                new DateTimeOffset(2025, 12, 31, 10, 0, 0, TimeSpan.Zero), 1m, "1"),
            ProgressHistory("00000000-0000-0000-0000-000000000302",
                new DateTimeOffset(2026, 1, 1, 10, 0, 0, TimeSpan.Zero), 99m, "99")
        );

        var otherOwner = TestData.Book(otherOwnerId, "Activity Scope Other Owner");
        AddProgress(otherOwner,
            ProgressHistory("00000000-0000-0000-0000-000000000401",
                new DateTimeOffset(2025, 12, 31, 10, 0, 0, TimeSpan.Zero), 1m, "1"),
            ProgressHistory("00000000-0000-0000-0000-000000000402",
                new DateTimeOffset(2026, 1, 1, 10, 0, 0, TimeSpan.Zero), 99m, "99")
        );

        context.Books.AddRange(active, singleEntry, yearEdge, unmatched, otherOwner);
        await context.SaveChangesAsync();
        await SetBookAuditDatesAsync(context, new DateTimeOffset(2026, 1, 1, 9, 0, 0, TimeSpan.Zero), active,
            singleEntry, yearEdge, unmatched, otherOwner);
        var service = CreateAnalyticsQueryService(context);
        var criteria = BookSearchQueryParser.Parse("title:\"Activity Scope\"");

        var day = await service.GetAnalyticsAsync(
            database.UserId,
            criteria,
            new BookAnalyticsScopeSnapshot("title:\"Activity Scope\"", new DateOnly(2026, 1, 1),
                new DateOnly(2026, 1, 8), "day"),
            CancellationToken.None);

        Assert.Equal(7, day.Activity.Points.Count);
        Assert.Equal(53m, day.Activity.BaselineChapters);
        AssertActivityPoint(day, new DateOnly(2026, 1, 1), 2, 1, 2m);
        AssertActivityPoint(day, new DateOnly(2026, 1, 2), 1, 1, 0m);
        AssertActivityPoint(day, new DateOnly(2026, 1, 3), 1, 1, 0m);
        AssertActivityPoint(day, new DateOnly(2026, 1, 4), 1, 1, 0m);
        AssertActivityPoint(day, new DateOnly(2026, 1, 7), 0, 0, 0m);
        Assert.DoesNotContain(day.Activity.Points, point => point.Date == new DateOnly(2026, 1, 8));

        var week = await service.GetAnalyticsAsync(
            database.UserId,
            criteria,
            new BookAnalyticsScopeSnapshot("title:\"Activity Scope\"", new DateOnly(2026, 1, 1),
                new DateOnly(2026, 1, 15), "week"),
            CancellationToken.None);

        AssertActivityPoint(week, new DateOnly(2026, 1, 1), 5, 1, 2m);
        AssertActivityPoint(week, new DateOnly(2026, 1, 5), 1, 1, 3m);
        AssertActivityPoint(week, new DateOnly(2026, 1, 12), 0, 0, 0m);

        var month = await service.GetAnalyticsAsync(
            database.UserId,
            criteria,
            new BookAnalyticsScopeSnapshot("title:\"Activity Scope\"", new DateOnly(2025, 12, 31),
                new DateOnly(2026, 2, 1), "month"),
            CancellationToken.None);

        AssertActivityPoint(month, new DateOnly(2025, 12, 31), 1, 1, 2m);
        AssertActivityPoint(month, new DateOnly(2026, 1, 1), 6, 1, 5m);

        static BookProgressHistory ProgressHistory(string id, DateTimeOffset changedAt, decimal? chapterNumber,
            string chapterLabel)
        {
            return new BookProgressHistory
            {
                Id = Guid.Parse(id),
                ChangedAt = changedAt,
                ChapterNumber = chapterNumber,
                ChapterLabel = chapterLabel
            };
        }

        static void AddProgress(Book book, params BookProgressHistory[] history)
        {
            foreach (var item in history)
            {
                book.ProgressHistory.Add(item);
            }
        }

        static void AssertActivityPoint(
            BookAnalyticsSnapshot snapshot,
            DateOnly date,
            int progressEvents,
            int booksTouched,
            decimal chaptersAdvanced)
        {
            var point = Assert.Single(snapshot.Activity.Points,
                item => item.Date == date);
            Assert.Equal(progressEvents, point.ProgressEvents);
            Assert.Equal(booksTouched, point.BooksTouched);
            Assert.Equal(chaptersAdvanced, point.ChaptersAdvanced);
        }
    }

    [Fact]
    public async Task BookAnalytics_ShouldCountChaptersLeftInReadingBooksWithKnownTotals()
    {
        using var database = new SqliteTestDatabase();
        await using var context = database.CreateContext();
        var halfway = TestData.Book(database.UserId, "Forecast Halfway");
        halfway.CurrentChapterNumber = 40m;
        halfway.TotalChapters = 100m;
        var notStarted = TestData.Book(database.UserId, "Forecast Not Started");
        notStarted.CurrentChapterNumber = null;
        notStarted.TotalChapters = 20m;
        var ahead = TestData.Book(database.UserId, "Forecast Ahead Of Total");
        ahead.CurrentChapterNumber = 30m;
        ahead.TotalChapters = 25m;
        var ongoing = TestData.Book(database.UserId, "Forecast Unknown Total");
        ongoing.CurrentChapterNumber = 10m;
        var completed = TestData.Book(database.UserId, "Forecast Completed");
        completed.StatusId = Guid.Parse("20000000-0000-0000-0000-000000000002");
        completed.CurrentChapterNumber = 5m;
        completed.TotalChapters = 50m;
        context.Books.AddRange(halfway, notStarted, ahead, ongoing, completed);
        await context.SaveChangesAsync();
        var service = CreateAnalyticsQueryService(context);

        var result = await service.GetAnalyticsAsync(database.UserId,
            BookSearchQueryParser.Parse("title:Forecast"), AnalyticsScope("title:Forecast"), CancellationToken.None);

        var novel = Assert.Single(result.Progress.TypeVolumes);
        Assert.Equal(4, novel.ReadingBooks);
        Assert.Equal(3, novel.ReadingBooksWithKnownTotal);
        // 60 left + 20 left + 0 (already past the total); the completed book does not count.
        Assert.Equal(80m, novel.RemainingChapters);
    }

    [Fact]
    public async Task BookAnalytics_ShouldAggregateLibraryGrowthByCreatedDateAndType()
    {
        using var database = new SqliteTestDatabase();
        await using var context = database.CreateContext();
        var otherOwnerId = Guid.Parse("15151515-1515-1515-1515-151515151515");
        context.Users.Add(
            new User { Id = otherOwnerId, UserName = "growth-other", NormalizedUserName = "GROWTH-OTHER" });

        var opening = TestData.Book(database.UserId, "Growth Scope Opening");
        var yearEdge = TestData.Book(database.UserId, "Growth Scope Year Edge");
        yearEdge.ContentTypeId = Guid.Parse("10000000-0000-0000-0000-000000000003");
        var importNovel = TestData.Book(database.UserId, "Growth Scope Import Novel");
        var importManga = TestData.Book(database.UserId, "Growth Scope Import Manga");
        importManga.ContentTypeId = Guid.Parse("10000000-0000-0000-0000-000000000002");
        var laterManga = TestData.Book(database.UserId, "Growth Scope Later Manga");
        laterManga.ContentTypeId = Guid.Parse("10000000-0000-0000-0000-000000000002");
        var unmatched = TestData.Book(database.UserId, "Growth Outside Import");
        var otherOwner = TestData.Book(otherOwnerId, "Growth Scope Other Owner");

        context.Books.AddRange(opening, yearEdge, importNovel, importManga, laterManga, unmatched, otherOwner);
        await context.SaveChangesAsync();
        await SetBookAuditDatesAsync(context, opening.Id, new DateTimeOffset(2025, 12, 30, 10, 0, 0, TimeSpan.Zero));
        await SetBookAuditDatesAsync(context, yearEdge.Id, new DateTimeOffset(2025, 12, 31, 10, 0, 0, TimeSpan.Zero));
        await SetBookAuditDatesAsync(context, importNovel.Id, new DateTimeOffset(2026, 1, 1, 9, 0, 0, TimeSpan.Zero));
        await SetBookAuditDatesAsync(context, importManga.Id, new DateTimeOffset(2026, 1, 1, 9, 5, 0, TimeSpan.Zero));
        await SetBookAuditDatesAsync(context, laterManga.Id, new DateTimeOffset(2026, 1, 3, 9, 0, 0, TimeSpan.Zero));
        await SetBookAuditDatesAsync(context, unmatched.Id, new DateTimeOffset(2026, 1, 1, 9, 0, 0, TimeSpan.Zero));
        await SetBookAuditDatesAsync(context, otherOwner.Id, new DateTimeOffset(2026, 1, 1, 9, 0, 0, TimeSpan.Zero));
        var service = CreateAnalyticsQueryService(context);
        var criteria = BookSearchQueryParser.Parse("title:\"Growth Scope\"");

        var day = await service.GetAnalyticsAsync(
            database.UserId,
            criteria,
            new BookAnalyticsScopeSnapshot("title:\"Growth Scope\"", new DateOnly(2026, 1, 1),
                new DateOnly(2026, 1, 5), "day"),
            CancellationToken.None);

        Assert.Equal(5, day.Overview.TotalBooks);
        Assert.Equal(2, day.LibraryGrowth.OpeningCount);
        Assert.Equal(4, day.LibraryGrowth.Points.Count);
        AssertGrowthPoint(day, new DateOnly(2026, 1, 1), 2, 4, ("Manga", 1), ("Novel", 1));
        AssertGrowthPoint(day, new DateOnly(2026, 1, 2), 0, 4);
        AssertGrowthPoint(day, new DateOnly(2026, 1, 3), 1, 5, ("Manga", 1));
        AssertGrowthPoint(day, new DateOnly(2026, 1, 4), 0, 5);

        var month = await service.GetAnalyticsAsync(
            database.UserId,
            criteria,
            new BookAnalyticsScopeSnapshot("title:\"Growth Scope\"", new DateOnly(2025, 12, 31),
                new DateOnly(2026, 2, 1), "month"),
            CancellationToken.None);

        Assert.Equal(1, month.LibraryGrowth.OpeningCount);
        AssertGrowthPoint(month, new DateOnly(2025, 12, 31), 1, 2, ("Manhwa", 1));
        AssertGrowthPoint(month, new DateOnly(2026, 1, 1), 3, 5, ("Manga", 2), ("Novel", 1));

        static void AssertGrowthPoint(
            BookAnalyticsSnapshot snapshot,
            DateOnly date,
            int booksAdded,
            int cumulativeBooks,
            params (string Type, int BookCount)[] byType)
        {
            var point = Assert.Single(snapshot.LibraryGrowth.Points,
                item => item.Date == date);
            Assert.Equal(booksAdded, point.BooksAdded);
            Assert.Equal(cumulativeBooks, point.CumulativeBooks);
            Assert.Equal(byType.Select(item => item.Type).ToArray(), point.ByType.Select(item => item.Type).ToArray());
            Assert.Equal(byType.Select(item => item.BookCount).ToArray(),
                point.ByType.Select(item => item.BookCount).ToArray());
            Assert.Equal(booksAdded, point.ByType.Sum(item => item.BookCount));
        }
    }

    [Fact]
    public async Task BookAnalytics_ShouldAggregateQualityLinksAndCoversWithScopedDenominators()
    {
        using var database = new SqliteTestDatabase();
        await using var context = database.CreateContext();
        var otherOwnerId = Guid.Parse("16161616-1616-1616-1616-161616161616");
        context.Users.Add(new User
        {
            Id = otherOwnerId, UserName = "quality-other", NormalizedUserName = "QUALITY-OTHER"
        });
        var author = TestData.Author("Quality Author");
        var genre = TestData.Genre("Quality Genre");
        var tag = TestData.Tag(database.UserId, "quality-tag");
        context.Authors.Add(author);
        context.Genres.Add(genre);
        context.Tags.Add(tag);

        var complete = TestData.Book(database.UserId, "Quality Scope Complete", author);
        complete.Description = "Complete description";
        complete.Rating = 9;
        complete.Priority = 3;
        complete.TotalChapters = 100;
        complete.Titles.Add(new BookTitle
        {
            Title = "Quality Alternate",
            NormalizedTitle = MappingExtensions.NormalizeName("Quality Alternate"),
            IsPrimary = false,
            Source = "Test"
        });
        complete.BookGenres.Add(new BookGenre { Book = complete, Genre = genre });
        complete.BookTags.Add(new BookTag { Book = complete, Tag = tag });
        complete.Links.Add(new BookLink
        {
            Url = "https://nu.example/one", SourceType = "NovelUpdates", IsPrimary = true
        });
        complete.Links.Add(new BookLink
        {
            Url = "https://nu.example/two", SourceType = "NovelUpdates", IsPrimary = false
        });
        complete.Links.Add(
            new BookLink { Url = "https://wiki.example/one", SourceType = "Wikidata", IsPrimary = false });
        complete.Cover = new BookCover
        {
            Status = BookCoverStatus.Found,
            Source = BookCoverSource.NovelUpdates,
            StoragePath = "covers/complete.jpg"
        };

        var partial = TestData.Book(database.UserId, "Quality Scope Partial");
        partial.Description = "   ";
        partial.Titles.Add(new BookTitle { Title = "   ", NormalizedTitle = "", IsPrimary = false, Source = "Test" });
        partial.Links.Add(new BookLink { Url = "https://manual.example/one", SourceType = "Manual", IsPrimary = true });
        partial.Cover = new BookCover
        {
            Status = BookCoverStatus.Uploaded,
            Source = BookCoverSource.ManualUpload,
            ThumbnailStoragePath = "covers/partial.thumb.jpg"
        };

        var coverWithoutFile = TestData.Book(database.UserId, "Quality Scope Cover Missing File");
        coverWithoutFile.Cover = new BookCover { Status = BookCoverStatus.Found, Source = BookCoverSource.GoogleBooks };

        var failedCover = TestData.Book(database.UserId, "Quality Scope Failed Cover");
        failedCover.Cover = new BookCover { Status = BookCoverStatus.Failed, Source = null };

        var unmatched = TestData.Book(database.UserId, "Quality Outside Complete", author);
        unmatched.Description = "Outside";
        unmatched.Links.Add(new BookLink
        {
            Url = "https://outside.example", SourceType = "NovelUpdates", IsPrimary = true
        });
        unmatched.Cover = new BookCover
        {
            Status = BookCoverStatus.Found,
            Source = BookCoverSource.NovelUpdates,
            StoragePath = "covers/outside.jpg"
        };

        var otherOwner = TestData.Book(otherOwnerId, "Quality Scope Other Owner");
        otherOwner.Description = "Other";
        otherOwner.Links.Add(new BookLink
        {
            Url = "https://other.example", SourceType = "NovelUpdates", IsPrimary = true
        });
        otherOwner.Cover = new BookCover
        {
            Status = BookCoverStatus.Found, Source = BookCoverSource.NovelUpdates, StoragePath = "covers/other.jpg"
        };

        context.Books.AddRange(complete, partial, coverWithoutFile, failedCover, unmatched, otherOwner);
        await context.SaveChangesAsync();
        await SetBookAuditDatesAsync(context, new DateTimeOffset(2026, 1, 15, 10, 0, 0, TimeSpan.Zero), complete,
            partial, coverWithoutFile, failedCover, unmatched, otherOwner);
        var service = CreateAnalyticsQueryService(context);

        var result = await service.GetAnalyticsAsync(
            database.UserId,
            BookSearchQueryParser.Parse("title:\"Quality Scope\""),
            AnalyticsScope("title:\"Quality Scope\""),
            CancellationToken.None);

        Assert.Equal(4, result.Overview.TotalBooks);
        AssertCompleteness(result, "author", 1, 0.25d);
        AssertCompleteness(result, "description", 1, 0.25d);
        AssertCompleteness(result, "genre", 1, 0.25d);
        AssertCompleteness(result, "tag", 1, 0.25d);
        AssertCompleteness(result, "rating", 1, 0.25d);
        AssertCompleteness(result, "priority", 1, 0.25d);
        AssertCompleteness(result, "totalChapters", 1, 0.25d);
        AssertCompleteness(result, "link", 2, 0.5d);
        AssertCompleteness(result, "alternateTitle", 1, 0.25d);
        AssertCompleteness(result, "usableCover", 2, 0.5d);

        var novelUpdates =
            Assert.Single(result.Quality.LinkSources, item => item.Source == "NovelUpdates");
        Assert.Equal(2, novelUpdates.LinkCount);
        Assert.Equal(1, novelUpdates.BookCount);
        Assert.Equal(0.25d, novelUpdates.ShareOfBooks, 6);
        var manual =
            Assert.Single(result.Quality.LinkSources, item => item.Source == "Manual");
        Assert.Equal(1, manual.LinkCount);
        Assert.Equal(1, manual.BookCount);
        var wikidata =
            Assert.Single(result.Quality.LinkSources, item => item.Source == "Wikidata");
        Assert.Equal(1, wikidata.LinkCount);
        Assert.Equal(1, wikidata.BookCount);

        Assert.Equal(["Found", "Failed", "Uploaded"],
            result.Quality.CoverStatuses.Select(item => item.Status).ToArray());
        Assert.Equal(2, result.Quality.CoverStatuses.Single(item => item.Status == "Found").BookCount);
        Assert.Equal(["GoogleBooks", "ManualUpload", "NovelUpdates", "Unknown"],
            result.Quality.CoverSources.Select(item => item.Source).ToArray());
        Assert.Equal(1, result.Quality.CoverSources.Single(item => item.Source == "Unknown").BookCount);

        static void AssertCompleteness(
            BookAnalyticsSnapshot snapshot,
            string field,
            int bookCount,
            double share)
        {
            var item = Assert.Single(snapshot.Quality.FieldCompleteness,
                completeness => completeness.Field == field);
            Assert.Equal(bookCount, item.BookCount);
            Assert.Equal(share, item.ShareOfBooks, 6);
        }
    }

    [Fact]
    public async Task BookAnalytics_ShouldKeepQueryCountAndPayloadBoundedForBroadRequest()
    {
        using var database = new SqliteTestDatabase();
        await using (var seedContext = database.CreateContext())
        {
            await SeedAnalyticsPerformanceDatasetAsync(
                seedContext,
                database.UserId,
                300,
                4,
                24,
                24);
        }

        var commandCounter = new CountingCommandInterceptor();
        await using var context = database.CreateContext(commandCounter);
        var service = CreateAnalyticsQueryService(context);
        var started = DateTimeOffset.UtcNow;

        var result = await service.GetAnalyticsAsync(
            database.UserId,
            BookSearchCriteria.Empty,
            new BookAnalyticsScopeSnapshot(null, new DateOnly(2026, 7, 1), new DateOnly(2026, 8, 1),
                "week"),
            CancellationToken.None);
        var elapsed = DateTimeOffset.UtcNow - started;
        var payloadBytes = Encoding.UTF8.GetByteCount(JsonSerializer.Serialize(result.ToDto()));
        var artifact = WriteAnalyticsPerformanceArtifact(
            "bounded",
            result,
            commandCounter.CommandCount,
            elapsed,
            payloadBytes,
            await context.BookProgressHistory.CountAsync());

        Assert.Equal(300, result.Overview.TotalBooks);
        Assert.True(commandCounter.CommandCount <= 20,
            $"Analytics executed {commandCounter.CommandCount} SQL commands.");
        Assert.True(payloadBytes <= 100_000, "Analytics JSON payload exceeded 100 KB.");
        Assert.NotEmpty(result.Composition.Genres);
        Assert.NotEmpty(result.Composition.Tags);
        Assert.NotEmpty(result.Activity.Points);
        // Seeded books are created "now", so compare with the books that exist before the range end.
        var rangeEnd = new DateTimeOffset(2026, 8, 1, 0, 0, 0, TimeSpan.Zero);
        var createdBeforeRangeEnd = (await context.Books.Select(book => book.Created).ToListAsync())
            .Count(created => created < rangeEnd);
        Assert.Equal(createdBeforeRangeEnd, result.LibraryGrowth.Points.Last().CumulativeBooks);
        _output.WriteLine($"Analytics performance artifact: {artifact}");
    }

    [Fact]
    public async Task BookAnalytics_LargePerformanceHarness_ShouldRunWhenExplicitlyEnabled()
    {
        if (!string.Equals(Environment.GetEnvironmentVariable("RUN_ANALYTICS_PERF_TESTS"), "1",
                StringComparison.Ordinal))
        {
            return;
        }

        using var database = new SqliteTestDatabase();
        await using (var seedContext = database.CreateContext())
        {
            await SeedAnalyticsPerformanceDatasetAsync(
                seedContext,
                database.UserId,
                10_000,
                25,
                200,
                200);
        }

        var commandCounter = new CountingCommandInterceptor();
        await using var context = database.CreateContext(commandCounter);
        var service = CreateAnalyticsQueryService(context);
        var started = DateTimeOffset.UtcNow;

        var result = await service.GetAnalyticsAsync(
            database.UserId,
            BookSearchCriteria.Empty,
            new BookAnalyticsScopeSnapshot(null, new DateOnly(2026, 7, 1), new DateOnly(2026, 8, 1),
                "week"),
            CancellationToken.None);
        var elapsed = DateTimeOffset.UtcNow - started;
        var payloadBytes = Encoding.UTF8.GetByteCount(JsonSerializer.Serialize(result.ToDto()));
        var progressHistoryCount = await context.BookProgressHistory.CountAsync();
        var artifact = WriteAnalyticsPerformanceArtifact(
            "large",
            result,
            commandCounter.CommandCount,
            elapsed,
            payloadBytes,
            progressHistoryCount);

        Assert.Equal(10_000, result.Overview.TotalBooks);
        Assert.Equal(250_000, progressHistoryCount);
        Assert.True(commandCounter.CommandCount <= 20,
            $"Analytics executed {commandCounter.CommandCount} SQL commands.");
        Assert.True(payloadBytes <= 100_000, "Analytics JSON payload exceeded 100 KB.");
        Assert.True(elapsed < TimeSpan.FromSeconds(10), $"SQLite harness took {elapsed.TotalMilliseconds:N0} ms.");
        _output.WriteLine($"Analytics performance artifact: {artifact}");
    }

    [Fact]
    public async Task BookRepository_ShouldSearchAcrossFieldValuesAndDictionaryFields()
    {
        using var database = new SqliteTestDatabase();
        await using var context = database.CreateContext();
        var snapshot = await BookCsvDatasetSeeder.SeedAsync(context, database.UserId);
        var first = snapshot.Any;
        var tagged = snapshot.WithTag;
        var queryService = CreateReadQueryService(context);
        var titleCriteria = new BookSearchCriteria(
            Array.Empty<string>(),
            [new BookSearchFieldFilter(BookSearchField.Title, [first.PrimaryTitle, tagged.PrimaryTitle])],
            Array.Empty<BookSearchNumberFilter>());

        var titleOr = (await queryService.GetBooksAsync(
            database.UserId,
            titleCriteria,
            0,
            snapshot.BookCount,
            "title",
            "asc",
            CancellationToken.None)).ToList();
        var relationMatch = (await queryService.GetBooksAsync(
            database.UserId,
            new BookSearchCriteria(
                Array.Empty<string>(),
                [
                    new BookSearchFieldFilter(BookSearchField.Genre, tagged.Genres[0]),
                    new BookSearchFieldFilter(BookSearchField.Tag, tagged.Tags[0])
                ],
                Array.Empty<BookSearchNumberFilter>()),
            0,
            snapshot.BookCount,
            null,
            null,
            CancellationToken.None)).ToList();
        var dictionaryMatch = (await queryService.GetBooksAsync(
            database.UserId,
            new BookSearchCriteria(
                Array.Empty<string>(),
                [
                    new BookSearchFieldFilter(BookSearchField.Status, first.Status),
                    new BookSearchFieldFilter(BookSearchField.Type, first.ContentType)
                ],
                Array.Empty<BookSearchNumberFilter>()),
            0,
            snapshot.BookCount,
            null,
            null,
            CancellationToken.None)).ToList();

        Assert.Contains(titleOr, book => book.Id == first.Id);
        Assert.Contains(titleOr, book => book.Id == tagged.Id);
        Assert.Contains(relationMatch, book => book.Id == tagged.Id);
        Assert.All(relationMatch, book =>
        {
            Assert.True(book.GenresCount > 0);
            Assert.True(book.TagsCount > 0);
        });
        Assert.Contains(dictionaryMatch, book => book.Id == first.Id);
        Assert.All(dictionaryMatch, book =>
        {
            Assert.Equal(first.Status, book.Status);
            Assert.Equal(first.ContentType, book.ContentType);
        });
    }

    [Fact]
    public async Task BookRepository_ShouldApplyAllNumericSearchOperators()
    {
        using var database = new SqliteTestDatabase();
        await using var context = database.CreateContext();
        var low = await TestData.AddBookAsync(context, database.UserId, "Low");
        low.Rating = 3;
        low.Priority = 1;
        low.CurrentChapterNumber = 10;
        low.TotalChapters = 50;
        var mid = await TestData.AddBookAsync(context, database.UserId, "Mid");
        mid.Rating = 5;
        mid.Priority = 2;
        mid.CurrentChapterNumber = 20;
        mid.TotalChapters = 100;
        var high = await TestData.AddBookAsync(context, database.UserId, "High");
        high.Rating = 8;
        high.Priority = 4;
        high.CurrentChapterNumber = 40;
        high.TotalChapters = 200;
        var unknown = await TestData.AddBookAsync(context, database.UserId, "Unknown");
        unknown.Rating = null;
        unknown.Priority = null;
        unknown.CurrentChapterNumber = null;
        unknown.TotalChapters = null;
        await context.SaveChangesAsync();
        context.ChangeTracker.Clear();
        var queryService = CreateReadQueryService(context);

        async Task<Guid[]> FindIds(string query)
        {
            var books = await queryService.GetBooksAsync(database.UserId,
                BookSearchQueryParser.Parse(query), 0, 10, "title", "asc", CancellationToken.None);
            return books.Select(book => book.Id).ToArray();
        }

        async Task<Guid[]> FindIdsByNumber(BookSearchNumberField field, BookSearchOperator op, decimal value)
        {
            var criteria = new BookSearchCriteria(
                Array.Empty<string>(),
                Array.Empty<BookSearchFieldFilter>(),
                [new BookSearchNumberFilter(field, op, value)]);
            var books = await queryService.GetBooksAsync(database.UserId, criteria, 0,
                10, "title", "asc", CancellationToken.None);
            return books.Select(book => book.Id).ToArray();
        }

        Assert.Equal([high.Id], await FindIdsByNumber(BookSearchNumberField.Rating, BookSearchOperator.GreaterThan, 5));
        Assert.Equal([mid.Id],
            await FindIdsByNumber(BookSearchNumberField.CurrentChapter, BookSearchOperator.Equal, 20));
        Assert.Equal([low.Id, mid.Id],
            await FindIdsByNumber(BookSearchNumberField.Rating, BookSearchOperator.LessThanOrEqual, 5));
        Assert.Equal([low.Id], await FindIdsByNumber(BookSearchNumberField.Priority, BookSearchOperator.LessThan, 2));
        Assert.Equal([high.Id, mid.Id],
            await FindIdsByNumber(BookSearchNumberField.Priority, BookSearchOperator.GreaterThanOrEqual, 2));
        Assert.Equal([high.Id],
            await FindIdsByNumber(BookSearchNumberField.CurrentChapter, BookSearchOperator.GreaterThan, 20));
        Assert.Equal([low.Id, mid.Id],
            await FindIdsByNumber(BookSearchNumberField.CurrentChapter, BookSearchOperator.LessThanOrEqual, 20));
        Assert.Equal([high.Id], await FindIds("total:>100"));
        Assert.Equal([low.Id, mid.Id], await FindIds("chapters:<=100"));
    }

    [Fact]
    public async Task BookRepository_ShouldSortByLastProgressUpdatedDescendingByDefault()
    {
        using var database = new SqliteTestDatabase();
        await using var context = database.CreateContext();
        var snapshot = await BookCsvDatasetSeeder.SeedAsync(context, database.UserId);
        var newer = snapshot.Samples[^1];
        var olderTimestamp = DateTimeOffset.Parse("2026-07-01T10:00:00+00:00");
        var newerTimestamp = DateTimeOffset.Parse("2026-07-02T10:00:00+00:00");
        await context.Database.ExecuteSqlInterpolatedAsync(
            $"UPDATE Books SET LastProgressUpdatedAt = {olderTimestamp} WHERE OwnerId = {database.UserId}");
        await context.Database.ExecuteSqlInterpolatedAsync(
            $"UPDATE Books SET LastProgressUpdatedAt = {newerTimestamp} WHERE Id = {newer.Id}");
        context.ChangeTracker.Clear();
        var queryService = CreateReadQueryService(context);

        var books = (await queryService.GetBooksAsync(database.UserId, BookSearchCriteria.Empty, 0, 10, null, null,
            CancellationToken.None)).ToList();

        Assert.Equal(newer.Id, books[0].Id);
    }

    [Fact]
    public async Task BookRepository_ShouldSortTitlesCaseInsensitivelyAndDeterministically()
    {
        using var database = new SqliteTestDatabase();
        await using var context = database.CreateContext();
        var apple = await TestData.AddBookAsync(context, database.UserId, "apple");
        var bananaLower = await TestData.AddBookAsync(context, database.UserId, "banana");
        var bananaUpper = TestData.Book(database.UserId, "Banana");
        bananaUpper.ContentTypeId = Guid.Parse("10000000-0000-0000-0000-000000000002");
        context.Books.Add(bananaUpper);
        await context.SaveChangesAsync();
        var zebra = await TestData.AddBookAsync(context, database.UserId, "Zebra");
        var queryService = CreateReadQueryService(context);

        var ascending = (await queryService.GetBooksAsync(database.UserId, BookSearchCriteria.Empty, 0, 10, "title",
            "asc", CancellationToken.None)).ToList();
        var descending = (await queryService.GetBooksAsync(database.UserId, BookSearchCriteria.Empty, 0, 10, "title",
            "desc", CancellationToken.None)).ToList();

        Assert.Equal([apple.Id, bananaUpper.Id, bananaLower.Id, zebra.Id], ascending.Select(book => book.Id));
        Assert.Equal([zebra.Id, bananaLower.Id, bananaUpper.Id, apple.Id], descending.Select(book => book.Id));
    }

    [Fact]
    public async Task BookRepository_ShouldSortManagedListingsBeforePagination()
    {
        using var database = new SqliteTestDatabase();
        await using var context = database.CreateContext();
        var privateA = await TestData.AddBookAsync(context, database.UserId, "A private");
        var privateB = await TestData.AddBookAsync(context, database.UserId, "B private");
        var listedC = await TestData.AddBookAsync(context, database.UserId, "C listed");
        var listedZ = await TestData.AddBookAsync(context, database.UserId, "Z listed");
        context.PublicBookSnapshots.AddRange(
            CreateSnapshot(listedC),
            CreateSnapshot(listedZ));
        await context.SaveChangesAsync();
        var queryService = CreateReadQueryService(context);

        var firstPage = (await queryService.GetManagedBooksAsync(
            database.UserId, BookSearchCriteria.Empty, 0, 2, CancellationToken.None)).ToList();
        var secondPage = (await queryService.GetManagedBooksAsync(
            database.UserId, BookSearchCriteria.Empty, 2, 2, CancellationToken.None)).ToList();

        Assert.Equal([listedC.Id, listedZ.Id], firstPage.Select(item => item.Book.Id));
        Assert.All(firstPage, item => Assert.NotNull(item.Listing));
        Assert.Equal([privateA.Id, privateB.Id], secondPage.Select(item => item.Book.Id));
        Assert.All(secondPage, item => Assert.Null(item.Listing));

        PublicBookSnapshot CreateSnapshot(Book book)
        {
            return new PublicBookSnapshot
            {
                SourceBookId = book.Id,
                SourceBook = book,
                OwnerId = database.UserId,
                PrimaryTitle = book.PrimaryTitle,
                NormalizedPrimaryTitle = book.NormalizedPrimaryTitle,
                AlternativeTitlesJson = "[]",
                AuthorOtherNamesJson = "[]",
                ContentType = "Novel",
                GenresJson = "[]",
                TagsJson = "[]",
                PublicTagIdsJson = "[]",
                SnapshotAt = DateTimeOffset.Parse("2026-07-27T12:00:00+00:00")
            };
        }
    }

    [Fact]
    public async Task BookRepository_ShouldSortByTotalChaptersAlias()
    {
        using var database = new SqliteTestDatabase();
        await using var context = database.CreateContext();
        var snapshot = await BookCsvDatasetSeeder.SeedAsync(context, database.UserId);
        var queryService = CreateReadQueryService(context);
        var criteria = BookSearchQueryParser.Parse("chapters:>=0");

        var ascending = (await queryService.GetBooksAsync(database.UserId, criteria, 0, snapshot.BookCount, "chapters",
            "asc", CancellationToken.None)).ToList();
        var descending = (await queryService.GetBooksAsync(database.UserId, criteria, 0, snapshot.BookCount, "chapters",
            "desc", CancellationToken.None)).ToList();
        var expectedAscending = snapshot.Samples
            .Where(sample => sample.TotalChapters != null)
            .OrderBy(sample => sample.TotalChapters)
            .ThenBy(sample => sample.PrimaryTitle)
            .Select(sample => sample.Id)
            .ToArray();
        var expectedDescending = snapshot.Samples
            .Where(sample => sample.TotalChapters != null)
            .OrderByDescending(sample => sample.TotalChapters)
            .ThenBy(sample => sample.PrimaryTitle)
            .Select(sample => sample.Id)
            .ToArray();

        Assert.Equal(expectedAscending, ascending.Select(book => book.Id));
        Assert.Equal(expectedDescending, descending.Select(book => book.Id));
    }

    [Fact]
    public async Task BookRepository_ShouldSortByNumericOwnerAndDateFields()
    {
        using var database = new SqliteTestDatabase();
        await using var context = database.CreateContext();
        var otherOwnerId = Guid.Parse("77777777-7777-7777-7777-777777777777");
        context.Users.Add(new User { Id = otherOwnerId, UserName = "other-sort", NormalizedUserName = "OTHER-SORT" });
        var snapshot = await BookCsvDatasetSeeder.SeedAsync(context, database.UserId);
        var other = await TestData.AddBookAsync(context, otherOwnerId, "Other");
        var oldest = snapshot.Samples[^1];
        await context.Database.ExecuteSqlInterpolatedAsync(
            $"UPDATE Books SET Created = {DateTimeOffset.Parse("2026-07-02T00:00:00+00:00")} WHERE OwnerId = {database.UserId}");
        await context.Database.ExecuteSqlInterpolatedAsync(
            $"UPDATE Books SET Created = {DateTimeOffset.Parse("2026-07-01T00:00:00+00:00")} WHERE Id = {oldest.Id}");
        context.ChangeTracker.Clear();
        var queryService = CreateReadQueryService(context);
        var ratingCriteria = BookSearchQueryParser.Parse("rating:>=0");

        var ratingAsc =
            (await queryService.GetBooksAsync(database.UserId, ratingCriteria, 0, 10, "rating", "asc",
                CancellationToken.None)).ToList();
        var ratingDesc = (await queryService.GetBooksAsync(database.UserId, ratingCriteria, 0, 10, "rating", "desc",
            CancellationToken.None)).ToList();
        var priorityAsc = (await queryService.GetBooksAsync(database.UserId, BookSearchCriteria.Empty, 0, 10,
            "priority", "asc", CancellationToken.None)).ToList();
        var progressDesc = (await queryService.GetBooksAsync(database.UserId, BookSearchCriteria.Empty, 0, 10,
            "progress", "desc", CancellationToken.None)).ToList();
        var createdAsc = (await queryService.GetBooksAsync(database.UserId, BookSearchCriteria.Empty, 0, 10, "created",
            "asc", CancellationToken.None)).ToList();
        var ownerDesc =
            (await queryService.GetAdminBooksAsync(BookSearchCriteria.Empty, 0, 10, "owner", "desc",
                CancellationToken.None)).ToList();

        Assert.Equal(snapshot.Samples.Where(sample => sample.Rating != null).Min(sample => sample.Rating),
            ratingAsc[0].Rating);
        Assert.Equal(snapshot.Samples.Where(sample => sample.Rating != null).Max(sample => sample.Rating),
            ratingDesc[0].Rating);
        Assert.Equal(snapshot.Samples.Where(sample => sample.Priority != null).Min(sample => sample.Priority),
            priorityAsc[0].Priority);
        Assert.Equal(snapshot.Samples.Max(sample => sample.CurrentChapterNumber), progressDesc[0].CurrentChapterNumber);
        Assert.Equal(oldest.Id, createdAsc[0].Id);
        Assert.Equal(otherOwnerId, ownerDesc[0].OwnerId);
        Assert.Contains(ownerDesc, book => book.Id == other.Id);
    }

    [Fact]
    public async Task BookRepository_ShouldSortStatusAndTypeByDomainOrder()
    {
        using var database = new SqliteTestDatabase();
        await using var context = database.CreateContext();
        var novelReading = await TestData.AddBookAsync(context, database.UserId, "Novel Reading");
        var mangaCompleted = await TestData.AddBookAsync(context, database.UserId, "Manga Completed");
        var manhwaPlanToRead = await TestData.AddBookAsync(context, database.UserId, "Manhwa Plan To Read");

        mangaCompleted.ContentTypeId = Guid.Parse("10000000-0000-0000-0000-000000000002");
        mangaCompleted.StatusId = Guid.Parse("20000000-0000-0000-0000-000000000002");
        manhwaPlanToRead.ContentTypeId = Guid.Parse("10000000-0000-0000-0000-000000000003");
        manhwaPlanToRead.StatusId = Guid.Parse("20000000-0000-0000-0000-000000000003");
        await context.SaveChangesAsync();
        context.ChangeTracker.Clear();

        var queryService = CreateReadQueryService(context);
        const string novelTypeName = "Novel";
        const string mangaTypeName = "Manga";
        const string readingStatusName = "Reading";
        const string completedStatusName = "Completed";

        var typeAscending = (await queryService.GetBooksAsync(database.UserId, BookSearchCriteria.Empty, 0, 10, "type",
            novelTypeName, CancellationToken.None)).ToList();
        var typeRotated = (await queryService.GetBooksAsync(database.UserId, BookSearchCriteria.Empty, 0, 10, "type",
            mangaTypeName, CancellationToken.None)).ToList();
        var statusAscending = (await queryService.GetBooksAsync(database.UserId, BookSearchCriteria.Empty, 0, 10,
            "status", readingStatusName, CancellationToken.None)).ToList();
        var statusRotated = (await queryService.GetBooksAsync(database.UserId, BookSearchCriteria.Empty, 0, 10,
            "status", completedStatusName, CancellationToken.None)).ToList();

        Assert.Equal([novelReading.Id, mangaCompleted.Id, manhwaPlanToRead.Id], typeAscending.Select(book => book.Id));
        Assert.Equal([mangaCompleted.Id, manhwaPlanToRead.Id, novelReading.Id], typeRotated.Select(book => book.Id));
        Assert.Equal([novelReading.Id, mangaCompleted.Id, manhwaPlanToRead.Id],
            statusAscending.Select(book => book.Id));
        Assert.Equal([mangaCompleted.Id, manhwaPlanToRead.Id, novelReading.Id], statusRotated.Select(book => book.Id));
    }

    [Fact]
    public async Task BookRepository_ShouldResolveNextCycleDirectionUsingOnlyAvailableValues()
    {
        using var database = new SqliteTestDatabase();
        await using var context = database.CreateContext();
        var novelReading = await TestData.AddBookAsync(context, database.UserId, "Novel Reading");
        var mangaCompleted = await TestData.AddBookAsync(context, database.UserId, "Manga Completed");

        mangaCompleted.ContentTypeId = Guid.Parse("10000000-0000-0000-0000-000000000002");
        mangaCompleted.StatusId = Guid.Parse("20000000-0000-0000-0000-000000000002");
        await context.SaveChangesAsync();

        var queryService = CreateReadQueryService(context);
        const string missingTypeName = "Manhwa";
        const string missingStatusName = "Plan To Read";

        var nextType = await queryService.GetNextCycleSortDirectionAsync(database.UserId, BookSearchCriteria.Empty,
            "type", missingTypeName, CancellationToken.None);
        var nextStatus = await queryService.GetNextCycleSortDirectionAsync(database.UserId,
            BookSearchCriteria.Empty, "status", missingStatusName, CancellationToken.None);

        Assert.Equal("Novel", nextType);
        Assert.Equal("Reading", nextStatus);
    }

    [Fact]
    public async Task BookRepository_ShouldBuildSummaryForFilteredOwnerBooks()
    {
        using var database = new SqliteTestDatabase();
        await using var context = database.CreateContext();
        await BookCsvDatasetSeeder.SeedAsync(context, database.UserId);

        var queryService = CreateSummaryQueryService(context);
        var criteria = new BookSearchCriteria(
            Array.Empty<string>(),
            Array.Empty<BookSearchFieldFilter>(),
            [new BookSearchNumberFilter(BookSearchNumberField.Rating, BookSearchOperator.GreaterThanOrEqual, 1)]);

        var summary =
            await queryService.GetSummaryAsync(database.UserId, criteria, CancellationToken.None);
        var expectedBooks = await context.Books
            .AsNoTracking()
            .Include(book => book.Status)
            .Include(book => book.ContentType)
            .Include(book => book.BookGenres)
            .ThenInclude(bookGenre => bookGenre.Genre)
            .Where(book => book.OwnerId == database.UserId && book.Rating >= 1)
            .ToListAsync();

        Assert.Equal(expectedBooks.Count, summary.TotalBooks);
        Assert.Equal(expectedBooks.Count(book => book.Rating != null), summary.RatedBooks);
        Assert.Equal(expectedBooks.Average(book => book.Rating), summary.AverageRating);
        Assert.Equal(expectedBooks.Sum(book => book.CurrentChapterNumber ?? 0), summary.CurrentChapters);
        Assert.Equal(expectedBooks.Count(book => book.CurrentChapterNumber != null),
            summary.BooksWithKnownCurrentChapter);
        Assert.Equal(
            expectedBooks.GroupBy(book => book.Status.Name).OrderByDescending(group => group.Count())
                .ThenBy(group => group.Key).Select(group => group.Key),
            summary.StatusCounts.Select(item => item.Status));
        Assert.Equal(
            expectedBooks.GroupBy(book => book.ContentType.Name).OrderByDescending(group => group.Count())
                .ThenBy(group => group.Key).Select(group => group.Key),
            summary.TypeCounts.Select(item => item.Type));
        Assert.NotEmpty(summary.GenreCounts);
        Assert.Equal(
            expectedBooks.Where(book => book.Rating != null).GroupBy(book => book.Rating!.Value)
                .OrderBy(group => group.Key).Select(group => group.Key),
            summary.RatingCounts.Select(item => item.Rating));
    }

    [Fact]
    public async Task BookRepository_ShouldFilterAdminSearchWithSortingAndPaging()
    {
        using var database = new SqliteTestDatabase();
        await using var context = database.CreateContext();
        var otherOwnerId = Guid.Parse("55555555-5555-5555-5555-555555555555");
        context.Users.Add(new User
        {
            Id = otherOwnerId, UserName = "other-admin-search", NormalizedUserName = "OTHER-ADMIN-SEARCH"
        });

        await BookCsvDatasetSeeder.SeedAsync(context, database.UserId);
        var firstMatch = await TestData.AddBookAsync(context, database.UserId, "AAAA Admin Dataset Match");
        var secondMatch = await TestData.AddBookAsync(context, otherOwnerId, "AAAB Admin Dataset Match");
        var queryService = CreateReadQueryService(context);
        var criteria = BookSearchQueryParser.Parse("title:\"Admin Dataset Match\"");

        var firstPage = (await queryService.GetAdminBooksAsync(criteria, 0, 1, "title", "asc", CancellationToken.None))
            .ToList();
        var secondPage = (await queryService.GetAdminBooksAsync(criteria, 1, 1, "title", "asc", CancellationToken.None))
            .ToList();
        var count = await queryService.GetAdminBookCountAsync(criteria, CancellationToken.None);

        Assert.Equal(2, count);
        Assert.Single(firstPage);
        Assert.Single(secondPage);
        Assert.Equal(firstMatch.Id, firstPage[0].Id);
        Assert.Equal(secondMatch.Id, secondPage[0].Id);
    }

    [Fact]
    public async Task BookRepository_ShouldProjectUserAndAdminListsWithSharedBookFields()
    {
        using var database = new SqliteTestDatabase();
        await using var context = database.CreateContext();
        var snapshot = await BookCsvDatasetSeeder.SeedAsync(context, database.UserId);
        var sample = snapshot.WithNotes;
        const string sentinelTitle = "CSV Projection Sentinel";
        var book = await context.Books
            .Include(book => book.Cover)
            .Include(book => book.Titles)
            .FirstAsync(book => book.Id == sample.Id);
        book.PrimaryTitle = sentinelTitle;
        book.NormalizedPrimaryTitle = MappingExtensions.NormalizeName(sentinelTitle);
        var primaryTitle = book.Titles.Single(title => title.IsPrimary);
        primaryTitle.Title = sentinelTitle;
        primaryTitle.NormalizedTitle = MappingExtensions.NormalizeName(sentinelTitle);
        book.Description = new string('d', 100);
        book.Notes = new string('n', 100);
        book.Cover!.ThumbnailStoragePath = "11111111111111111111111111111111/example.thumb.jpg";
        book.Cover.StoragePath = "11111111111111111111111111111111/example.jpg";
        book.Cover.Status = BookCoverStatus.Found;
        book.Cover.ThumbnailMimeType = "image/jpeg";
        book.Cover.LastAttemptAt = DateTimeOffset.Parse("2026-07-13T10:15:30+00:00");
        await context.SaveChangesAsync();
        context.ChangeTracker.Clear();
        var queryService = CreateReadQueryService(context);
        var criteria = new BookSearchCriteria(
            Array.Empty<string>(),
            [new BookSearchFieldFilter(BookSearchField.Title, sentinelTitle)],
            Array.Empty<BookSearchNumberFilter>());

        var userList =
            (await queryService.GetBooksAsync(database.UserId, criteria, 0, 10, "title", "asc", CancellationToken.None))
            .ToList();
        var adminList = (await queryService.GetAdminBooksAsync(criteria, 0, 10, "title", "asc", CancellationToken.None))
            .ToList();

        var userItem = Assert.Single(userList);
        var adminItem = Assert.Single(adminList);
        Assert.Equal(userItem.Id, adminItem.Id);
        Assert.Equal(userItem.PrimaryTitle, adminItem.PrimaryTitle);
        Assert.Equal(userItem.Description, adminItem.Description);
        Assert.Equal(userItem.Notes, adminItem.Notes);
        Assert.Equal(100, userItem.Description!.Length);
        Assert.Equal(100, userItem.Notes!.Length);
        Assert.Equal(userItem.AlternativeTitles, adminItem.AlternativeTitles);
        Assert.Equal(userItem.Genres, adminItem.Genres);
        Assert.Equal(userItem.Tags, adminItem.Tags);
        Assert.Equal(userItem.Cover!.ImageUrl, adminItem.Cover!.ImageUrl);
        Assert.Equal(userItem.Cover.ThumbnailImageUrl, adminItem.Cover.ThumbnailImageUrl);
        Assert.Contains($"/api/v1/book/{book.Id}/cover/file?v=", userItem.Cover.ImageUrl);
        Assert.Contains($"/api/v1/book/{book.Id}/cover/thumbnail?v=", userItem.Cover.ThumbnailImageUrl);
        Assert.Equal(database.UserId, adminItem.OwnerId);
        Assert.False(string.IsNullOrWhiteSpace(adminItem.OwnerUsername));
    }

    [Fact]
    public async Task BookRepository_ShouldReturnNoAdminSearchResultsForMissingQuery()
    {
        using var database = new SqliteTestDatabase();
        await using var context = database.CreateContext();
        await BookCsvDatasetSeeder.SeedAsync(context, database.UserId);
        var queryService = CreateReadQueryService(context);
        var criteria = BookSearchQueryParser.Parse("title:__missing_csv_dataset_query__");

        var results = (await queryService.GetAdminBooksAsync(criteria, 0, 10, "title", "asc", CancellationToken.None))
            .ToList();
        var count = await queryService.GetAdminBookCountAsync(criteria, CancellationToken.None);

        Assert.Empty(results);
        Assert.Equal(0, count);
    }

    [Fact]
    public async Task BookExportQueryService_ShouldReturnFilteredSortedDetailedDtos()
    {
        using var database = new SqliteTestDatabase();
        await using var context = database.CreateContext();
        var snapshot = await BookCsvDatasetSeeder.SeedAsync(context, database.UserId);
        var sample = snapshot.WithTagAndRating;
        const string sentinelTitle = "CSV Export Sentinel";
        var matching = await context.Books
            .Include(book => book.Titles)
            .FirstAsync(book => book.Id == sample.Id);
        matching.PrimaryTitle = sentinelTitle;
        matching.NormalizedPrimaryTitle = MappingExtensions.NormalizeName(sentinelTitle);
        var primaryTitle = matching.Titles.Single(title => title.IsPrimary);
        primaryTitle.Title = sentinelTitle;
        primaryTitle.NormalizedTitle = MappingExtensions.NormalizeName(sentinelTitle);
        await context.SaveChangesAsync();
        context.ChangeTracker.Clear();
        var queryService = CreateExportQueryService(context);
        var criteria = new BookSearchCriteria(
            Array.Empty<string>(),
            [
                new BookSearchFieldFilter(BookSearchField.Title, sentinelTitle),
                new BookSearchFieldFilter(BookSearchField.Tag, sample.Tags[0])
            ],
            [
                new BookSearchNumberFilter(BookSearchNumberField.Rating, BookSearchOperator.GreaterThanOrEqual,
                    sample.Rating!.Value)
            ]);

        var result = await queryService.GetBooksForExportAsync(database.UserId, criteria, 0, 10,
            "title", "asc", CancellationToken.None);

        var book = Assert.Single(result.Data);
        Assert.Equal(1, result.Total);
        Assert.Equal(sentinelTitle, book.PrimaryTitle);
        Assert.Equal(sample.Notes, book.Notes);
        Assert.Equal(sample.CurrentChapterNumber, book.CurrentChapterNumber);
        Assert.Contains(sample.Tags[0], book.Tags);
        Assert.NotNull(book.Cover);
    }

    [Fact]
    public async Task BookRepository_ShouldReplaceCollectionsAfterDuplicateTitleLookup()
    {
        using var database = new SqliteTestDatabase();
        await using var context = database.CreateContext();
        var book = await TestData.AddBookWithRelationsAsync(context, database.UserId);
        var genreId = book.BookGenres.First().GenreId;
        var tagId = book.BookTags.First().TagId;
        var repository = new BookRepository(context);

        var editableBook = await repository.GetForUpdateAsync(book.Id, database.UserId, CancellationToken.None);
        var duplicateCheck = await repository.GetByNameAsync(book.PrimaryTitle, database.UserId, book.ContentTypeId,
            CancellationToken.None);

        Assert.NotNull(editableBook);
        Assert.NotNull(duplicateCheck);

        await repository.ReplaceEditableCollectionsAsync(
            book.Id,
            new[] { "Updated Title".ToPrimaryTitle() },
            Array.Empty<BookLink>(),
            new[] { genreId },
            new[] { tagId },
            null,
            CancellationToken.None);
        await repository.SaveAsync(CancellationToken.None);

        context.ChangeTracker.Clear();
        var savedBook = await context.Books
            .Include(b => b.BookGenres)
            .Include(b => b.BookTags)
            .Include(b => b.Titles)
            .FirstAsync(b => b.Id == book.Id);

        Assert.Single(savedBook.BookGenres);
        Assert.Single(savedBook.BookTags);
        Assert.Contains(savedBook.Titles, t => t.Title == "Updated Title");
    }

    [Fact]
    public async Task DictionaryRepositories_ShouldReturnDomainOrderedStatusesAndTypes()
    {
        using var database = new SqliteTestDatabase();
        await using var context = database.CreateContext();
        var statusRepository = new StatusRepository(context);
        var typeRepository = new TypeRepository(context);

        var statuses = (await statusRepository.GetAllAsync(0, 20, CancellationToken.None))
            .Select(status => status.Name).ToArray();
        var types = (await typeRepository.GetAllAsync(0, 20, CancellationToken.None)).Select(type => type.Name)
            .ToArray();

        Assert.Equal(["Reading", "Completed", "Plan To Read", "On Hold", "Dropped", "Unknown"], statuses);
        Assert.Equal(["Novel", "Manga", "Manhwa", "Manhua", "Other"], types);
    }

    [Fact]
    public async Task AuthorRepository_ShouldFindAuthorByAlias()
    {
        using var database = new SqliteTestDatabase();
        await using var context = database.CreateContext();
        var author = TestData.Author("Er Gen");
        author.Names.Add(new AuthorName
        {
            Name = "Eargen",
            NormalizedName = MappingExtensions.NormalizeName("Eargen"),
            IsPrimary = false,
            Source = "Test"
        });
        context.Authors.Add(author);
        await context.SaveChangesAsync();
        var repository = new AuthorRepository(context);

        var result = await repository.GetByNameAsync(database.UserId, "Eargen", CancellationToken.None);

        Assert.NotNull(result);
        Assert.Equal("Er Gen", result.PrimaryName);
    }

    [Fact]
    public async Task AuthorRepository_SearchShouldPreferPrivateAuthorAndHideOverlappingPublicAuthor()
    {
        using var database = new SqliteTestDatabase();
        await using var context = database.CreateContext();
        var publicOwnerId = Guid.Parse("55555555-5555-5555-5555-555555555555");
        context.Users.Add(new User
        {
            Id = publicOwnerId, UserName = "public-author-owner", NormalizedUserName = "PUBLIC-AUTHOR-OWNER"
        });
        var privateAuthor = TestData.Author("Local Pen Name", database.UserId, false);
        privateAuthor.Names.Add(new AuthorName
        {
            Name = "Shared Identity",
            NormalizedName = MappingExtensions.NormalizeName("Shared Identity"),
            IsPrimary = false,
            Source = "Test"
        });
        var publicAuthor = TestData.Author("Shared Identity", publicOwnerId, true);
        publicAuthor.Names.Add(new AuthorName
        {
            Name = "Global Alias",
            NormalizedName = MappingExtensions.NormalizeName("Global Alias"),
            IsPrimary = false,
            Source = "Test"
        });
        context.Authors.AddRange(privateAuthor, publicAuthor);
        await context.SaveChangesAsync();
        var repository = new AuthorRepository(context);

        var result = (await repository.SearchAsync(database.UserId, "Shared Identity", 10,
            CancellationToken.None)).ToList();

        var author = Assert.Single(result);
        Assert.Equal(privateAuthor.Id, author.Id);
        Assert.False(author.IsPublic);
    }

    [Fact]
    public async Task TagRepository_ShouldReturnOnlyOwnerTags()
    {
        using var database = new SqliteTestDatabase();
        await using var context = database.CreateContext();
        var otherOwnerId = Guid.Parse("44444444-4444-4444-4444-444444444444");
        context.Users.Add(new User { Id = otherOwnerId, UserName = "other", NormalizedUserName = "OTHER" });
        context.Tags.Add(TestData.Tag(database.UserId, "favorite"));
        context.Tags.Add(TestData.Tag(otherOwnerId, "favorite"));
        await context.SaveChangesAsync();
        var repository = new TagRepository(context);

        var result = (await repository.SearchAsync(database.UserId, "fav", 10, CancellationToken.None)).ToList();

        Assert.Single(result);
        Assert.Equal(database.UserId, result[0].OwnerId);
    }

    [Fact]
    public async Task TagRepository_ShouldMatchSeparatorAndSmallDistanceVariants()
    {
        using var database = new SqliteTestDatabase();
        await using var context = database.CreateContext();
        var tag = TestData.Tag(database.UserId, "Slice Of Life");
        context.Tags.Add(tag);
        await context.SaveChangesAsync();
        var repository = new TagRepository(context);

        var separatorResult = await repository.GetByNameAsync(database.UserId, "SLICE-OF-LIFE", CancellationToken.None);
        var distanceResult = await repository.GetByNameAsync(database.UserId, "SLICEOFLIFEE", CancellationToken.None);

        Assert.Equal(tag.Id, separatorResult?.Id);
        Assert.Equal(tag.Id, distanceResult?.Id);
        Assert.Equal("Slice Of Life", distanceResult?.Name);
    }

    [Fact]
    public async Task GenreRepository_ShouldPageAndCount()
    {
        using var database = new SqliteTestDatabase();
        await using var context = database.CreateContext();
        context.Genres.AddRange(TestData.Genre("Fantasy"), TestData.Genre("Drama"), TestData.Genre("Action"));
        await context.SaveChangesAsync();
        var repository = new GenreRepository(context);

        var page = (await repository.GetAllAsync(1, 1, CancellationToken.None)).ToList();
        var count = await repository.GetCountAsync(CancellationToken.None);

        Assert.Single(page);
        Assert.Equal(3, count);
    }

    [Fact]
    public async Task GenreRepository_ShouldMatchSeparatorAndSmallDistanceVariants()
    {
        using var database = new SqliteTestDatabase();
        await using var context = database.CreateContext();
        var genre = TestData.Genre("Slice Of Life");
        context.Genres.Add(genre);
        await context.SaveChangesAsync();
        var repository = new GenreRepository(context);

        var separatorResult = await repository.GetByNameAsync("SLICE-OF-LIFE", CancellationToken.None);
        var distanceResult = await repository.GetByNameAsync("SLICEOFLIFEE", CancellationToken.None);

        Assert.Equal(genre.Id, separatorResult?.Id);
        Assert.Equal(genre.Id, distanceResult?.Id);
        Assert.Equal("Slice Of Life", distanceResult?.Name);
    }

    private static async Task SeedAnalyticsPerformanceDatasetAsync(
        ApplicationDbContext context,
        Guid ownerId,
        int bookCount,
        int historyPerBook,
        int genreCount,
        int tagCount)
    {
        var genres = Enumerable.Range(0, genreCount)
            .Select(index => TestData.Genre($"Perf Genre {index:000}"))
            .ToArray();
        var tags = Enumerable.Range(0, tagCount)
            .Select(index => TestData.Tag(ownerId, $"perf-tag-{index:000}"))
            .ToArray();
        context.Genres.AddRange(genres);
        context.Tags.AddRange(tags);
        await context.SaveChangesAsync();

        var genreIds = genres.Select(genre => genre.Id).ToArray();
        var tagIds = tags.Select(tag => tag.Id).ToArray();
        context.ChangeTracker.Clear();

        const int batchSize = 500;
        for (var batchStart = 0; batchStart < bookCount; batchStart += batchSize)
        {
            var batchEnd = Math.Min(batchStart + batchSize, bookCount);
            for (var index = batchStart; index < batchEnd; index++)
            {
                var book = TestData.Book(ownerId, $"Perf Analytics Book {index:00000}");
                book.ContentTypeId = Guid.Parse($"10000000-0000-0000-0000-00000000000{index % 5 + 1}");
                book.StatusId = Guid.Parse($"20000000-0000-0000-0000-00000000000{index % 6 + 1}");
                book.Rating = index % 4 == 0 ? null : index % 10 + 1;
                book.Priority = index % 6 == 0 ? null : index % 5 + 1;
                book.CurrentChapterNumber = index % 7 == 0 ? null : index % 250 + 1;
                book.TotalChapters = index % 8 == 0 ? null : 300;
                book.Description = index % 5 == 0 ? null : $"Performance description {index}";
                book.BookGenres.Add(new BookGenre { Book = book, GenreId = genreIds[index % genreIds.Length] });
                book.BookGenres.Add(new BookGenre { Book = book, GenreId = genreIds[(index + 7) % genreIds.Length] });
                book.BookTags.Add(new BookTag { Book = book, TagId = tagIds[index % tagIds.Length] });
                book.BookTags.Add(new BookTag { Book = book, TagId = tagIds[(index + 11) % tagIds.Length] });
                book.Links.Add(new BookLink
                {
                    Url = $"https://example.com/{index}",
                    SourceType = index % 2 == 0 ? "NovelUpdates" : "Manual",
                    IsPrimary = true
                });
                if (index % 3 == 0)
                {
                    book.Titles.Add(new BookTitle
                    {
                        Title = $"Perf Alt {index:00000}",
                        NormalizedTitle = MappingExtensions.NormalizeName($"Perf Alt {index:00000}"),
                        IsPrimary = false,
                        Source = "Perf"
                    });
                }

                book.Cover = new BookCover
                {
                    Status = index % 4 == 0 ? BookCoverStatus.Failed : BookCoverStatus.Found,
                    Source = index % 4 == 0 ? null : BookCoverSource.NovelUpdates,
                    StoragePath = index % 4 == 0 ? null : $"perf/{index}.jpg"
                };

                var baseline = new DateTimeOffset(2026, 6, 30, 12, 0, 0, TimeSpan.Zero);
                for (var historyIndex = 0; historyIndex < historyPerBook; historyIndex++)
                {
                    book.ProgressHistory.Add(new BookProgressHistory
                    {
                        ChangedAt = historyIndex == 0
                            ? baseline
                            : new DateTimeOffset(2026, 7, historyIndex % 28 + 1, 12, 0, 0, TimeSpan.Zero),
                        ChapterNumber = historyIndex,
                        ChapterLabel = historyIndex.ToString(CultureInfo.InvariantCulture)
                    });
                }

                context.Books.Add(book);
            }

            await context.SaveChangesAsync();
            context.ChangeTracker.Clear();
        }
    }

    private string WriteAnalyticsPerformanceArtifact(
        string scenario,
        BookAnalyticsSnapshot snapshot,
        int commandCount,
        TimeSpan elapsed,
        int payloadBytes,
        int progressHistoryCount)
    {
        var root = FindRepositoryRoot();
        var outputDirectory = Path.Combine(root, "TestResults");
        Directory.CreateDirectory(outputDirectory);
        var path = Path.Combine(outputDirectory, $"analytics-performance-NB-066-{scenario}.json");
        var artifact = new
        {
            Scenario = scenario,
            GeneratedAt = DateTimeOffset.UtcNow,
            ElapsedMilliseconds = Math.Round(elapsed.TotalMilliseconds, 2),
            SqlCommandCount = commandCount,
            PayloadBytes = payloadBytes,
            Limits = new { MaxSqlCommands = 20, MaxPayloadBytes = 100_000, MaxLargeHarnessMilliseconds = 10_000 },
            DataSet =
                new
                {
                    Books = snapshot.Overview.TotalBooks,
                    ProgressHistory = progressHistoryCount,
                    RatedBooks = snapshot.Ratings.RatedBooks,
                    UnratedBooks = snapshot.Ratings.UnratedBooks,
                    CurrentChapters = snapshot.Overview.CurrentChapters
                },
            Buckets =
                new
                {
                    ActivityPoints = snapshot.Activity.Points.Count,
                    LibraryGrowthPoints = snapshot.LibraryGrowth.Points.Count
                },
            Categories = new
            {
                StatusByType = snapshot.Composition.StatusByType.Count,
                Genres = snapshot.Composition.Genres.Count,
                Tags = snapshot.Composition.Tags.Count,
                TypeVolumes = snapshot.Progress.TypeVolumes.Count,
                LinkSources = snapshot.Quality.LinkSources.Count,
                CoverStatuses = snapshot.Quality.CoverStatuses.Count,
                CoverSources = snapshot.Quality.CoverSources.Count
            }
        };

        File.WriteAllText(path, JsonSerializer.Serialize(artifact, new JsonSerializerOptions { WriteIndented = true }));
        _output.WriteLine($"Elapsed: {elapsed.TotalMilliseconds:N0} ms");
        _output.WriteLine($"SQL commands: {commandCount}");
        _output.WriteLine($"Payload: {payloadBytes:N0} bytes");
        _output.WriteLine($"Books: {snapshot.Overview.TotalBooks:N0}, progress history: {progressHistoryCount:N0}");
        return path;
    }

    private static string FindRepositoryRoot()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory is not null && !Directory.Exists(Path.Combine(directory.FullName, ".git")))
        {
            directory = directory.Parent;
        }

        return directory?.FullName ?? AppContext.BaseDirectory;
    }

    private sealed class CountingCommandInterceptor : DbCommandInterceptor
    {
        public int CommandCount { get; private set; }

        public override InterceptionResult<DbDataReader> ReaderExecuting(
            DbCommand command,
            CommandEventData eventData,
            InterceptionResult<DbDataReader> result)
        {
            CommandCount++;
            return base.ReaderExecuting(command, eventData, result);
        }

        public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(
            DbCommand command,
            CommandEventData eventData,
            InterceptionResult<DbDataReader> result,
            CancellationToken cancellationToken = default)
        {
            CommandCount++;
            return base.ReaderExecutingAsync(command, eventData, result, cancellationToken);
        }

        public override InterceptionResult<object> ScalarExecuting(
            DbCommand command,
            CommandEventData eventData,
            InterceptionResult<object> result)
        {
            CommandCount++;
            return base.ScalarExecuting(command, eventData, result);
        }

        public override ValueTask<InterceptionResult<object>> ScalarExecutingAsync(
            DbCommand command,
            CommandEventData eventData,
            InterceptionResult<object> result,
            CancellationToken cancellationToken = default)
        {
            CommandCount++;
            return base.ScalarExecutingAsync(command, eventData, result, cancellationToken);
        }
    }
}
