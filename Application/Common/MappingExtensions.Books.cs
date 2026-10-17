namespace Application.Common;

using DTOs.Book;

public static partial class MappingExtensions
{
    public static BookDto ToDto(this Book source)
    {
        return MapBookDto(source,
            new BookDto
            {
                PrimaryTitle = source.PrimaryTitle,
                ContentType = source.ContentType.Name,
                ContentTypeSlug = source.ContentType.Slug,
                Status = source.Status.Name
            });
    }

    public static AdminBookDto ToAdminDto(this Book source)
    {
        return MapBookDto(source,
            new AdminBookDto
            {
                OwnerId = source.OwnerId,
                PrimaryTitle = source.PrimaryTitle,
                ContentType = source.ContentType.Name,
                Status = source.Status.Name
            });
    }

    public static BookTitle ToPrimaryTitle(this string title)
    {
        var trimmedTitle = title.Trim();
        return new BookTitle
        {
            Title = trimmedTitle, NormalizedTitle = NormalizeName(trimmedTitle), IsPrimary = true, Source = "Manual"
        };
    }

    public static BookTitle ToBookTitle(this BookTitleInput input)
    {
        var trimmedTitle = input.Title.Trim();
        return new BookTitle
        {
            Title = trimmedTitle,
            NormalizedTitle = NormalizeName(trimmedTitle),
            Language = string.IsNullOrWhiteSpace(input.Language) ? null : input.Language.Trim(),
            IsPrimary = false,
            Source = string.IsNullOrWhiteSpace(input.Source) ? "Manual" : input.Source.Trim()
        };
    }

    public static BookLink ToBookLink(this BookLinkInput input)
    {
        return new BookLink
        {
            Url = input.Url.Trim(),
            Label = string.IsNullOrWhiteSpace(input.Label) ? null : input.Label.Trim(),
            SourceType = input.SourceType.Trim(),
            IsPrimary = input.IsPrimary,
            LastReadHere = input.LastReadHere
        };
    }

    private static TBookDto MapBookDto<TBookDto>(Book source, TBookDto destination)
        where TBookDto : BookDto
    {
        destination.Id = source.Id;
        destination.Created = source.Created;
        destination.LastModified = source.LastModified;
        destination.PrimaryTitle = source.PrimaryTitle;
        destination.Description = source.Description;
        destination.AlternativeTitles = source.Titles.Where(t => !t.IsPrimary).Select(t => t.Title).ToList();
        destination.AuthorId = source.AuthorId;
        destination.Author = source.Author?.PrimaryName;
        destination.ContentType = source.ContentType.Name;
        destination.Status = source.Status.Name;
        destination.CurrentChapterNumber = source.CurrentChapterNumber;
        destination.CurrentChapterLabel = source.CurrentChapterLabel;
        destination.TotalChapters = source.TotalChapters;
        destination.Rating = source.Rating;
        destination.Priority = source.Priority;
        destination.Notes = source.Notes;
        destination.RawImportedLine = source.RawImportedLine;
        destination.ProgressHistory = source.ProgressHistory
            .OrderByDescending(h => h.ChangedAt)
            .Select(h => new BookProgressHistoryDto
            {
                Id = h.Id,
                ChangedAt = h.ChangedAt,
                ChapterNumber = h.ChapterNumber,
                ChapterLabel = h.ChapterLabel,
                Comment = h.Comment
            })
            .ToList();
        destination.Cover = source.Cover?.ToDto(source.Id);
        destination.Genres = source.BookGenres.Select(bg => bg.Genre.Name).ToList();
        destination.GenreDescriptions = source.BookGenres
            .ToDictionary(bookGenre => bookGenre.Genre.Name, bookGenre => bookGenre.Genre.Description);
        destination.Tags = source.BookTags.Select(bt => bt.Tag.Name).ToList();
        destination.TagDescriptions = source.BookTags
            .ToDictionary(bookTag => bookTag.Tag.Name, bookTag => bookTag.Tag.Description);
        destination.Links = source.Links.Select(l => new BookLinkDto
        {
            Id = l.Id,
            Url = l.Url,
            Label = l.Label,
            SourceType = l.SourceType,
            IsPrimary = l.IsPrimary,
            LastReadHere = l.LastReadHere
        }).ToList();

        return destination;
    }
}
