namespace Application.UnitTests;

using Common;
using Common.Interfaces;
using Domain.Associations;
using Domain.Entities;
using Domain.Exceptions;
using Domain.Repositories;
using Features.AuthorFeatures.Commands;
using Features.TagFeatures.Commands;

public class ManageMetadataFeatureTests
{
    private static readonly Guid OwnerId = Guid.Parse("11111111-1111-1111-1111-111111111111");

    [Fact]
    public async Task UpdateTag_ShouldOnlyUpdateCurrentUsersTagAndNormalizeDescription()
    {
        var tag = CreateTag(OwnerId, "favorite");
        var repository = new FakeTagRepository(tag, CreateTag(Guid.NewGuid(), "favorite"));
        var handler = new UpdateTagCommandHandler(repository, new FakeUser());

        var result = await handler.Handle(
            new UpdateTagCommand { Id = tag.Id, Description = "  Worth rereading  " }, CancellationToken.None);

        Assert.Equal("Worth rereading", result.Description);
        Assert.Equal("Worth rereading", tag.Description);
        Assert.Equal(1, repository.SaveCount);
    }

    [Fact]
    public async Task CreateTag_ShouldCreatePrivateTagButRejectGlobalName()
    {
        var global = CreateTag(null, "official");
        global.IsGlobal = true;
        var repository = new FakeTagRepository(global);
        var handler = new CreateTagCommandHandler(repository, new FakeUser());

        var created = await handler.Handle(new CreateTagCommand("to review", " Later "), CancellationToken.None);
        Assert.False(created.IsGlobal);
        Assert.Equal("Later", created.Description);

        await Assert.ThrowsAsync<EntityAlreadyExistsException<Tag, Guid>>(() =>
            handler.Handle(new CreateTagCommand("official"), CancellationToken.None));
    }

    [Fact]
    public async Task CreateAuthor_ShouldCreatePrimaryAndAlternativeNames()
    {
        var repository = new FakeAuthorRepository();
        var handler = new CreateAuthorCommandHandler(repository, new FakeUser());

        var created = await handler.Handle(new CreateAuthorCommand("New Author", ["Pen Name"]), CancellationToken.None);

        Assert.Equal("New Author", created.PrimaryName);
        Assert.Equal(["Pen Name"], created.OtherNames);
        Assert.False(created.IsPublic);
        Assert.True(created.IsOwned);
    }

    [Fact]
    public async Task DeleteTag_ShouldRejectTagStillUsedByBook()
    {
        var tag = CreateTag(OwnerId, "favorite");
        tag.BookTags.Add(new BookTag { Tag = tag });
        var repository = new FakeTagRepository(tag);
        var handler = new DeleteTagCommandHandler(repository, new FakeUser());

        await Assert.ThrowsAsync<EntityInUseException<Tag>>(() =>
            handler.Handle(new DeleteTagCommand(tag.Id), CancellationToken.None));

        Assert.False(repository.Deleted);
    }

    [Fact]
    public async Task UpdateAuthor_ShouldReplaceAliasesAndIgnoreWhitespaceEquivalentPrimaryName()
    {
        var author = CreateAuthor("Er Gen", "Old alias");
        var repository = new FakeAuthorRepository(author);
        var handler = new UpdateAuthorCommandHandler(repository, new FakeUser());

        var result =
            await handler.Handle(new UpdateAuthorCommand { Id = author.Id, OtherNames = [" 耳根 ", "Ergen", "Er Gen"] },
                CancellationToken.None);

        Assert.Equal("Er Gen", author.PrimaryName);
        Assert.Equal(["耳根"], result.OtherNames);
        Assert.True(result.IsOwned);
        Assert.Single(author.Names, name => name.IsPrimary);
        Assert.Equal(1, repository.SaveCount);
    }

    [Fact]
    public async Task UpdateAuthor_ShouldRejectAliasAssignedToAnotherAuthor()
    {
        var author = CreateAuthor("Er Gen");
        var other = CreateAuthor("Cuttlefish That Loves Diving", "Cuttlefish");
        var handler = new UpdateAuthorCommandHandler(new FakeAuthorRepository(author, other), new FakeUser());

        await Assert.ThrowsAsync<EntityAlreadyExistsException<Author, Guid>>(() =>
            handler.Handle(new UpdateAuthorCommand { Id = author.Id, OtherNames = ["Cuttlefish"] },
                CancellationToken.None));
    }

    [Fact]
    public async Task UpdateAuthor_ShouldHideAuthorCreatedByAnotherUser()
    {
        var author = CreateAuthor("Er Gen");
        author.OwnerId = Guid.Parse("22222222-2222-2222-2222-222222222222");
        var handler = new UpdateAuthorCommandHandler(new FakeAuthorRepository(author), new FakeUser());

        await Assert.ThrowsAsync<EntityNotFoundException<Author, Guid>>(() =>
            handler.Handle(new UpdateAuthorCommand { Id = author.Id, OtherNames = ["Ergen"] },
                CancellationToken.None));
    }

    [Fact]
    public async Task DeleteAuthor_ShouldRejectAuthorStillUsedByBook()
    {
        var author = CreateAuthor("Er Gen");
        author.Books.Add(new Book
        {
            OwnerId = OwnerId, PrimaryTitle = "Renegade Immortal", NormalizedPrimaryTitle = "RENEGADEIMMORTAL"
        });
        var lifecycle = new FakeAuthorLifecycleService(author);
        var handler = new DeleteAuthorCommandHandler(lifecycle, new FakeUser());

        await Assert.ThrowsAsync<EntityInUseException<Author>>(() =>
            handler.Handle(new DeleteAuthorCommand(author.Id), CancellationToken.None));

        Assert.False(lifecycle.Deleted);
    }

    private static Tag CreateTag(Guid? ownerId, string name)
    {
        return new Tag { OwnerId = ownerId, Name = name, NormalizedName = MappingExtensions.NormalizeName(name) };
    }

    private static Author CreateAuthor(string primaryName, params string[] aliases)
    {
        var author = new Author
        {
            PrimaryName = primaryName,
            NormalizedPrimaryName = MappingExtensions.NormalizeName(primaryName),
            OwnerId = OwnerId
        };
        author.Names.Add(new AuthorName
        {
            Name = primaryName, NormalizedName = MappingExtensions.NormalizeName(primaryName), IsPrimary = true
        });
        foreach (var alias in aliases)
        {
            author.Names.Add(new AuthorName
            {
                Name = alias, NormalizedName = MappingExtensions.NormalizeName(alias), IsPrimary = false
            });
        }

        return author;
    }

    private sealed class FakeUser : IUser
    {
        public Guid? Id => OwnerId;
        public Guid RequiredId => OwnerId;
        public string? Email => "reader@example.com";
        public string? Username => "reader";
        public IEnumerable<string> Roles => [];
        public bool IsAuthenticated => true;
        public bool Valid => true;
    }

    private sealed class FakeTagRepository(params Tag[] tags) : ITagRepository
    {
        private readonly List<Tag> _tags = [..tags];
        public int SaveCount { get; private set; }
        public bool Deleted { get; private set; }

        public Task<Tag?> GetByIdAsync(Guid ownerId, Guid id, CancellationToken cancellationToken)
        {
            return Task.FromResult(_tags.FirstOrDefault(tag => tag.OwnerId == ownerId && tag.Id == id));
        }

        public Task<Tag?> GetByNameAsync(Guid ownerId, string name, CancellationToken cancellationToken)
        {
            return Task.FromResult(_tags.FirstOrDefault(tag => (tag.IsGlobal || tag.OwnerId == ownerId) &&
                                                               tag.NormalizedName ==
                                                               MappingExtensions.NormalizeName(name)));
        }

        public Task<IEnumerable<Tag>> GetByNamesAsync(Guid ownerId, IEnumerable<string> names,
            CancellationToken cancellationToken)
        {
            return Task.FromResult<IEnumerable<Tag>>([]);
        }

        public Task<IEnumerable<Tag>> SearchAsync(Guid ownerId, string? search, int take,
            CancellationToken cancellationToken, int skip = 0)
        {
            return Task.FromResult<IEnumerable<Tag>>([]);
        }

        public Task AddAsync(Tag tag, CancellationToken cancellationToken)
        {
            _tags.Add(tag);
            return Task.CompletedTask;
        }

        public Task DeleteAsync(Tag tag, CancellationToken cancellationToken)
        {
            Deleted = true;
            _tags.Remove(tag);
            return Task.CompletedTask;
        }

        public Task SaveAsync(CancellationToken cancellationToken)
        {
            SaveCount++;
            return Task.CompletedTask;
        }
    }

    private sealed class FakeAuthorRepository(params Author[] authors) : IAuthorRepository
    {
        private readonly List<Author> _authors = [..authors];
        public int SaveCount { get; private set; }
        public bool Deleted { get; private set; }

        public Task<Author?> GetByIdAsync(Guid id, CancellationToken cancellationToken)
        {
            return Task.FromResult(_authors.FirstOrDefault(author => author.Id == id));
        }

        public Task<Author?> GetByNameAsync(Guid ownerId, string name, CancellationToken cancellationToken)
        {
            var normalized = MappingExtensions.NormalizeName(name);
            return Task.FromResult(_authors.FirstOrDefault(author =>
                author.NormalizedPrimaryName == normalized ||
                author.Names.Any(alias => alias.NormalizedName == normalized)));
        }

        public Task<Author?> GetPublicByNameAsync(string name, CancellationToken cancellationToken)
        {
            var normalized = MappingExtensions.NormalizeName(name);
            return Task.FromResult(_authors.FirstOrDefault(author => author.IsPublic &&
                                                                     (author.NormalizedPrimaryName == normalized ||
                                                                      author.Names.Any(alias =>
                                                                          alias.NormalizedName == normalized))));
        }

        public Task<IEnumerable<Author>> SearchAsync(Guid ownerId, string? search, int take,
            CancellationToken cancellationToken, int skip = 0)
        {
            return Task.FromResult<IEnumerable<Author>>(_authors.Take(take));
        }

        public Task<IEnumerable<Author>> SearchOwnedAsync(Guid ownerId, string? search, int take,
            CancellationToken cancellationToken, int skip = 0)
        {
            return Task.FromResult<IEnumerable<Author>>(_authors.Where(author => author.OwnerId == ownerId)
                .Take(take));
        }

        public Task AddAsync(Author author, CancellationToken cancellationToken)
        {
            _authors.Add(author);
            return Task.CompletedTask;
        }

        public void AddName(Author author, AuthorName name)
        {
            author.Names.Add(name);
        }

        public Task DeleteAsync(Author author, CancellationToken cancellationToken)
        {
            Deleted = true;
            _authors.Remove(author);
            return Task.CompletedTask;
        }

        public Task SaveAsync(CancellationToken cancellationToken)
        {
            SaveCount++;
            return Task.CompletedTask;
        }
    }

    private sealed class FakeAuthorLifecycleService(Author author) : IAuthorLifecycleService
    {
        public bool Deleted { get; private set; }

        public Task<Author> SetVisibilityAsync(Guid authorId, Guid actorId, bool isAdmin, bool isPublic,
            CancellationToken cancellationToken)
        {
            author.IsPublic = isPublic;
            return Task.FromResult(author);
        }

        public Task DeleteAsync(Guid authorId, Guid actorId, bool isAdmin, CancellationToken cancellationToken)
        {
            if (author.Books.Count > 0)
            {
                throw new EntityInUseException<Author>(author.PrimaryName);
            }

            Deleted = true;
            return Task.CompletedTask;
        }

        public Task<int> DeleteOwnedAuthorsAsync(Guid ownerId, CancellationToken cancellationToken)
        {
            return Task.FromResult(0);
        }
    }
}
