namespace Application.Common.Interfaces;

public sealed record ResolvedMetadata(IReadOnlyCollection<string> Tags, IReadOnlyCollection<Guid> GenreIds);

public interface IMetadataPolicy
{
    Task<ResolvedMetadata> ResolveAsync(Guid ownerId, IEnumerable<string> tags, IEnumerable<Guid> genreIds,
        CancellationToken cancellationToken);
    Task<ResolvedMetadata> ResolveImportAsync(Guid ownerId, IEnumerable<string> tags, IEnumerable<string> genres,
        CancellationToken cancellationToken);
}
