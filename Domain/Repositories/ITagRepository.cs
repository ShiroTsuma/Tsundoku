namespace Domain.Repositories;

public interface ITagRepository
{
    public Task<Tag?> GetByIdAsync(Guid ownerId, Guid id, CancellationToken cancellationToken);
    public Task<Tag?> GetByNameAsync(Guid ownerId, string name, CancellationToken cancellationToken);

    public Task<IEnumerable<Tag>> GetByNamesAsync(Guid ownerId, IEnumerable<string> names,
        CancellationToken cancellationToken);

    public Task<IEnumerable<Tag>> SearchAsync(Guid ownerId, string? search, int take,
        CancellationToken cancellationToken, int skip = 0);

    public Task AddAsync(Tag tag, CancellationToken cancellationToken);
    public Task DeleteAsync(Tag tag, CancellationToken cancellationToken);
    public Task SaveAsync(CancellationToken cancellationToken);
}
