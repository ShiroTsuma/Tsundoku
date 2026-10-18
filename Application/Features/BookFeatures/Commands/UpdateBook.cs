namespace Application.Features.BookFeatures.Commands;

using Common.DTOs.Book;

public sealed record UpdateBookCommand(
    Guid Id,
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
    IEnumerable<BookLinkInput>? Links) : IRequest
{
    [JsonIgnore] public bool AdminScope { get; set; }
}

public class UpdateBookHandler : IRequestHandler<UpdateBookCommand>
{
    private readonly IMetadataPolicy? _metadataPolicy;
    private readonly IAuthorRepository _authorRepository;
    private readonly IBookRepository _bookRepository;
    private readonly IBookListCacheInvalidator _cacheInvalidator;
    private readonly IGenreRepository _genreRepository;
    private readonly IStatusRepository _statusRepository;
    private readonly ITagRepository _tagRepository;
    private readonly ITypeRepository _typeRepository;
    private readonly IUser _user;

    public UpdateBookHandler(
        IBookRepository bookRepository,
        IAuthorRepository authorRepository,
        ITypeRepository typeRepository,
        IStatusRepository statusRepository,
        IGenreRepository genreRepository,
        ITagRepository tagRepository,
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
        _cacheInvalidator = cacheInvalidator;
        _user = user;
        _metadataPolicy = metadataPolicy;
    }

    public async Task Handle(UpdateBookCommand request, CancellationToken cancellationToken)
    {
        var book = request.AdminScope
            ? await _bookRepository.GetForUpdateAsync(request.Id, cancellationToken)
            : await _bookRepository.GetForUpdateAsync(request.Id, _user.RequiredId, cancellationToken);
        if (book == null)
        {
            throw new EntityNotFoundException<Book, Guid>(request.Id);
        }

        var ownerId = book.OwnerId;

        var contentType = await _typeRepository.GetByIdAsync(request.ContentTypeId, cancellationToken)
                          ?? throw new EntityNotFoundException<ContentType, Guid>(request.ContentTypeId);
        var status = await _statusRepository.GetByIdAsync(request.StatusId, cancellationToken)
                     ?? throw new EntityNotFoundException<Status, Guid>(request.StatusId);
        await BookMutationSupport.EnsureBookDoesNotExistAsync(
            _bookRepository,
            ownerId,
            book.Id,
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

        var progressChanged = book.CurrentChapterNumber != request.CurrentChapterNumber ||
                              book.CurrentChapterLabel != currentChapterLabel;

        book.PrimaryTitle = primaryTitle;
        book.NormalizedPrimaryTitle = MappingExtensions.NormalizeName(primaryTitle);
        book.Description = description;
        book.AuthorId = author?.Id;
        book.Author = author;
        book.ContentTypeId = contentType.Id;
        book.ContentType = contentType;
        book.StatusId = status.Id;
        book.Status = status;
        book.TotalChapters = BookMutationSupport.ResolveTotalChapters(status, request.TotalChapters,
            request.CurrentChapterNumber);
        book.CurrentChapterNumber = request.CurrentChapterNumber;
        book.CurrentChapterLabel = currentChapterLabel;
        book.Rating = request.Rating;
        book.Priority = request.Priority;
        book.Notes = notes;
        book.RawImportedLine = rawImportedLine;

        var titles = BookMutationSupport.BuildTitles(primaryTitle, request.AlternativeTitles);
        var links = BookMutationSupport.BuildLinks(request.Links);

        var genreIds =
            (await _genreRepository.GetByIdsAsync(metadata.GenreIds, cancellationToken))
            .Select(g => g.Id)
            .ToList();
        var tagIds = (await BookMutationSupport.ResolveTagsAsync(_tagRepository, ownerId,
                metadata.Tags, cancellationToken))
            .Select(t => t.Id)
            .ToList();
        var progressHistory = progressChanged
            ? new BookProgressHistory
            {
                ChapterNumber = request.CurrentChapterNumber, ChapterLabel = currentChapterLabel
            }
            : null;

        if (progressChanged)
        {
            book.LastProgressUpdatedAt = DateTimeOffset.UtcNow;
        }

        await _bookRepository.ReplaceEditableCollectionsAsync(book.Id, titles, links, genreIds, tagIds, progressHistory,
            cancellationToken);

        await _bookRepository.SaveAsync(cancellationToken);
        await _cacheInvalidator.InvalidateBooksAsync(ownerId, cancellationToken);
    }
}

public record UpdateBookProgressCommand(
    Guid Id,
    decimal? CurrentChapterNumber,
    string? CurrentChapterLabel,
    string? Comment,
    bool Completed = false) : IRequest;

public class UpdateBookProgressHandler : IRequestHandler<UpdateBookProgressCommand>
{
    private readonly IBookListCacheInvalidator _cacheInvalidator;
    private readonly IBookRepository _repository;
    private readonly IUser _user;

    public UpdateBookProgressHandler(IBookRepository repository, IBookListCacheInvalidator cacheInvalidator, IUser user)
    {
        _repository = repository;
        _cacheInvalidator = cacheInvalidator;
        _user = user;
    }

    public async Task Handle(UpdateBookProgressCommand request, CancellationToken cancellationToken)
    {
        var book = await _repository.GetByIdAsync(request.Id, _user.RequiredId, cancellationToken)
                   ?? throw new EntityNotFoundException<Book, Guid>(request.Id);
        if (!request.Completed && book.TotalChapters.HasValue && book.TotalChapters > 0 && request.CurrentChapterNumber.HasValue &&
            request.CurrentChapterNumber > book.TotalChapters)
        {
            throw new ValidationException(BookValidationMessages.CurrentChapterCannotExceedTotal);
        }

        var updated = await _repository.UpdateProgressAsync(
            request.Id,
            _user.RequiredId,
            request.CurrentChapterNumber,
            request.CurrentChapterLabel,
            request.Comment,
            cancellationToken, request.Completed);
        if (!updated)
        {
            throw new EntityNotFoundException<Book, Guid>(request.Id);
        }

        await _cacheInvalidator.InvalidateBooksAsync(_user.RequiredId, cancellationToken);
    }
}
