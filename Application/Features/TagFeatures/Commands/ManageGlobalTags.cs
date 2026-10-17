namespace Application.Features.TagFeatures.Commands;

using Common.DTOs.Tag;

public sealed record SearchGlobalTagsQuery(string? Search = null, int Take = 100, int Skip = 0)
    : IRequest<IReadOnlyCollection<TagDto>>;

public sealed class SearchGlobalTagsQueryHandler(IGlobalTagService service)
    : IRequestHandler<SearchGlobalTagsQuery, IReadOnlyCollection<TagDto>>
{
    public async Task<IReadOnlyCollection<TagDto>> Handle(SearchGlobalTagsQuery request,
        CancellationToken cancellationToken)
    {
        return (await service.SearchAsync(request.Search, request.Take, cancellationToken, request.Skip)).Select(tag => tag.ToDto())
            .ToList();
    }
}

public sealed record CreateGlobalTagCommand(string Name, string? Description = null) : IRequest<TagDto>;

public sealed class CreateGlobalTagCommandHandler(IGlobalTagService service)
    : IRequestHandler<CreateGlobalTagCommand, TagDto>
{
    public async Task<TagDto> Handle(CreateGlobalTagCommand request, CancellationToken cancellationToken)
    {
        return (await service.CreateAsync(request.Name, request.Description, cancellationToken)).ToDto();
    }
}

public sealed record UpdateGlobalTagCommand : IRequest<TagDto>
{
    [JsonIgnore] public Guid Id { get; set; }
    public required string Name { get; set; }
    public string? Description { get; set; }
}

public sealed class UpdateGlobalTagCommandHandler(IGlobalTagService service)
    : IRequestHandler<UpdateGlobalTagCommand, TagDto>
{
    public async Task<TagDto> Handle(UpdateGlobalTagCommand request, CancellationToken cancellationToken)
    {
        return (await service.UpdateAsync(request.Id, request.Name, request.Description, cancellationToken)).ToDto();
    }
}

public sealed record DeleteGlobalTagCommand(Guid Id) : IRequest;

public sealed class DeleteGlobalTagCommandHandler(IGlobalTagService service)
    : IRequestHandler<DeleteGlobalTagCommand>
{
    public Task Handle(DeleteGlobalTagCommand request, CancellationToken cancellationToken)
    {
        return service.DeleteAsync(request.Id, cancellationToken);
    }
}
