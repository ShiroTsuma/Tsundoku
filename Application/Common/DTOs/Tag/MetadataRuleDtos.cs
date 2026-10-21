namespace Application.Common.DTOs.Tag;

/// <summary>An incoming tag or genre name redirected to one global tag or genre.</summary>
public sealed record MetadataAliasDto(Guid Id, string SourceKind, string Name, Guid? TagId, Guid? GenreId,
    string? TargetName);

/// <summary>A rule that adds the target tag or genre whenever the source one is present.</summary>
public sealed record MetadataImplicationDto(Guid Id, Guid? SourceTagId, Guid? SourceGenreId, Guid? TargetTagId,
    Guid? TargetGenreId, string? SourceName, string? TargetName);

public sealed record MetadataReviewTagDto(Guid Id, string Name, string? Description, bool IsGlobal, Guid? OwnerId,
    int BooksCount, string[] Aliases);
