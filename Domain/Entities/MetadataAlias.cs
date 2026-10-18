namespace Domain.Entities;

// SourceKind is "tag" or "genre". Targets always point directly to a canonical entity.
public class MetadataAlias : BaseAuditableEntity
{
    public required string SourceKind { get; set; }
    public required string Name { get; set; }
    public required string NormalizedName { get; set; }
    public Guid? TagId { get; set; }
    public Guid? GenreId { get; set; }
}
