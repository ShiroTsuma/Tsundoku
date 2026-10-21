namespace Api.Controllers;

using Application.Common.DTOs.Tag;
using Application.Common.Interfaces;
using Application.Common.Models;
using Domain.Entities;
using Infrastructure.Contexts;
using Microsoft.EntityFrameworkCore;
using System.ComponentModel.DataAnnotations;

[ApiController]
[Authorize(Roles = AuthorizationRoles.Admin)]
[Route(ApiRoutes.AdminMetadata)]
public sealed class MetadataPolicyController(ApplicationDbContext context, IMetadataPolicy policy, IUser user) : ControllerBase
{
    public sealed record AliasInput(
        [Required, RegularExpression("^(tag|genre)$")] string SourceKind,
        [Required, StringLength(100, MinimumLength = 1)] string Name, Guid? TagId, Guid? GenreId);
    public sealed record ImplicationInput(Guid? SourceTagId, Guid? SourceGenreId, Guid? TargetTagId, Guid? TargetGenreId);
    public sealed record PreviewInput([Required, MaxLength(200)] string[] Tags, [Required, MaxLength(100)] Guid[] GenreIds);

    [HttpGet("aliases")]
    public async Task<IActionResult> Aliases(int skip = 0, int take = 50, CancellationToken cancellationToken = default) =>
        Ok(await context.Set<MetadataAlias>().AsNoTracking().OrderBy(a => a.SourceKind).ThenBy(a => a.Name)
            .ThenBy(a => a.Id).Skip(Math.Max(0, skip)).Take(Math.Clamp(take, 1, 100)).Select(a => new MetadataAliasDto(
                a.Id, a.SourceKind, a.Name, a.TagId, a.GenreId,
                a.TagId != null ? context.Tags.Where(t => t.Id == a.TagId).Select(t => t.Name).FirstOrDefault()
                    : context.Genres.Where(g => g.Id == a.GenreId).Select(g => g.Name).FirstOrDefault()
            )).ToListAsync(cancellationToken));

    [HttpPut("aliases")]
    public async Task<IActionResult> SetAlias(AliasInput input, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(input.Name) || !await ValidTarget(input.TagId, input.GenreId, cancellationToken))
            return BadRequest("Select exactly one existing global tag or genre as the target.");
        var name = MappingExtensions.CollapseWhitespace(input.Name);
        var normalized = MappingExtensions.NormalizeName(name);
        var alias = await context.Set<MetadataAlias>().SingleOrDefaultAsync(a =>
            a.SourceKind == input.SourceKind && a.NormalizedName == normalized, cancellationToken);
        if (alias == null)
        {
            alias = new MetadataAlias { SourceKind = input.SourceKind, Name = name, NormalizedName = normalized };
            context.Add(alias);
        }
        alias.Name = name;
        alias.TagId = input.TagId;
        alias.GenreId = input.GenreId;
        try
        {
            await context.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException)
        {
            // Another request created the same incoming name first (unique SourceKind + NormalizedName).
            return Conflict("This incoming name was just redirected by another request. Reload and try again.");
        }
        return Ok(new MetadataAliasDto(alias.Id, alias.SourceKind, alias.Name, alias.TagId, alias.GenreId, null));
    }

    [HttpDelete("aliases/{id:guid}")]
    public async Task<IActionResult> DeleteAlias(Guid id, CancellationToken cancellationToken)
    {
        var alias = await context.Set<MetadataAlias>().FindAsync([id], cancellationToken);
        if (alias == null) return NotFound();
        context.Remove(alias);
        await context.SaveChangesAsync(cancellationToken);
        return NoContent();
    }

    [HttpGet("implications")]
    public async Task<IActionResult> Implications(int skip = 0, int take = 50, CancellationToken cancellationToken = default) =>
        Ok(await context.Set<MetadataImplication>().AsNoTracking().OrderBy(r => r.Id)
            .Skip(Math.Max(0, skip)).Take(Math.Clamp(take, 1, 100)).Select(r => new MetadataImplicationDto(
                r.Id, r.SourceTagId, r.SourceGenreId, r.TargetTagId, r.TargetGenreId,
                r.SourceTagId != null ? context.Tags.Where(t => t.Id == r.SourceTagId).Select(t => t.Name).FirstOrDefault()
                    : context.Genres.Where(g => g.Id == r.SourceGenreId).Select(g => g.Name).FirstOrDefault(),
                r.TargetTagId != null ? context.Tags.Where(t => t.Id == r.TargetTagId).Select(t => t.Name).FirstOrDefault()
                    : context.Genres.Where(g => g.Id == r.TargetGenreId).Select(g => g.Name).FirstOrDefault()
            )).ToListAsync(cancellationToken));

    [HttpPost("implications")]
    public async Task<IActionResult> AddImplication(ImplicationInput input, CancellationToken cancellationToken)
    {
        if (!await ValidTarget(input.SourceTagId, input.SourceGenreId, cancellationToken) ||
            !await ValidTarget(input.TargetTagId, input.TargetGenreId, cancellationToken))
            return BadRequest("Each side must select exactly one existing global tag or genre.");
        if (input.SourceTagId == input.TargetTagId && input.SourceGenreId == input.TargetGenreId)
            return BadRequest("Source and target must differ.");
        var existing = await context.Set<MetadataImplication>().FirstOrDefaultAsync(r =>
            r.SourceTagId == input.SourceTagId && r.SourceGenreId == input.SourceGenreId &&
            r.TargetTagId == input.TargetTagId && r.TargetGenreId == input.TargetGenreId, cancellationToken);
        if (existing != null) return Ok(ToDto(existing));
        var rule = new MetadataImplication
        {
            SourceTagId = input.SourceTagId, SourceGenreId = input.SourceGenreId,
            TargetTagId = input.TargetTagId, TargetGenreId = input.TargetGenreId
        };
        context.Add(rule);
        await context.SaveChangesAsync(cancellationToken);
        return Ok(ToDto(rule));
    }

    [HttpDelete("implications/{id:guid}")]
    public async Task<IActionResult> DeleteImplication(Guid id, CancellationToken cancellationToken)
    {
        var rule = await context.Set<MetadataImplication>().FindAsync([id], cancellationToken);
        if (rule == null) return NotFound();
        context.Remove(rule);
        await context.SaveChangesAsync(cancellationToken);
        return NoContent();
    }

    [HttpPost("preview")]
    public async Task<IActionResult> Preview(PreviewInput input, CancellationToken cancellationToken) =>
        Ok(await policy.ResolveAsync(user.RequiredId, input.Tags, input.GenreIds, cancellationToken));

    [HttpGet("review")]
    public async Task<IActionResult> Review(int skip = 0, int take = 50, bool withoutDescription = true,
        CancellationToken cancellationToken = default)
    {
        var query = context.Tags.AsNoTracking().AsQueryable();
        if (withoutDescription) query = query.Where(t => t.Description == null || t.Description.Trim() == "");
        skip = Math.Max(0, skip);
        take = Math.Clamp(take, 1, 100);
        var total = await query.CountAsync(cancellationToken);
        var data = await query.OrderBy(t => t.Name).ThenBy(t => t.Id).Skip(skip).Take(take)
            .Select(t => new MetadataReviewTagDto(t.Id, t.Name, t.Description, t.IsGlobal, t.OwnerId, t.BookTags.Count,
                context.Set<MetadataAlias>().Where(a => a.TagId == t.Id).Select(a => a.Name).ToArray()))
            .ToListAsync(cancellationToken);
        return Ok(PaginatedResult<MetadataReviewTagDto>.Create(skip, take, total, data));
    }

    private static MetadataImplicationDto ToDto(MetadataImplication rule) => new(rule.Id, rule.SourceTagId,
        rule.SourceGenreId, rule.TargetTagId, rule.TargetGenreId, null, null);

    private async Task<bool> ValidTarget(Guid? tagId, Guid? genreId, CancellationToken cancellationToken) =>
        tagId.HasValue != genreId.HasValue && (tagId.HasValue
            ? await context.Tags.AnyAsync(t => t.Id == tagId && t.IsGlobal, cancellationToken)
            : await context.Genres.AnyAsync(g => g.Id == genreId, cancellationToken));
}
