namespace Application.Features.AuthorFeatures.Queries;

using Common.DTOs.Author;

public record SearchAuthorsQuery(string? Search = null, int Take = 10, bool MineOnly = false, int Skip = 0)
    : IRequest<IReadOnlyCollection<AuthorDto>>;

public class SearchAuthorsQueryHandler : IRequestHandler<SearchAuthorsQuery, IReadOnlyCollection<AuthorDto>>
{
    private readonly IAuthorRepository _authorRepository;
    private readonly IUser _user;

    public SearchAuthorsQueryHandler(IAuthorRepository authorRepository, IUser user)
    {
        _authorRepository = authorRepository;
        _user = user;
    }

    public async Task<IReadOnlyCollection<AuthorDto>> Handle(SearchAuthorsQuery request,
        CancellationToken cancellationToken)
    {
        var take = Math.Clamp(request.Take, 1, 50);
        var authors = request.MineOnly &&
                      !_user.Roles.Contains(AuthorizationRoles.Admin, StringComparer.OrdinalIgnoreCase)
            ? await _authorRepository.SearchOwnedAsync(_user.RequiredId, request.Search, take, cancellationToken, Math.Max(0, request.Skip))
            : await _authorRepository.SearchAsync(_user.RequiredId, request.Search, take, cancellationToken, Math.Max(0, request.Skip));
        return authors.Select(a => a.ToDto(_user.RequiredId)).ToList();
    }
}
