namespace Infrastructure.IntegrationTests;

using Application.Common;
using Application.Common.Interfaces;
using Application.Features.BookFeatures.Commands;
using Api.Controllers;
using Domain.Entities;
using Infrastructure.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Persistence;
using TestSupport;

public sealed class MetadataPolicyTests
{
    [Fact]
    public async Task HtmlPreviewUsesRawAliasesBeforeHeuristicsAndAddsRequiredGenres()
    {
        using var database = new SqliteTestDatabase();
        await using var context = database.CreateContext();
        var angels = GlobalTag("Angels");
        var adult = TestData.Genre("Adult");
        context.AddRange(angels, adult, Alias("tag", "Angel", angels.Id),
            new MetadataImplication { SourceTagId = angels.Id, TargetGenreId = adult.Id });
        await context.SaveChangesAsync();
        var parser = new Infrastructure.BookMetadata.BookHtmlParser(
            [new Infrastructure.BookMetadata.NovelUpdatesHtmlResolver()], new GenreRepository(context),
            new TypeRepository(context), new TagRepository(context), new TestUser(database.UserId), new MetadataPolicy(context));
        var result = await parser.ParseAsync("""
            <html><head><link rel="canonical" href="https://www.novelupdates.com/series/policy/"></head><body><h1 class="seriestitlenu">Policy preview</h1>
            <div id="showtags"><a class="genre">ANGEL</a></div></body></html>
            """, default);
        Assert.Equal(["Angels"], result.Tags);
        Assert.Equal(adult.Id, Assert.Single(result.Genres).Id);
    }

    [Fact]
    public async Task AliasesOverrideExistingNamesAndSupportBothDirectionsAcrossKinds()
    {
        using var database = new SqliteTestDatabase();
        await using var context = database.CreateContext();
        var angels = GlobalTag("Angels");
        var oldTag = TestData.Tag(database.UserId, "Angel");
        var adult = TestData.Genre("Adult");
        context.AddRange(angels, oldTag, adult);
        context.AddRange(Alias("tag", "Angel", angels.Id), Alias("tag", "mature", genreId: adult.Id),
            Alias("genre", "celestial", angels.Id));
        await context.SaveChangesAsync();

        var result = await new MetadataPolicy(context).ResolveImportAsync(database.UserId,
            [" ANGEL ", "mature", "new tag"], ["celestial"], CancellationToken.None);
        Assert.Equal(["Angels", "new tag"], result.Tags.Order());
        Assert.Equal([adult.Id], result.GenreIds);
        Assert.Equal(angels.Id, (await new TagRepository(context).GetByNameAsync(database.UserId, "angel", default))!.Id);
    }

    [Fact]
    public async Task AliasToTagThatIsNoLongerGlobalKeepsTheIncomingName()
    {
        using var database = new SqliteTestDatabase();
        await using var context = database.CreateContext();
        var demoted = TestData.Tag(database.UserId, "Celestial beings");
        context.AddRange(demoted, Alias("tag", "Angel", demoted.Id));
        await context.SaveChangesAsync();

        var result = await new MetadataPolicy(context).ResolveImportAsync(database.UserId, ["Angel"], [], default);
        Assert.Equal(["Angel"], result.Tags);
    }

    [Fact]
    public async Task ImplicationsAreTransitiveIdempotentAndCycleSafe()
    {
        using var database = new SqliteTestDatabase();
        await using var context = database.CreateContext();
        var gore = GlobalTag("Gore");
        var violence = GlobalTag("Violence");
        var adult = TestData.Genre("Adult");
        context.AddRange(gore, violence, adult);
        context.AddRange(
            new MetadataImplication { SourceTagId = gore.Id, TargetGenreId = adult.Id },
            new MetadataImplication { SourceGenreId = adult.Id, TargetTagId = violence.Id },
            new MetadataImplication { SourceTagId = violence.Id, TargetTagId = gore.Id });
        await context.SaveChangesAsync();
        var policy = new MetadataPolicy(context);
        var result = await policy.ResolveAsync(database.UserId, ["Gore", "gore"], [], default);
        Assert.Equal(["Gore", "Violence"], result.Tags.Order());
        Assert.Equal([adult.Id], result.GenreIds);
        var again = await policy.ResolveAsync(database.UserId, result.Tags, result.GenreIds, default);
        Assert.Equal(result.Tags.Order(), again.Tags.Order());
        Assert.Equal(result.GenreIds, again.GenreIds);
    }

    [Fact]
    public async Task BookCreateAndUpdatePersistRequiredGenreEvenWhenOmittedByClient()
    {
        using var database = new SqliteTestDatabase();
        await using var context = database.CreateContext();
        var gore = GlobalTag("Gore");
        var adult = TestData.Genre("Adult");
        context.AddRange(gore, adult, Alias("tag", "gory", gore.Id),
            new MetadataImplication { SourceTagId = gore.Id, TargetGenreId = adult.Id });
        await context.SaveChangesAsync();
        var user = new TestUser(database.UserId);
        var repository = new BookRepository(context);
        var cache = new NoopCache();
        var policy = new MetadataPolicy(context);
        var create = new CreateBookHandler(repository, new AuthorRepository(context), new TypeRepository(context),
            new StatusRepository(context), new GenreRepository(context), new TagRepository(context), new NoopCoverQueue(),
            cache, user, policy);
        var id = await create.Handle(new CreateBookCommand("Policy book", TestData.NovelTypeId,
            TestData.ReadingStatusId, null, null, null, [], ["gory"], null, null, null,
            null, null, null, null, null, null), default);
        context.ChangeTracker.Clear();
        var stored = await repository.GetByIdAsync(id, database.UserId, default);
        Assert.Equal(gore.Id, Assert.Single(stored!.BookTags).TagId);
        Assert.Equal(adult.Id, Assert.Single(stored.BookGenres).GenreId);

        var update = new UpdateBookHandler(repository, new AuthorRepository(context), new TypeRepository(context),
            new StatusRepository(context), new GenreRepository(context), new TagRepository(context), cache, user, policy);
        await update.Handle(new UpdateBookCommand(id, "Policy book", TestData.NovelTypeId,
            TestData.ReadingStatusId, null, null, null, [], ["Gore"], null, null, null,
            null, null, null, null, null, null), default);
        context.ChangeTracker.Clear();
        stored = await repository.GetByIdAsync(id, database.UserId, default);
        Assert.Equal(adult.Id, Assert.Single(stored!.BookGenres).GenreId);
        Assert.False(await context.Tags.AnyAsync(t => t.Name == "gory"));
    }

    [Fact]
    public async Task AdminRejectsPrivateTargetsAndReviewIncludesPrivateTagsWithoutDescriptions()
    {
        using var database = new SqliteTestDatabase();
        await using var context = database.CreateContext();
        var tag = TestData.Tag(database.UserId, "private");
        context.Add(tag);
        await context.SaveChangesAsync();
        var controller = new MetadataPolicyController(context, new MetadataPolicy(context), new TestUser(database.UserId));
        Assert.IsType<BadRequestObjectResult>(await controller.SetAlias(new("tag", "alias", tag.Id, null), default));
        var review = Assert.IsType<OkObjectResult>(await controller.Review(cancellationToken: default));
        var json = System.Text.Json.JsonSerializer.SerializeToElement(review.Value);
        Assert.Equal(1, json.GetProperty("total").GetInt32());
        Assert.Equal("private", json.GetProperty("data")[0].GetProperty("Name").GetString());
    }

    [Fact]
    public async Task PaginationDoesNotRepeatOrExposeOtherOwnersMetadata()
    {
        using var database = new SqliteTestDatabase();
        await using var context = database.CreateContext();
        for (var i = 0; i < 55; i++)
        {
            context.Add(TestData.Tag(database.UserId, $"Tag {i:D3}"));
            context.Add(TestData.Author($"Author {i:D3}", database.UserId, false));
        }
        var otherOwner = Guid.NewGuid();
        context.Users.Add(new Infrastructure.Identity.User { Id = otherOwner, UserName = "other", NormalizedUserName = "OTHER" });
        context.Add(TestData.Author("Hidden", otherOwner, false));
        context.Add(TestData.Tag(otherOwner, "Hidden"));
        await context.SaveChangesAsync();
        var tags = new TagRepository(context);
        var first = (await tags.SearchAsync(database.UserId, null, 50, default)).ToArray();
        var next = (await tags.SearchAsync(database.UserId, null, 50, default, 50)).ToArray();
        Assert.Equal(50, first.Length);
        Assert.Equal(5, next.Length);
        Assert.Empty(first.Select(t => t.Id).Intersect(next.Select(t => t.Id)));
        var authors = (await new AuthorRepository(context).SearchAsync(database.UserId, null, 50, default, 50)).ToArray();
        Assert.Equal(5, authors.Length);
        Assert.All(authors, a => Assert.Equal(database.UserId, a.OwnerId));
    }

    private static Tag GlobalTag(string name) => new() { Name = name, NormalizedName = MappingExtensions.NormalizeName(name), IsGlobal = true };
    private static MetadataAlias Alias(string kind, string name, Guid? tagId = null, Guid? genreId = null) => new()
    {
        SourceKind = kind, Name = name, NormalizedName = MappingExtensions.NormalizeName(name), TagId = tagId, GenreId = genreId
    };
    private sealed class NoopCache : IBookListCacheInvalidator
    {
        public Task InvalidateBooksAsync(Guid ownerId, CancellationToken cancellationToken) => Task.CompletedTask;
    }
    private sealed class NoopCoverQueue : IBookCoverQueue
    {
        public ValueTask QueueAsync(Guid bookId, CancellationToken cancellationToken) => ValueTask.CompletedTask;
    }
    private sealed class TestUser(Guid id) : IUser
    {
        public Guid? Id => id;
        public Guid RequiredId => id;
        public string? Email => null;
        public string? Username => null;
        public IEnumerable<string> Roles => [AuthorizationRoles.Admin];
        public bool IsAuthenticated => true;
        public bool Valid => true;
    }
}
