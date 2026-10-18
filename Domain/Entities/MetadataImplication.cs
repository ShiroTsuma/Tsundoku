namespace Domain.Entities;

public class MetadataImplication : BaseAuditableEntity
{
    public Guid? SourceTagId { get; set; }
    public Guid? SourceGenreId { get; set; }
    public Guid? TargetTagId { get; set; }
    public Guid? TargetGenreId { get; set; }
}
