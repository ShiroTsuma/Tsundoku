namespace Infrastructure.Persistence;

using BookSearch;

public class BookRepository : IBookRepository
{
    private readonly ApplicationDbContext _context;
    private readonly HashSet<Guid> _pendingSearchRefreshes = [];
    private readonly BookSearchIndexUpdater? _searchIndexUpdater;

    public BookRepository(ApplicationDbContext context, BookSearchIndexUpdater? searchIndexUpdater = null)
    {
        _context = context;
        _searchIndexUpdater = searchIndexUpdater;
    }

    public async Task<Book?> GetByIdAsync(Guid id, Guid ownerId, CancellationToken cancellationToken)
    {
        return await IncludeDetails(_context.Books)
            .FirstOrDefaultAsync(book => book.Id == id && book.OwnerId == ownerId, cancellationToken);
    }

    public async Task<Book?> GetByIdAsync(Guid id, CancellationToken cancellationToken)
    {
        return await IncludeDetails(_context.Books)
            .FirstOrDefaultAsync(book => book.Id == id, cancellationToken);
    }

    public async Task<Book?> GetForUpdateAsync(Guid id, Guid ownerId, CancellationToken cancellationToken)
    {
        return await _context.Books
            .FirstOrDefaultAsync(book => book.Id == id && book.OwnerId == ownerId, cancellationToken);
    }

    public async Task<Book?> GetForUpdateAsync(Guid id, CancellationToken cancellationToken)
    {
        return await _context.Books
            .FirstOrDefaultAsync(book => book.Id == id, cancellationToken);
    }

    public async Task<Book?> GetByNameAsync(string name, Guid ownerId, Guid contentTypeId,
        CancellationToken cancellationToken)
    {
        var normalizedName = MappingExtensions.NormalizeName(name);
        return await _context.Books
            .AsNoTracking()
            .FirstOrDefaultAsync(
                book => book.OwnerId == ownerId &&
                        book.ContentTypeId == contentTypeId &&
                        (book.NormalizedPrimaryTitle == normalizedName ||
                         book.Titles.Any(title => title.NormalizedTitle == normalizedName)),
                cancellationToken);
    }

    public async Task AddAsync(Book book, CancellationToken cancellationToken)
    {
        _context.Books.Add(book);
        await SaveAsync(cancellationToken);
    }

    public async Task DeleteAsync(Guid id, Guid ownerId, CancellationToken cancellationToken)
    {
        var book =
            await _context.Books.FirstOrDefaultAsync(book => book.Id == id && book.OwnerId == ownerId,
                cancellationToken);
        if (book != null)
        {
            _context.Books.Remove(book);
            await _context.SaveChangesAsync(cancellationToken);
        }
    }

    public async Task SaveAsync(CancellationToken cancellationToken)
    {
        var bookIds = GetChangedSearchBookIds();
        await _context.SaveChangesAsync(cancellationToken);
        if (_searchIndexUpdater != null)
        {
            foreach (var bookId in bookIds)
            {
                await _searchIndexUpdater.RefreshAsync(bookId, cancellationToken);
            }
        }

        _pendingSearchRefreshes.ExceptWith(bookIds);
    }

    public Task<int> GetCountAsync(Guid ownerId, CancellationToken cancellationToken)
    {
        return _context.Books.CountAsync(book => book.OwnerId == ownerId, cancellationToken);
    }

    public Task<int> GetCountAsync(CancellationToken cancellationToken)
    {
        return _context.Books.CountAsync(cancellationToken);
    }

    public async Task<bool> UpdateProgressAsync(
        Guid id,
        Guid ownerId,
        decimal? currentChapterNumber,
        string? currentChapterLabel,
        string? comment,
        CancellationToken cancellationToken,
        bool completed = false)
    {
        var book = await _context.Books
            .FirstOrDefaultAsync(book => book.Id == id && book.OwnerId == ownerId, cancellationToken);
        if (book == null)
        {
            return false;
        }

        var progressChanged = book.CurrentChapterNumber != currentChapterNumber ||
                              book.CurrentChapterLabel != currentChapterLabel;
        var hasComment = !string.IsNullOrWhiteSpace(comment);
        if (!completed && book.TotalChapters.HasValue && book.TotalChapters > 0 && currentChapterNumber.HasValue &&
            currentChapterNumber > book.TotalChapters)
        {
            throw new ValidationException(BookValidationMessages.CurrentChapterCannotExceedTotal);
        }

        book.CurrentChapterNumber = currentChapterNumber;
        book.CurrentChapterLabel = currentChapterLabel;
        var statusSlug = completed ? "completed" : "reading";
        var status = await _context.Statuses.SingleAsync(s => s.Slug == statusSlug, cancellationToken);
        book.StatusId = status.Id;
        if (completed && currentChapterNumber.HasValue) book.TotalChapters = currentChapterNumber;

        if (progressChanged)
        {
            book.LastProgressUpdatedAt = DateTimeOffset.UtcNow;
            _context.BookProgressHistory.Add(new BookProgressHistory
            {
                BookId = book.Id,
                ChapterNumber = currentChapterNumber,
                ChapterLabel = currentChapterLabel,
                Comment = comment
            });
        }
        else if (hasComment)
        {
            var progressHistory = await _context.BookProgressHistory
                .Where(history => history.BookId == book.Id)
                .ToListAsync(cancellationToken);
            var latestHistory = progressHistory
                .OrderByDescending(history => history.ChangedAt)
                .ThenByDescending(history => history.Id)
                .FirstOrDefault();

            if (latestHistory is not null && latestHistory.ChapterNumber == currentChapterNumber &&
                latestHistory.ChapterLabel == currentChapterLabel)
            {
                latestHistory.Comment = comment;
            }
            else
            {
                _context.BookProgressHistory.Add(new BookProgressHistory
                {
                    BookId = book.Id,
                    ChapterNumber = currentChapterNumber,
                    ChapterLabel = currentChapterLabel,
                    Comment = comment
                });
            }
        }

        await SaveAsync(cancellationToken);
        return true;
    }

    public async Task<decimal?> GetTotalChaptersAsync(Guid id, Guid ownerId, CancellationToken cancellationToken)
    {
        return await _context.Books
            .Where(book => book.Id == id && book.OwnerId == ownerId)
            .Select(book => book.TotalChapters)
            .FirstOrDefaultAsync(cancellationToken);
    }

    public async Task ReplaceEditableCollectionsAsync(
        Guid bookId,
        IEnumerable<BookTitle> titles,
        IEnumerable<BookLink> links,
        IEnumerable<Guid> genreIds,
        IEnumerable<Guid> tagIds,
        BookProgressHistory? progressHistory,
        CancellationToken cancellationToken)
    {
        _pendingSearchRefreshes.Add(bookId);
        await _context.BookTitles.Where(title => title.BookId == bookId).ExecuteDeleteAsync(cancellationToken);
        await _context.BookLinks.Where(link => link.BookId == bookId).ExecuteDeleteAsync(cancellationToken);
        await _context.Set<BookGenre>().Where(bookGenre => bookGenre.BookId == bookId)
            .ExecuteDeleteAsync(cancellationToken);
        await _context.Set<BookTag>().Where(bookTag => bookTag.BookId == bookId).ExecuteDeleteAsync(cancellationToken);
        DetachTrackedEditableCollections(bookId);

        _context.BookTitles.AddRange(titles.Select(title =>
        {
            title.BookId = bookId;
            return title;
        }));
        _context.BookLinks.AddRange(links.Select(link =>
        {
            link.BookId = bookId;
            return link;
        }));
        _context.Set<BookGenre>().AddRange(genreIds.Distinct().Select(genreId => new BookGenre
        {
            BookId = bookId, GenreId = genreId
        }));
        _context.Set<BookTag>().AddRange(tagIds.Distinct().Select(tagId => new BookTag
        {
            BookId = bookId, TagId = tagId
        }));

        if (progressHistory != null)
        {
            progressHistory.BookId = bookId;
            _context.BookProgressHistory.Add(progressHistory);
        }
    }

    private Guid[] GetChangedSearchBookIds()
    {
        return _pendingSearchRefreshes
            .Concat(_context.ChangeTracker.Entries<Book>()
                .Where(entry =>
                    entry.State == EntityState.Added ||
                    (entry.State == EntityState.Modified &&
                     (entry.Property(book => book.PrimaryTitle).IsModified ||
                      entry.Property(book => book.AuthorId).IsModified ||
                      entry.Property(book => book.ContentTypeId).IsModified ||
                      entry.Property(book => book.StatusId).IsModified)))
                .Select(entry => entry.Entity.Id))
            .Concat(_context.ChangeTracker.Entries<BookTitle>()
                .Where(entry => entry.State is EntityState.Added or EntityState.Modified or EntityState.Deleted)
                .Select(entry => entry.Entity.BookId))
            .Concat(_context.ChangeTracker.Entries<BookGenre>()
                .Where(entry => entry.State is EntityState.Added or EntityState.Modified or EntityState.Deleted)
                .Select(entry => entry.Entity.BookId))
            .Concat(_context.ChangeTracker.Entries<BookTag>()
                .Where(entry => entry.State is EntityState.Added or EntityState.Modified or EntityState.Deleted)
                .Select(entry => entry.Entity.BookId))
            .Distinct()
            .ToArray();
    }

    private void DetachTrackedEditableCollections(Guid bookId)
    {
        foreach (var entry in _context.ChangeTracker.Entries<BookTitle>()
                     .Where(entry => entry.Entity.BookId == bookId).ToList())
        {
            entry.State = EntityState.Detached;
        }

        foreach (var entry in _context.ChangeTracker.Entries<BookLink>()
                     .Where(entry => entry.Entity.BookId == bookId).ToList())
        {
            entry.State = EntityState.Detached;
        }

        foreach (var entry in _context.ChangeTracker.Entries<BookGenre>()
                     .Where(entry => entry.Entity.BookId == bookId).ToList())
        {
            entry.State = EntityState.Detached;
        }

        foreach (var entry in _context.ChangeTracker.Entries<BookTag>()
                     .Where(entry => entry.Entity.BookId == bookId).ToList())
        {
            entry.State = EntityState.Detached;
        }
    }

    private static IQueryable<Book> IncludeDetails(IQueryable<Book> query)
    {
        return query
            .Include(book => book.Author).ThenInclude(author => author!.Names)
            .Include(book => book.Cover)
            .Include(book => book.ContentType)
            .Include(book => book.Status)
            .Include(book => book.Titles)
            .Include(book => book.BookGenres).ThenInclude(bookGenre => bookGenre.Genre)
            .Include(book => book.BookTags).ThenInclude(bookTag => bookTag.Tag)
            .Include(book => book.Links)
            .Include(book => book.ProgressHistory);
    }
}
