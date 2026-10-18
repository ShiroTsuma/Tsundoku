namespace Infrastructure.Persistence;

public class GenreRepository : IGenreRepository
{
    private readonly ApplicationDbContext _context;

    public GenreRepository(ApplicationDbContext context)
    {
        _context = context;
    }

    public async Task<Genre?> GetByIdAsync(Guid id, CancellationToken cancellationToken)
    {
        return await _context.Genres.FindAsync(new object[] { id }, cancellationToken);
    }

    public async Task<Genre?> GetByNameAsync(string name, CancellationToken cancellationToken)
    {
        var normalizedName = MappingExtensions.NormalizeName(name);
        var aliasTarget = await _context.Set<MetadataAlias>()
            .Where(a => a.SourceKind == "genre" && a.NormalizedName == normalizedName && a.GenreId != null)
            .Select(a => a.GenreId).FirstOrDefaultAsync(cancellationToken);
        if (aliasTarget != null)
            return await _context.Genres.FirstOrDefaultAsync(g => g.Id == aliasTarget, cancellationToken);
        var exact = await _context.Genres
            .Where(genre => genre.NormalizedName == normalizedName)
            .FirstOrDefaultAsync(cancellationToken);
        if (exact != null)
        {
            return exact;
        }

        return (await _context.Genres.ToListAsync(cancellationToken))
            .Where(genre => MetadataNameSimilarity.IsPracticalMatch(genre.Name, name))
            .OrderBy(genre => MetadataNameSimilarity.MatchDistance(genre.Name, name))
            .ThenBy(genre => genre.Name, StringComparer.OrdinalIgnoreCase)
            .FirstOrDefault();
    }

    public async Task<IEnumerable<Genre>> GetAllAsync(int Skip, int Take, CancellationToken cancellationToken)
    {
        return await _context.Genres.Skip(Skip).Take(Take).ToListAsync(cancellationToken);
    }

    public async Task<IEnumerable<Genre>> GetByIdsAsync(IEnumerable<Guid> ids, CancellationToken cancellationToken)
    {
        var idList = ids.ToList();
        return await _context.Genres.Where(g => idList.Contains(g.Id)).ToListAsync(cancellationToken);
    }

    public async Task AddAsync(Genre genre, CancellationToken cancellationToken)
    {
        _context.Genres.Add(genre);
        await _context.SaveChangesAsync(cancellationToken);
    }

    public async Task DeleteAsync(Guid id, CancellationToken cancellationToken)
    {
        var genre = await _context.Genres.FindAsync(new object[] { id }, cancellationToken);
        if (genre != null)
        {
            if (await _context.Set<BookGenre>().AnyAsync(link => link.GenreId == id, cancellationToken))
            {
                throw new EntityInUseException<Genre>(genre.Name);
            }

            _context.Genres.Remove(genre);
            await _context.SaveChangesAsync(cancellationToken);
        }
    }

    public async Task SaveAsync(CancellationToken cancellationToken)
    {
        await _context.SaveChangesAsync(cancellationToken);
    }

    public Task<int> GetCountAsync(CancellationToken cancellationToken)
    {
        return _context.Genres.CountAsync(cancellationToken);
    }
}
