using Application.Common.Interfaces;
using Application.Common.Models;
using Infrastructure.Authentication;
using Microsoft.Extensions.Options;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;

namespace Application.UnitTests;

public class JwtTokenGeneratorTests
{
    private static readonly Guid UserId = Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");

    [Fact]
    public void GenerateToken_ShouldReturnNullForUnauthenticatedUser()
    {
        var generator = CreateGenerator();

        var token = generator.GenerateToken(new FakeUser(false));

        Assert.Null(token);
    }

    [Fact]
    public void GenerateToken_ShouldIncludeUserClaimsAndRoles()
    {
        var generator = CreateGenerator();

        var token = generator.GenerateToken(new FakeUser(true));

        Assert.NotNull(token);
        Assert.Equal(UserId, token.UserId);
        var jwt = new JwtSecurityTokenHandler().ReadJwtToken(token.AccessToken);
        Assert.Contains(jwt.Claims,
            claim => claim.Type == ClaimTypes.NameIdentifier && claim.Value == UserId.ToString());
        Assert.Contains(jwt.Claims, claim => claim.Type == ClaimTypes.Name && claim.Value == "reader");
        Assert.Contains(jwt.Claims, claim => claim.Type == ClaimTypes.Email && claim.Value == "reader@example.com");
        Assert.Contains(jwt.Claims, claim => claim.Type == ClaimTypes.Role && claim.Value == "Admin");
    }

    private static JwtTokenGenerator CreateGenerator()
    {
        return new JwtTokenGenerator(Options.Create(new JwtSettings
        {
            Key = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
            Issuer = "TsundokuTests",
            Audience = "TsundokuTests"
        }));
    }

    private sealed class FakeUser : IUser
    {
        public FakeUser(bool authenticated)
        {
            IsAuthenticated = authenticated;
        }

        public Guid? Id => UserId;
        public Guid RequiredId => UserId;
        public string? Email => "reader@example.com";
        public string? Username => "reader";
        public IEnumerable<string> Roles => ["Admin", "Reader"];
        public bool IsAuthenticated { get; }
        public bool Valid => IsAuthenticated;
    }
}
