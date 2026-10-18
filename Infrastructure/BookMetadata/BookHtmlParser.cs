namespace Infrastructure.BookMetadata;

using AngleSharp.Html.Parser;
using Application.Common.DTOs.Book;

internal sealed class BookHtmlParser : IBookHtmlParser
{
    private const int MaxPrimaryTitleLength = 500;
    private const int MaxAuthorLength = 300;
    private const int MaxDescriptionLength = 4000;
    private const int MaxAlternativeTitleLength = 500;
    private const int MaxTagLength = 100;
    private readonly IGenreRepository _genreRepository;
    private readonly IReadOnlyCollection<IBookHtmlResolver> _resolvers;
    private readonly ITagRepository? _tagRepository;
    private readonly ITypeRepository _typeRepository;
    private readonly IUser? _user;
    private readonly IMetadataPolicy? _metadataPolicy;

    public BookHtmlParser(
        IEnumerable<IBookHtmlResolver> resolvers,
        IGenreRepository genreRepository,
        ITypeRepository typeRepository,
        ITagRepository? tagRepository = null,
        IUser? user = null,
        IMetadataPolicy? metadataPolicy = null)
    {
        _resolvers = resolvers.ToArray();
        _genreRepository = genreRepository;
        _typeRepository = typeRepository;
        _tagRepository = tagRepository;
        _user = user;
        _metadataPolicy = metadataPolicy;
    }

    public async Task<BookHtmlParseResult> ParseAsync(string html, CancellationToken cancellationToken)
    {
        var document = new HtmlParser(new HtmlParserOptions { IsScripting = false }).ParseDocument(html);
        var matches = _resolvers
            .Select(resolver => (Resolver: resolver, Score: resolver.Match(document)))
            .Where(match => match.Score > 0)
            .OrderByDescending(match => match.Score)
            .ToArray();

        if (matches.Length == 0)
        {
            throw new ValidationException("HTML source is not supported or could not be recognized.");
        }

        if (matches.Length > 1 && matches[0].Score == matches[1].Score)
        {
            throw new ValidationException("HTML source is ambiguous and could not be resolved safely.");
        }

        var metadata = matches[0].Resolver.Resolve(document);
        var warnings = metadata.Warnings.ToList();
        var primaryTitle = KeepWithinLimit(metadata.PrimaryTitle, MaxPrimaryTitleLength, "Primary title", warnings);
        var authorName = KeepWithinLimit(metadata.AuthorName, MaxAuthorLength, "Author", warnings);
        var description = KeepWithinLimit(metadata.Description, MaxDescriptionLength, "Description", warnings);
        var alternativeTitles = KeepItemsWithinLimit(
            metadata.AlternativeTitles,
            MaxAlternativeTitleLength,
            "alternative title",
            warnings);
        var tags = metadata.Tags.ToList();

        BookHtmlDictionaryMatch? contentType = null;
        if (!string.IsNullOrWhiteSpace(metadata.ContentTypeName))
        {
            var matchedType = await _typeRepository.GetByNameAsync(metadata.ContentTypeName, cancellationToken);
            contentType = new BookHtmlDictionaryMatch(matchedType?.Id, metadata.ContentTypeName);
            if (matchedType == null)
            {
                warnings.Add(
                    $"Content type '{metadata.ContentTypeName}' is not present in the library and was not matched.");
            }
        }

        var genres = new List<BookHtmlDictionaryMatch>();
        var matchedGenreNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var name in metadata.Genres)
        {
            var genre = await _genreRepository.GetByNameAsync(name, cancellationToken);
            genres.Add(new BookHtmlDictionaryMatch(genre?.Id, genre?.Name ?? name));
            if (genre != null)
            {
                matchedGenreNames.Add(name);
            }

            if (genre == null)
            {
                warnings.Add($"Genre '{name}' is not present in the library and will be skipped.");
            }
        }

        foreach (var name in metadata.GenreOrTagCandidates.Distinct(StringComparer.OrdinalIgnoreCase))
        {
            var genre = await _genreRepository.GetByNameAsync(name, cancellationToken);
            if (genre != null)
            {
                if (matchedGenreNames.Add(name))
                {
                    genres.Add(new BookHtmlDictionaryMatch(genre.Id, genre.Name));
                }
            }
            else
            {
                tags.Add(name);
            }
        }

        var safeTags = KeepItemsWithinLimit(
            tags.Where(tag => !matchedGenreNames.Contains(tag)),
            MaxTagLength,
            "tag",
            warnings);
        if (_metadataPolicy == null)
            safeTags = await UseExistingTagNamesAsync(safeTags, cancellationToken);

        if (_metadataPolicy != null)
        {
            var resolved = await _metadataPolicy.ResolveImportAsync(_user?.Id ?? Guid.Empty,
                KeepItemsWithinLimit(metadata.Tags.Concat(metadata.GenreOrTagCandidates), MaxTagLength, "tag", warnings),
                metadata.Genres, cancellationToken);
            safeTags = resolved.Tags;
            genres = (await _genreRepository.GetByIdsAsync(resolved.GenreIds, cancellationToken))
                .Select(g => new BookHtmlDictionaryMatch(g.Id, g.Name)).ToList();
        }

        return new BookHtmlParseResult(
            metadata.Source,
            primaryTitle,
            authorName,
            contentType,
            alternativeTitles,
            genres,
            safeTags,
            description,
            KeepWithinLimit(metadata.CanonicalUrl, 2000, "Canonical URL", warnings),
            KeepWithinLimit(metadata.CoverUrl, 2000, "Cover URL", warnings),
            warnings);
    }

    private async Task<IReadOnlyCollection<string>> UseExistingTagNamesAsync(
        IReadOnlyCollection<string> tags,
        CancellationToken cancellationToken)
    {
        if (_tagRepository == null || _user?.Id is not { } ownerId || tags.Count == 0)
        {
            return tags;
        }

        var existing = await _tagRepository.GetByNamesAsync(ownerId, tags, cancellationToken);
        var existingTags = existing.ToArray();
        return tags
            .Select(tag => existingTags
                .Where(existingTag => MetadataNameSimilarity.IsPracticalMatch(existingTag.Name, tag))
                .OrderBy(existingTag => MetadataNameSimilarity.MatchDistance(existingTag.Name, tag))
                .Select(existingTag => existingTag.Name)
                .FirstOrDefault() ?? tag)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();
    }

    private static string? KeepWithinLimit(string? value, int limit, string label, ICollection<string> warnings)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        var clean = value.Trim();
        if (clean.Length <= limit)
        {
            return clean;
        }

        warnings.Add($"{label} exceeded {limit} characters and was skipped.");
        return null;
    }

    private static IReadOnlyCollection<string> KeepItemsWithinLimit(
        IEnumerable<string> values,
        int limit,
        string label,
        ICollection<string> warnings)
    {
        var result = new List<string>();
        foreach (var value in values.Distinct(StringComparer.OrdinalIgnoreCase))
        {
            if (value.Length <= limit)
            {
                result.Add(value);
            }
            else
            {
                warnings.Add($"A {label} exceeded {limit} characters and was skipped.");
            }
        }

        return result;
    }
}
