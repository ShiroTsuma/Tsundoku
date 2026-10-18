namespace Infrastructure.Persistence;

public class AuthorRepository(ApplicationDbContext context) : IAuthorRepository
{
    public async Task<Author?> GetByIdAsync(Guid id, CancellationToken cancellationToken)
    {
        return await context.Authors
            .Include(a => a.Names)
            .Include(a => a.Books)
            .FirstOrDefaultAsync(a => a.Id == id, cancellationToken);
    }

    public async Task<Author?> GetByNameAsync(Guid ownerId, string name, CancellationToken cancellationToken)
    {
        var normalizedName = MappingExtensions.NormalizeName(name);
        return await context.Authors
            .Include(a => a.Names)
            .Where(a => a.IsPublic || a.OwnerId == ownerId)
            .OrderBy(a => a.IsPublic)
            .FirstOrDefaultAsync(
                a => a.NormalizedPrimaryName == normalizedName ||
                     a.Names.Any(n => n.NormalizedName == normalizedName),
                cancellationToken);
    }

    public async Task<Author?> GetPublicByNameAsync(string name, CancellationToken cancellationToken)
    {
        var normalizedName = MappingExtensions.NormalizeName(name);
        return await context.Authors
            .Include(a => a.Names)
            .FirstOrDefaultAsync(a => a.IsPublic &&
                                      (a.NormalizedPrimaryName == normalizedName ||
                                       a.Names.Any(n => n.NormalizedName == normalizedName)), cancellationToken);
    }

    public async Task<IEnumerable<Author>> SearchAsync(Guid ownerId, string? search, int take,
        CancellationToken cancellationToken, int skip = 0)
    {
        var availableAuthors = context.Authors
            .Where(author => author.IsPublic || author.OwnerId == ownerId)
            .Where(author => !author.IsPublic || !context.Authors.Any(privateAuthor =>
                !privateAuthor.IsPublic &&
                privateAuthor.OwnerId == ownerId &&
                (privateAuthor.NormalizedPrimaryName == author.NormalizedPrimaryName ||
                 privateAuthor.Names.Any(privateName =>
                     privateName.NormalizedName == author.NormalizedPrimaryName) ||
                 author.Names.Any(publicName =>
                     publicName.NormalizedName == privateAuthor.NormalizedPrimaryName) ||
                 privateAuthor.Names.Any(privateName =>
                     author.Names.Any(publicName => publicName.NormalizedName == privateName.NormalizedName)))));

        return await SearchQuery(availableAuthors.Include(a => a.Names), search)
            .OrderBy(a => a.IsPublic)
            .ThenBy(a => a.PrimaryName)
            .ThenBy(a => a.Id)
            .Skip(Math.Max(0, skip))
            .Take(take)
            .ToListAsync(cancellationToken);
    }

    public async Task<IEnumerable<Author>> SearchOwnedAsync(Guid ownerId, string? search, int take,
        CancellationToken cancellationToken, int skip = 0)
    {
        return await SearchQuery(context.Authors.Include(a => a.Names).Where(a => a.OwnerId == ownerId), search)
            .OrderBy(a => a.PrimaryName)
            .ThenBy(a => a.Id)
            .Skip(Math.Max(0, skip))
            .Take(take)
            .ToListAsync(cancellationToken);
    }

    public async Task AddAsync(Author author, CancellationToken cancellationToken)
    {
        context.Authors.Add(author);
        await context.SaveChangesAsync(cancellationToken);
    }

    public void AddName(Author author, AuthorName name)
    {
        author.Names.Add(name);
        context.AuthorNames.Add(name);
    }

    public async Task DeleteAsync(Author author, CancellationToken cancellationToken)
    {
        context.Authors.Remove(author);
        await context.SaveChangesAsync(cancellationToken);
    }

    public async Task SaveAsync(CancellationToken cancellationToken)
    {
        await context.SaveChangesAsync(cancellationToken);
    }

    private static IQueryable<Author> SearchQuery(IQueryable<Author> query, string? search)
    {
        if (string.IsNullOrWhiteSpace(search))
        {
            return query;
        }

        var normalizedSearch = MappingExtensions.NormalizeName(search);
        return query.Where(a =>
            a.NormalizedPrimaryName.Contains(normalizedSearch) ||
            a.Names.Any(n => n.NormalizedName.Contains(normalizedSearch)));
    }
}
