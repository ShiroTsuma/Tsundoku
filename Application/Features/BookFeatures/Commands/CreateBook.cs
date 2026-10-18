namespace Application.Features.BookFeatures.Commands;

using Common.DTOs.Book;
using Domain.Associations;

public sealed record CreateBookCommand(
    string PrimaryTitle,
    Guid ContentTypeId,
    Guid StatusId,
    Guid? AuthorId,
    string? AuthorName,
    IEnumerable<BookTitleInput>? AlternativeTitles,
    IEnumerable<Guid>? GenreIds,
    IEnumerable<string>? Tags,
    decimal? TotalChapters,
    decimal? CurrentChapterNumber,
    string? CurrentChapterLabel,
    int? Rating,
    int? Priority,
    string? Description,
    string? Notes,
    string? RawImportedLine,
    IEnumerable<BookLinkInput>? Links,
    string? InitialCoverUrl = null,
    Guid? InitialCoverUploadToken = null) : IRequest<Guid>;

public class CreateBookHandler : IRequestHandler<CreateBookCommand, Guid>
{
    private readonly IMetadataPolicy? _metadataPolicy;
    private readonly IAuthorRepository _authorRepository;
    private readonly IBookCoverQueue _bookCoverQueue;
    private readonly IBookRepository _bookRepository;
    private readonly IBookListCacheInvalidator _cacheInvalidator;
    private readonly IGenreRepository _genreRepository;
    private readonly IStatusRepository _statusRepository;
    private readonly ITagRepository _tagRepository;
    private readonly ITypeRepository _typeRepository;
    private readonly IUser _user;

    public CreateBookHandler(
        IBookRepository bookRepository,
        IAuthorRepository authorRepository,
        ITypeRepository typeRepository,
        IStatusRepository statusRepository,
        IGenreRepository genreRepository,
        ITagRepository tagRepository,
        IBookCoverQueue bookCoverQueue,
        IBookListCacheInvalidator cacheInvalidator,
        IUser user,
        IMetadataPolicy? metadataPolicy = null)
    {
        _bookRepository = bookRepository;
        _authorRepository = authorRepository;
        _typeRepository = typeRepository;
        _statusRepository = statusRepository;
        _genreRepository = genreRepository;
        _tagRepository = tagRepository;
        _bookCoverQueue = bookCoverQueue;
        _cacheInvalidator = cacheInvalidator;
        _user = user;
        _metadataPolicy = metadataPolicy;
    }

    public async Task<Guid> Handle(CreateBookCommand request, CancellationToken cancellationToken)
    {
        var ownerId = _user.RequiredId;
        var contentType = await _typeRepository.GetByIdAsync(request.ContentTypeId, cancellationToken)
                          ?? throw new EntityNotFoundException<ContentType, Guid>(request.ContentTypeId);
        var status = await _statusRepository.GetByIdAsync(request.StatusId, cancellationToken)
                     ?? throw new EntityNotFoundException<Status, Guid>(request.StatusId);
        await BookMutationSupport.EnsureBookDoesNotExistAsync(
            _bookRepository,
            ownerId,
            null,
            contentType.Id,
            request.PrimaryTitle,
            request.AlternativeTitles,
            cancellationToken);

        var metadata = _metadataPolicy == null
            ? new ResolvedMetadata((request.Tags ?? []).ToArray(), (request.GenreIds ?? []).ToArray())
            : await _metadataPolicy.ResolveAsync(ownerId, request.Tags ?? [], request.GenreIds ?? [], cancellationToken);
        var author = await BookMutationSupport.ResolveAuthorAsync(_authorRepository, ownerId, request.AuthorId,
            request.AuthorName, cancellationToken);
        var primaryTitle = request.PrimaryTitle.Trim();
        var description = BookMutationSupport.TrimToNull(request.Description);
        var currentChapterLabel = BookMutationSupport.TrimToNull(request.CurrentChapterLabel);
        var notes = BookMutationSupport.TrimToNull(request.Notes);
        var rawImportedLine = BookMutationSupport.TrimToNull(request.RawImportedLine);
        var initialCoverUrl = BookMutationSupport.TrimToNull(request.InitialCoverUrl);
        var book = new Book
        {
            PrimaryTitle = primaryTitle,
            NormalizedPrimaryTitle = MappingExtensions.NormalizeName(primaryTitle),
            Description = description,
            OwnerId = ownerId,
            AuthorId = author?.Id,
            Author = author,
            ContentTypeId = contentType.Id,
            ContentType = contentType,
            StatusId = status.Id,
            Status = status,
            TotalChapters = BookMutationSupport.ResolveTotalChapters(status, request.TotalChapters,
                request.CurrentChapterNumber),
            CurrentChapterNumber = request.CurrentChapterNumber,
            CurrentChapterLabel = currentChapterLabel,
            Rating = request.Rating,
            Priority = request.Priority,
            Notes = notes,
            RawImportedLine = rawImportedLine,
            Cover = new BookCover
            {
                Source = initialCoverUrl != null
                    ? BookCoverSource.ManualUrl
                    : request.InitialCoverUploadToken != null
                        ? BookCoverSource.ManualUpload
                        : null,
                OriginalImageUrl = initialCoverUrl,
                PendingUploadToken = request.InitialCoverUploadToken
            }
        };

        foreach (var title in BookMutationSupport.BuildTitles(primaryTitle, request.AlternativeTitles))
        {
            book.Titles.Add(title);
        }

        foreach (var link in BookMutationSupport.BuildLinks(request.Links))
        {
            book.Links.Add(link);
        }

        foreach (var genre in await _genreRepository.GetByIdsAsync(metadata.GenreIds,
                     cancellationToken))
        {
            book.BookGenres.Add(new BookGenre { Book = book, Genre = genre });
        }

        foreach (var tag in await BookMutationSupport.ResolveTagsAsync(_tagRepository, ownerId,
                     metadata.Tags, cancellationToken))
        {
            book.BookTags.Add(new BookTag { Book = book, Tag = tag });
        }

        if (request.CurrentChapterNumber != null || !string.IsNullOrWhiteSpace(request.CurrentChapterLabel))
        {
            book.ProgressHistory.Add(new BookProgressHistory
            {
                ChapterNumber = request.CurrentChapterNumber,
                ChapterLabel = request.CurrentChapterLabel,
                Comment = "Initial progress"
            });
        }

        await _bookRepository.AddAsync(book, cancellationToken);
        await _bookCoverQueue.QueueAsync(book.Id, cancellationToken);
        await _cacheInvalidator.InvalidateBooksAsync(ownerId, cancellationToken);
        return book.Id;
    }
}
