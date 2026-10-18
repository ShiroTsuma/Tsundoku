namespace Application.Features.TagFeatures.Queries;

using Application.Common.DTOs.Tag;

public record SearchTagsQuery(string? Search = null, int Take = 10, int Skip = 0) : IRequest<IReadOnlyCollection<TagDto>>;

public class SearchTagsQueryHandler : IRequestHandler<SearchTagsQuery, IReadOnlyCollection<TagDto>>
{
    private readonly ITagRepository _tagRepository;
    private readonly IUser _user;

    public SearchTagsQueryHandler(ITagRepository tagRepository, IUser user)
    {
        _tagRepository = tagRepository;
        _user = user;
    }

    public async Task<IReadOnlyCollection<TagDto>> Handle(SearchTagsQuery request, CancellationToken cancellationToken)
    {
        var tags = await _tagRepository.SearchAsync(_user.RequiredId, request.Search,
            Math.Clamp(request.Take, 1, 50), cancellationToken, Math.Max(0, request.Skip));
        return tags.Select(t => t.ToDto()).ToList();
    }
}
