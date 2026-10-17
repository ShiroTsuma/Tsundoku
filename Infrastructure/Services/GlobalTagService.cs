namespace Infrastructure.Services;

public sealed class GlobalTagService(
    ApplicationDbContext context,
    IBookListCacheInvalidator cacheInvalidator) : IGlobalTagService
{
    public async Task<IReadOnlyCollection<Tag>> SearchAsync(string? search, int take,
        CancellationToken cancellationToken, int skip = 0)
    {
        var query = context.Tags.Where(tag => tag.IsGlobal);
        if (!string.IsNullOrWhiteSpace(search))
        {
            var normalized = MappingExtensions.NormalizeName(search);
            var descriptionSearch = search.Trim().ToLowerInvariant();
            query = query.Where(tag => tag.NormalizedName.Contains(normalized) ||
                tag.Description != null && tag.Description.ToLower().Contains(descriptionSearch));
        }

        return await query.OrderBy(tag => tag.Name).ThenBy(tag => tag.Id).Skip(Math.Max(0, skip))
            .Take(Math.Clamp(take, 1, 100)).ToListAsync(cancellationToken);
    }

    public async Task<Tag> CreateAsync(string name, string? description, CancellationToken cancellationToken)
    {
        var normalizedName = MappingExtensions.NormalizeName(name);
        var existing = await FindSimilarGlobalAsync(name, null, cancellationToken);
        if (existing is not null)
        {
            throw new EntityAlreadyExistsException<Tag, Guid>(name, existing.Id);
        }

        var tag = new Tag
        {
            IsGlobal = true,
            OwnerId = null,
            Name = MappingExtensions.CollapseWhitespace(name),
            NormalizedName = normalizedName,
            Description = TrimToNull(description)
        };
        context.Tags.Add(tag);
        await context.SaveChangesAsync(cancellationToken);
        var affectedOwners = await MergePrivateDuplicatesAsync(tag, cancellationToken);
        await InvalidateOwnersAsync(affectedOwners, cancellationToken);
        return tag;
    }

    public async Task<Tag> UpdateAsync(Guid id, string name, string? description,
        CancellationToken cancellationToken)
    {
        var tag = await context.Tags.Include(item => item.BookTags)
                      .FirstOrDefaultAsync(item => item.IsGlobal && item.Id == id, cancellationToken)
                  ?? throw new EntityNotFoundException<Tag, Guid>(id);
        var affectedOwners = await GetLinkedOwnerIdsAsync(tag.Id, cancellationToken);
        var normalizedName = MappingExtensions.NormalizeName(name);
        var conflict = await FindSimilarGlobalAsync(name, id, cancellationToken);
        if (conflict is not null)
        {
            throw new EntityAlreadyExistsException<Tag, Guid>(name, conflict.Id);
        }

        tag.Name = MappingExtensions.CollapseWhitespace(name);
        tag.NormalizedName = normalizedName;
        tag.Description = TrimToNull(description);
        await context.SaveChangesAsync(cancellationToken);
        affectedOwners.UnionWith(await MergePrivateDuplicatesAsync(tag, cancellationToken));
        await InvalidateOwnersAsync(affectedOwners, cancellationToken);
        return tag;
    }

    public async Task DeleteAsync(Guid id, CancellationToken cancellationToken)
    {
        var tag = await context.Tags.FirstOrDefaultAsync(item => item.IsGlobal && item.Id == id, cancellationToken)
                  ?? throw new EntityNotFoundException<Tag, Guid>(id);
        var affectedOwners = await GetLinkedOwnerIdsAsync(tag.Id, cancellationToken);
        context.Tags.Remove(tag);
        await context.SaveChangesAsync(cancellationToken);
        await InvalidateOwnersAsync(affectedOwners, cancellationToken);
    }

    private async Task<HashSet<Guid>> MergePrivateDuplicatesAsync(Tag globalTag,
        CancellationToken cancellationToken)
    {
        var privateTags = await context.Tags
            .Include(tag => tag.BookTags)
            .Where(tag => !tag.IsGlobal)
            .ToListAsync(cancellationToken);
        privateTags = privateTags
            .Where(tag => MetadataNameSimilarity.IsPracticalMatch(tag.Name, globalTag.Name))
            .ToList();
        if (privateTags.Count == 0)
        {
            return [];
        }

        var privateBookIds = privateTags.SelectMany(tag => tag.BookTags).Select(link => link.BookId).Distinct()
            .ToArray();
        var affectedOwners = await context.Books.Where(book => privateBookIds.Contains(book.Id))
            .Select(book => book.OwnerId).ToHashSetAsync(cancellationToken);

        var globallyLinkedBookIds = await context.Set<BookTag>()
            .Where(link => link.TagId == globalTag.Id)
            .Select(link => link.BookId)
            .ToHashSetAsync(cancellationToken);
        foreach (var privateTag in privateTags)
        {
            foreach (var link in privateTag.BookTags.ToList())
            {
                context.Remove(link);
                if (globallyLinkedBookIds.Add(link.BookId))
                {
                    context.Add(new BookTag { BookId = link.BookId, TagId = globalTag.Id });
                }
            }
        }

        context.Tags.RemoveRange(privateTags);
        await context.SaveChangesAsync(cancellationToken);
        return affectedOwners;
    }

    private Task<HashSet<Guid>> GetLinkedOwnerIdsAsync(Guid tagId, CancellationToken cancellationToken)
    {
        return context.Set<BookTag>()
            .Where(link => link.TagId == tagId)
            .Select(link => link.Book.OwnerId)
            .ToHashSetAsync(cancellationToken);
    }

    private async Task InvalidateOwnersAsync(IEnumerable<Guid> ownerIds, CancellationToken cancellationToken)
    {
        foreach (var ownerId in ownerIds)
        {
            await cacheInvalidator.InvalidateBooksAsync(ownerId, cancellationToken);
        }
    }

    private static string? TrimToNull(string? value)
    {
        return string.IsNullOrWhiteSpace(value) ? null : value.Trim();
    }

    private async Task<Tag?> FindSimilarGlobalAsync(string name, Guid? excludedId,
        CancellationToken cancellationToken)
    {
        return (await context.Tags.Where(tag => tag.IsGlobal && (!excludedId.HasValue || tag.Id != excludedId.Value))
                .ToListAsync(cancellationToken))
            .Where(tag => MetadataNameSimilarity.IsPracticalMatch(tag.Name, name))
            .OrderBy(tag => MetadataNameSimilarity.MatchDistance(tag.Name, name))
            .ThenBy(tag => tag.Name, StringComparer.OrdinalIgnoreCase)
            .FirstOrDefault();
    }
}
