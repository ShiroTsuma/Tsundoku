namespace Infrastructure.Persistence;

public class TagRepository : ITagRepository
{
    private readonly ApplicationDbContext _context;

    public TagRepository(ApplicationDbContext context)
    {
        _context = context;
    }

    public async Task<Tag?> GetByIdAsync(Guid ownerId, Guid id, CancellationToken cancellationToken)
    {
        return await _context.Tags
            .Include(t => t.BookTags)
            .FirstOrDefaultAsync(t => !t.IsGlobal && t.OwnerId == ownerId && t.Id == id, cancellationToken);
    }

    public async Task<Tag?> GetByNameAsync(Guid ownerId, string name, CancellationToken cancellationToken)
    {
        var normalizedName = MappingExtensions.NormalizeName(name);
        var aliasTarget = await _context.Set<MetadataAlias>()
            .Where(a => a.SourceKind == "tag" && a.NormalizedName == normalizedName && a.TagId != null)
            .Select(a => a.TagId).FirstOrDefaultAsync(cancellationToken);
        if (aliasTarget != null)
            return await _context.Tags.FirstOrDefaultAsync(t => t.Id == aliasTarget && t.IsGlobal, cancellationToken);
        var visibleTags = _context.Tags.Where(t => t.IsGlobal || t.OwnerId == ownerId);
        var exact = await visibleTags
            .Where(t => t.NormalizedName == normalizedName)
            .OrderByDescending(t => t.IsGlobal)
            .FirstOrDefaultAsync(cancellationToken);
        if (exact != null)
        {
            return exact;
        }

        return (await visibleTags.ToListAsync(cancellationToken))
            .Where(tag => MetadataNameSimilarity.IsPracticalMatch(tag.Name, name))
            .OrderBy(tag => MetadataNameSimilarity.MatchDistance(tag.Name, name))
            .ThenByDescending(tag => tag.IsGlobal)
            .ThenBy(tag => tag.Name, StringComparer.OrdinalIgnoreCase)
            .FirstOrDefault();
    }

    public async Task<IEnumerable<Tag>> GetByNamesAsync(Guid ownerId, IEnumerable<string> names,
        CancellationToken cancellationToken)
    {
        var requestedNames = names.ToList();
        var normalizedNames = requestedNames.Select(MappingExtensions.NormalizeName).Distinct().ToList();
        var matches = await _context.Tags
            .Where(t => (t.IsGlobal || t.OwnerId == ownerId) &&
                        normalizedNames.Contains(t.NormalizedName))
            .OrderByDescending(t => t.IsGlobal)
            .ToListAsync(cancellationToken);
        var result = matches.GroupBy(t => MetadataNameSimilarity.CreateKey(t.Name))
            .Select(group => group.First()).ToList();
        var matchedKeys = result.Select(tag => MetadataNameSimilarity.CreateKey(tag.Name)).ToHashSet();
        var unmatchedNames = requestedNames
            .Where(name => !matchedKeys.Contains(MetadataNameSimilarity.CreateKey(name)))
            .ToList();
        if (unmatchedNames.Count == 0)
        {
            return result;
        }

        var visibleTags = await _context.Tags.Where(t => t.IsGlobal || t.OwnerId == ownerId)
            .ToListAsync(cancellationToken);
        foreach (var name in unmatchedNames)
        {
            var similar = visibleTags
                .Where(tag => MetadataNameSimilarity.IsPracticalMatch(tag.Name, name))
                .OrderBy(tag => MetadataNameSimilarity.MatchDistance(tag.Name, name))
                .ThenByDescending(tag => tag.IsGlobal)
                .ThenBy(tag => tag.Name, StringComparer.OrdinalIgnoreCase)
                .FirstOrDefault();
            if (similar != null && result.All(tag => tag.Id != similar.Id))
            {
                result.Add(similar);
            }
        }

        return result;
    }

    public async Task<IEnumerable<Tag>> SearchAsync(Guid ownerId, string? search, int take,
        CancellationToken cancellationToken, int skip = 0)
    {
        var query = _context.Tags.Where(t => t.IsGlobal || t.OwnerId == ownerId);
        if (!string.IsNullOrWhiteSpace(search))
        {
            var normalizedSearch = MappingExtensions.NormalizeName(search);
            query = query.Where(t => t.NormalizedName.Contains(normalizedSearch));
        }

        return await query.OrderBy(t => t.Name).ThenBy(t => t.Id).Skip(Math.Max(0, skip)).Take(take).ToListAsync(cancellationToken);
    }

    public async Task AddAsync(Tag tag, CancellationToken cancellationToken)
    {
        _context.Tags.Add(tag);
        await _context.SaveChangesAsync(cancellationToken);
    }

    public async Task DeleteAsync(Tag tag, CancellationToken cancellationToken)
    {
        _context.Tags.Remove(tag);
        await _context.SaveChangesAsync(cancellationToken);
    }

    public async Task SaveAsync(CancellationToken cancellationToken)
    {
        await _context.SaveChangesAsync(cancellationToken);
    }
}
