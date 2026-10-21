namespace Infrastructure.Services;

public sealed class MetadataPolicy(ApplicationDbContext context) : IMetadataPolicy
{
    public Task<ResolvedMetadata> ResolveAsync(Guid ownerId, IEnumerable<string> tags, IEnumerable<Guid> genreIds,
        CancellationToken cancellationToken) => ResolveCoreAsync(ownerId, tags, [], genreIds, cancellationToken);

    public Task<ResolvedMetadata> ResolveImportAsync(Guid ownerId, IEnumerable<string> tags, IEnumerable<string> genres,
        CancellationToken cancellationToken) => ResolveCoreAsync(ownerId, tags, genres, [], cancellationToken);

    private async Task<ResolvedMetadata> ResolveCoreAsync(Guid ownerId, IEnumerable<string> tagNames,
        IEnumerable<string> genreNames, IEnumerable<Guid> genreIds, CancellationToken cancellationToken)
    {
        var aliases = await context.Set<MetadataAlias>().AsNoTracking().ToListAsync(cancellationToken);
        var rules = await context.Set<MetadataImplication>().AsNoTracking().ToListAsync(cancellationToken);
        var tags = await context.Tags.AsNoTracking().Where(t => t.IsGlobal || t.OwnerId == ownerId)
            .ToListAsync(cancellationToken);
        var genres = await context.Genres.AsNoTracking().ToListAsync(cancellationToken);
        var selectedTags = new HashSet<Guid>();
        var selectedGenres = genreIds.Where(id => genres.Any(g => g.Id == id)).ToHashSet();
        var unknownTags = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        void ResolveName(string name, string kind)
        {
            if (string.IsNullOrWhiteSpace(name)) return;
            var normalized = MappingExtensions.NormalizeName(name);
            var alias = aliases.FirstOrDefault(a => a.SourceKind == kind && a.NormalizedName == normalized);
            if (alias != null)
            {
                var aliasTag = alias.TagId is { } tagId && tags.Any(t => t.Id == tagId && t.IsGlobal) ? alias.TagId : null;
                if (aliasTag is { } usableTag) selectedTags.Add(usableTag);
                if (alias.GenreId is { } genreId) selectedGenres.Add(genreId);
                // An alias whose tag is no longer global falls back to matching, so the name is not lost.
                if (aliasTag != null || alias.GenreId != null) return;
            }

            // A known genre arriving in a source's tag list remains a genre.
            var genre = genres.Where(g => MetadataNameSimilarity.IsPracticalMatch(g.Name, name))
                .OrderBy(g => MetadataNameSimilarity.MatchDistance(g.Name, name)).ThenBy(g => g.Name).FirstOrDefault();
            if (genre != null) { selectedGenres.Add(genre.Id); return; }
            var tag = tags.Where(t => MetadataNameSimilarity.IsPracticalMatch(t.Name, name))
                .OrderBy(t => MetadataNameSimilarity.MatchDistance(t.Name, name)).ThenByDescending(t => t.IsGlobal)
                .ThenBy(t => t.Name).FirstOrDefault();
            if (tag != null) selectedTags.Add(tag.Id);
            else if (kind == "tag") unknownTags.Add(name.Trim());
        }

        foreach (var name in tagNames) ResolveName(name, "tag");
        foreach (var name in genreNames) ResolveName(name, "genre");
        bool changed;
        do
        {
            changed = false;
            foreach (var rule in rules)
            {
                if (!(rule.SourceTagId is { } tagId && selectedTags.Contains(tagId)) &&
                    !(rule.SourceGenreId is { } genreId && selectedGenres.Contains(genreId))) continue;
                if (rule.TargetTagId is { } targetTag && tags.Any(t => t.Id == targetTag && t.IsGlobal))
                    changed |= selectedTags.Add(targetTag);
                if (rule.TargetGenreId is { } targetGenre) changed |= selectedGenres.Add(targetGenre);
            }
        } while (changed); // Sets make transitive and cyclic implications finite and idempotent.

        return new ResolvedMetadata(tags.Where(t => selectedTags.Contains(t.Id)).Select(t => t.Name)
            .Concat(unknownTags).Distinct(StringComparer.OrdinalIgnoreCase).ToArray(), selectedGenres.ToArray());
    }
}
