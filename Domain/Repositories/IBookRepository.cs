namespace Domain.Repositories;

public interface IBookRepository
{
    public Task<Book?> GetByIdAsync(Guid id, Guid ownerId, CancellationToken cancellationToken);

    public Task<Book?> GetByIdAsync(Guid id, CancellationToken cancellationToken)
    {
        throw new NotSupportedException();
    }

    public Task<Book?> GetForUpdateAsync(Guid id, Guid ownerId, CancellationToken cancellationToken)
    {
        return GetByIdAsync(id, ownerId, cancellationToken);
    }

    public Task<Book?> GetForUpdateAsync(Guid id, CancellationToken cancellationToken)
    {
        return GetByIdAsync(id, cancellationToken);
    }

    public Task<Book?> GetByNameAsync(string name, Guid ownerId, Guid contentTypeId,
        CancellationToken cancellationToken);

    public Task<int> GetCountAsync(Guid ownerId, CancellationToken cancellationToken);

    public Task<int> GetCountAsync(CancellationToken cancellationToken)
    {
        throw new NotSupportedException();
    }

    public Task<bool> UpdateProgressAsync(Guid id, Guid ownerId, decimal? currentChapterNumber,
        string? currentChapterLabel, string? comment, CancellationToken cancellationToken, bool completed = false)
    {
        throw new NotSupportedException();
    }

    public Task<decimal?> GetTotalChaptersAsync(Guid id, Guid ownerId, CancellationToken cancellationToken)
    {
        throw new NotSupportedException();
    }

    public Task ReplaceEditableCollectionsAsync(
        Guid bookId,
        IEnumerable<BookTitle> titles,
        IEnumerable<BookLink> links,
        IEnumerable<Guid> genreIds,
        IEnumerable<Guid> tagIds,
        BookProgressHistory? progressHistory,
        CancellationToken cancellationToken)
    {
        throw new NotSupportedException();
    }

    public Task AddAsync(Book book, CancellationToken cancellationToken);
    public Task DeleteAsync(Guid id, Guid ownerId, CancellationToken cancellationToken);
    public Task SaveAsync(CancellationToken cancellationToken);
}
