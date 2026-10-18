namespace Application.UnitTests;

using Common;
using Common.Interfaces;
using Domain.Entities;
using Domain.Repositories;
using Features.AuthorFeatures.Queries;
using Features.TagFeatures.Queries;

public class AutocompleteFeatureTests
{
    private static readonly Guid OwnerId = Guid.Parse("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");

    [Fact]
    public async Task SearchAuthors_ShouldReturnAuthorMatchedByAlias()
    {
        var repository = new FakeAuthorRepository();
        var author = new Author { OwnerId = OwnerId, PrimaryName = "Er Gen", NormalizedPrimaryName = "ERGEN" };
        author.Names.Add(new AuthorName { Name = "耳根", NormalizedName = "耳根", IsPrimary = false });
        await repository.AddAsync(author, CancellationToken.None);
        var handler = new SearchAuthorsQueryHandler(repository, new FakeUser());

        var result =
            await handler.Handle(new SearchAuthorsQuery("耳", 10), CancellationToken.None);

        Assert.Single(result);
        Assert.Equal("Er Gen", result.First().PrimaryName);
        Assert.True(result.First().IsOwned);
    }

    [Fact]
    public async Task SearchAuthors_ShouldMarkAnotherUsersPublicAuthorAsNotOwned()
    {
        var repository = new FakeAuthorRepository();
        await repository.AddAsync(
            new Author
            {
                OwnerId = Guid.NewGuid(),
                IsPublic = true,
                PrimaryName = "Global Author",
                NormalizedPrimaryName = "GLOBALAUTHOR"
            }, CancellationToken.None);
        var handler = new SearchAuthorsQueryHandler(repository, new FakeUser());

        var result = await handler.Handle(new SearchAuthorsQuery("Global", 10), CancellationToken.None);

        Assert.Single(result);
        Assert.True(result.First().IsPublic);
        Assert.False(result.First().IsOwned);
    }

    [Fact]
    public async Task SearchTags_ShouldReturnCurrentUsersAndGlobalTags()
    {
        var repository = new FakeTagRepository();
        await repository.AddAsync(new Tag { OwnerId = OwnerId, Name = "favorite", NormalizedName = "FAVORITE" },
            CancellationToken.None);
        await repository.AddAsync(new Tag { OwnerId = Guid.NewGuid(), Name = "favorite", NormalizedName = "FAVORITE" },
            CancellationToken.None);
        await repository.AddAsync(
            new Tag { IsGlobal = true, Name = "official favorite", NormalizedName = "OFFICIALFAVORITE" },
            CancellationToken.None);
        var handler = new SearchTagsQueryHandler(repository, new FakeUser());

        var result =
            await handler.Handle(new SearchTagsQuery("fav", 10), CancellationToken.None);

        Assert.Equal(2, result.Count);
        Assert.Contains(result, tag => tag.Name == "favorite" && !tag.IsGlobal);
        Assert.Contains(result, tag => tag.Name == "official favorite" && tag.IsGlobal);
    }

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

    private sealed class FakeAuthorRepository : IAuthorRepository
    {
        private readonly List<Author> _authors = new();

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
            _authors.Remove(author);
            return Task.CompletedTask;
        }

        public Task<Author?> GetByIdAsync(Guid id, CancellationToken cancellationToken)
        {
            return Task.FromResult(_authors.FirstOrDefault(a => a.Id == id));
        }

        public Task<Author?> GetByNameAsync(Guid ownerId, string name, CancellationToken cancellationToken)
        {
            return Task.FromResult(_authors.FirstOrDefault(a =>
                a.NormalizedPrimaryName == MappingExtensions.NormalizeName(name)));
        }

        public Task<Author?> GetPublicByNameAsync(string name, CancellationToken cancellationToken)
        {
            return GetByNameAsync(Guid.Empty, name, cancellationToken);
        }

        public Task<IEnumerable<Author>> SearchAsync(Guid ownerId, string? search, int take,
            CancellationToken cancellationToken, int skip = 0)
        {
            var normalizedSearch = search == null ? string.Empty : MappingExtensions.NormalizeName(search);
            return Task.FromResult<IEnumerable<Author>>(_authors
                .Where(a => a.NormalizedPrimaryName.Contains(normalizedSearch) ||
                            a.Names.Any(n => n.NormalizedName.Contains(normalizedSearch)))
                .Take(take)
                .ToList());
        }

        public Task<IEnumerable<Author>> SearchOwnedAsync(Guid ownerId, string? search, int take,
            CancellationToken cancellationToken, int skip = 0)
        {
            return Task.FromResult<IEnumerable<Author>>(_authors
                .Where(author => author.OwnerId == ownerId)
                .Take(take)
                .ToList());
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
            return Task.FromResult(_tags.FirstOrDefault(t => t.OwnerId == ownerId && t.Id == id));
        }

        public Task<IEnumerable<Tag>> GetByNamesAsync(Guid ownerId, IEnumerable<string> names,
            CancellationToken cancellationToken)
        {
            var normalizedNames = names.Select(MappingExtensions.NormalizeName).ToList();
            return Task.FromResult<IEnumerable<Tag>>(_tags
                .Where(t => (t.IsGlobal || t.OwnerId == ownerId) && normalizedNames.Contains(t.NormalizedName))
                .ToList());
        }

        public Task<Tag?> GetByNameAsync(Guid ownerId, string name, CancellationToken cancellationToken)
        {
            return Task.FromResult(_tags.FirstOrDefault(t =>
                (t.IsGlobal || t.OwnerId == ownerId) && t.NormalizedName == MappingExtensions.NormalizeName(name)));
        }

        public Task<IEnumerable<Tag>> SearchAsync(Guid ownerId, string? search, int take,
            CancellationToken cancellationToken, int skip = 0)
        {
            var normalizedSearch = search == null ? string.Empty : MappingExtensions.NormalizeName(search);
            return Task.FromResult<IEnumerable<Tag>>(_tags
                .Where(t => (t.IsGlobal || t.OwnerId == ownerId) && t.NormalizedName.Contains(normalizedSearch))
                .Take(take)
                .ToList());
        }

        public Task SaveAsync(CancellationToken cancellationToken)
        {
            return Task.CompletedTask;
        }
    }
}
