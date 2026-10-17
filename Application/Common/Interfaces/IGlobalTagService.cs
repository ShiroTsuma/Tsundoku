namespace Application.Common.Interfaces;

public interface IGlobalTagService
{
    public Task<IReadOnlyCollection<Tag>> SearchAsync(string? search, int take, CancellationToken cancellationToken, int skip = 0);
    public Task<Tag> CreateAsync(string name, string? description, CancellationToken cancellationToken);
    public Task<Tag> UpdateAsync(Guid id, string name, string? description, CancellationToken cancellationToken);
    public Task DeleteAsync(Guid id, CancellationToken cancellationToken);
}
