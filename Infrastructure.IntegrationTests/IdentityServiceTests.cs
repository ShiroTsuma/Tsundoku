namespace Infrastructure.IntegrationTests;

using Application.Common.DTOs.User;
using Application.Common.Interfaces;
using Authentication;
using Contexts;
using Domain.Exceptions;
using Identity;
using Microsoft.AspNetCore.Identity;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Services;

public class IdentityServiceTests
{
    [Fact]
    public async Task RegisterUser_ShouldCreateUserAndRejectDuplicateUsernameAndEmail()
    {
        using var host = new IdentityTestHost();
        var service = host.GetRequiredService<IdentityService>();

        var created =
            await service.RegisterUser(new RegisterDto("new-reader", "new-reader@example.com", "Strong1!"),
                CancellationToken.None);

        Assert.NotEqual(Guid.Empty, created.Id);
        Assert.Equal("new-reader", created.Name);
        await Assert.ThrowsAsync<UsernameTakenException>(() =>
            service.RegisterUser(new RegisterDto("new-reader", "other@example.com", "Strong1!"),
                CancellationToken.None));
        await Assert.ThrowsAsync<EmailInUseException>(() =>
            service.RegisterUser(new RegisterDto("other-reader", "new-reader@example.com", "Strong1!"),
                CancellationToken.None));
    }

    [Fact]
    public async Task RegisterUser_ShouldSurfaceIdentityErrors()
    {
        using var host = new IdentityTestHost();
        var service = host.GetRequiredService<IdentityService>();

        var ex = await Assert.ThrowsAsync<IdentityOperationFailedException>(() =>
            service.RegisterUser(new RegisterDto("weak-reader", "weak@example.com", "x"), CancellationToken.None));

        Assert.NotEmpty(ex.Errors);
    }

    [Fact]
    public async Task LoginUser_ShouldIssueAccessAndRefreshToken()
    {
        using var host = new IdentityTestHost();
        var service = host.GetRequiredService<IdentityService>();
        await service.RegisterUser(new RegisterDto("login-reader", "login@example.com", "Strong1!"),
            CancellationToken.None);

        var response =
            await service.LoginUser(new LoginDto("login-reader", null, "Strong1!"), CancellationToken.None);

        Assert.False(string.IsNullOrWhiteSpace(response.AccessToken));
        Assert.False(string.IsNullOrWhiteSpace(response.RefreshToken));
        Assert.True(response.RefreshTokenExpiresAt > DateTimeOffset.UtcNow);
        await using var context = host.CreateContext();
        Assert.Single(context.RefreshTokens.Where(token => token.UserId == response.UserId));
    }

    [Fact]
    public async Task LoginUser_ShouldRejectMissingUserAndWrongPassword()
    {
        using var host = new IdentityTestHost();
        var service = host.GetRequiredService<IdentityService>();
        await service.RegisterUser(new RegisterDto("password-reader", "password@example.com", "Strong1!"),
            CancellationToken.None);

        var missingUser = await Assert.ThrowsAsync<AuthenticationFailedException>(() =>
            service.LoginUser(new LoginDto("missing-reader", null, "Strong1!"), CancellationToken.None));
        var wrongPassword = await Assert.ThrowsAsync<AuthenticationFailedException>(() =>
            service.LoginUser(new LoginDto("password-reader", null, "Wrong1!"), CancellationToken.None));
        Assert.Equal(AuthenticationFailedException.PublicMessage, missingUser.Message);
        Assert.Equal(missingUser.Message, wrongPassword.Message);
    }

    [Fact]
    public async Task RefreshTokenAsync_ShouldRotateRefreshToken()
    {
        using var host = new IdentityTestHost();
        var service = host.GetRequiredService<IdentityService>();
        await service.RegisterUser(new RegisterDto("refresh-reader", "refresh@example.com", "Strong1!"),
            CancellationToken.None);
        var login = await service.LoginUser(new LoginDto(null, "refresh@example.com", "Strong1!"),
            CancellationToken.None);

        var refreshed = await service.RefreshTokenAsync(login.RefreshToken, CancellationToken.None);

        Assert.NotEqual(login.RefreshToken, refreshed.RefreshToken);
        Assert.False(string.IsNullOrWhiteSpace(refreshed.AccessToken));
        await using var context = host.CreateContext();
        var tokens = (await context.RefreshTokens
                .Where(token => token.UserId == login.UserId)
                .ToListAsync())
            .OrderBy(token => token.Created)
            .ToList();
        Assert.Equal(2, tokens.Count);
        Assert.Equal("Rotated", tokens[0].ReasonRevoked);
        Assert.NotNull(tokens[0].ReplacedByTokenHash);
        Assert.Null(tokens[1].RevokedAt);
    }

    [Fact]
    public async Task RefreshTokenAsync_ShouldRevokeTokenFamilyWhenRotatedTokenIsReused()
    {
        using var host = new IdentityTestHost();
        var service = host.GetRequiredService<IdentityService>();
        await service.RegisterUser(new RegisterDto("reuse-reader", "reuse@example.com", "Strong1!"),
            CancellationToken.None);
        var login = await service.LoginUser(new LoginDto("reuse-reader", null, "Strong1!"),
            CancellationToken.None);
        var refreshed = await service.RefreshTokenAsync(login.RefreshToken, CancellationToken.None);

        await Assert.ThrowsAsync<UnauthorizedAccessException>(() =>
            service.RefreshTokenAsync(login.RefreshToken, CancellationToken.None));
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() =>
            service.RefreshTokenAsync(refreshed.RefreshToken, CancellationToken.None));

        await using var context = host.CreateContext();
        var tokens = await context.RefreshTokens
            .Where(token => token.UserId == login.UserId)
            .ToListAsync();
        Assert.All(tokens, token => Assert.False(token.IsActive));
        Assert.Contains(tokens, token => token.ReasonRevoked == "Refresh token reuse detected");
    }

    [Fact]
    public async Task BlockedAccount_ShouldNotLoginOrRefreshTokens()
    {
        using var host = new IdentityTestHost();
        var service = host.GetRequiredService<IdentityService>();
        await service.RegisterUser(new RegisterDto("blocked-reader", "blocked@example.com", "Strong1!"),
            CancellationToken.None);
        var login = await service.LoginUser(new LoginDto("blocked-reader", null, "Strong1!"),
            CancellationToken.None);
        var guard = host.GetRequiredService<AccountAbuseGuard>();
        await guard.BlockAsync(new TestUser(login.UserId), "test-suspicious-import", CancellationToken.None);

        await Assert.ThrowsAsync<AccountTemporarilyBlockedException>(() =>
            service.LoginUser(new LoginDto("blocked-reader", null, "Strong1!"), CancellationToken.None));
        await Assert.ThrowsAsync<AccountTemporarilyBlockedException>(() =>
            service.RefreshTokenAsync(login.RefreshToken, CancellationToken.None));

        await using var context = host.CreateContext();
        var storedToken = await context.RefreshTokens.SingleAsync(token => token.UserId == login.UserId);
        Assert.True(storedToken.IsActive);
    }

    [Fact]
    public async Task RefreshTokenAsync_ShouldRejectMissingInvalidAndExpiredTokens()
    {
        using var host = new IdentityTestHost();
        var service = host.GetRequiredService<IdentityService>();
        await service.RegisterUser(new RegisterDto("expired-reader", "expired@example.com", "Strong1!"),
            CancellationToken.None);
        var login =
            await service.LoginUser(new LoginDto("expired-reader", null, "Strong1!"), CancellationToken.None);
        await using (var context = host.CreateContext())
        {
            var stored = await context.RefreshTokens.SingleAsync(token => token.UserId == login.UserId);
            stored.ExpiresAt = DateTimeOffset.UtcNow.AddMinutes(-1);
            await context.SaveChangesAsync();
        }

        service = host.GetRequiredService<IdentityService>();
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() =>
            service.RefreshTokenAsync("", CancellationToken.None));
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() =>
            service.RefreshTokenAsync("not-a-real-token", CancellationToken.None));
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() =>
            service.RefreshTokenAsync(login.RefreshToken, CancellationToken.None));
    }

    [Fact]
    public async Task RevokeRefreshTokenAsync_ShouldIgnoreBlankAndRevokeActiveToken()
    {
        using var host = new IdentityTestHost();
        var service = host.GetRequiredService<IdentityService>();
        await service.RegisterUser(new RegisterDto("logout-reader", "logout@example.com", "Strong1!"),
            CancellationToken.None);
        var login =
            await service.LoginUser(new LoginDto("logout-reader", null, "Strong1!"), CancellationToken.None);

        await service.RevokeRefreshTokenAsync(null, CancellationToken.None);
        await service.RevokeRefreshTokenAsync(login.RefreshToken, CancellationToken.None);
        await service.RevokeRefreshTokenAsync(login.RefreshToken, CancellationToken.None);

        await using var context = host.CreateContext();
        var stored = await context.RefreshTokens.SingleAsync(token => token.UserId == login.UserId);
        Assert.Equal("Logged out", stored.ReasonRevoked);
        Assert.NotNull(stored.RevokedAt);
    }

    private sealed class IdentityTestHost : IDisposable
    {
        private readonly SqliteConnection _connection;
        private readonly ServiceProvider _provider;

        public IdentityTestHost()
        {
            _connection = new SqliteConnection("DataSource=:memory:");
            _connection.Open();

            var services = new ServiceCollection();
            services.AddLogging();
            services.AddHttpContextAccessor();
            services.AddAuthentication();
            services.AddSingleton<IUser>(new TestUser());
            services.AddDistributedMemoryCache();
            services.AddSingleton(
                Options.Create(new BookImportSecurityOptions()));
            services.AddSingleton<AccountAbuseGuard>();
            services.AddDbContext<ApplicationDbContext>(options => options.UseSqlite(_connection));
            services
                .AddIdentityCore<User>(options =>
                {
                    options.User.RequireUniqueEmail = true;
                    options.Password.RequiredLength = 6;
                    options.Password.RequireDigit = true;
                    options.Password.RequireLowercase = true;
                    options.Password.RequireUppercase = true;
                    options.Password.RequireNonAlphanumeric = true;
                })
                .AddRoles<IdentityRole<Guid>>()
                .AddEntityFrameworkStores<ApplicationDbContext>()
                .AddSignInManager();

            services.AddSingleton<IOptions<JwtSettings>>(Options.Create(new JwtSettings
            {
                Key = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
                Issuer = "TsundokuTests",
                Audience = "TsundokuTests"
            }));
            services.AddScoped<IJwtTokenGenerator, JwtTokenGenerator>();
            services.AddScoped<IdentityService>();

            _provider = services.BuildServiceProvider();
            using var scope = _provider.CreateScope();
            scope.ServiceProvider.GetRequiredService<ApplicationDbContext>().Database.EnsureCreated();
        }

        public void Dispose()
        {
            _provider.Dispose();
            _connection.Dispose();
        }

        public T GetRequiredService<T>() where T : notnull
        {
            return _provider.CreateScope().ServiceProvider.GetRequiredService<T>();
        }

        public ApplicationDbContext CreateContext()
        {
            return _provider.CreateScope().ServiceProvider.GetRequiredService<ApplicationDbContext>();
        }
    }

    private sealed class TestUser : IUser
    {
        public TestUser(Guid? id = null)
        {
            Id = id ?? Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
        }

        public Guid? Id { get; }
        public Guid RequiredId => Id!.Value;
        public string? Email => "tests@example.com";
        public string? Username => "tests";
        public IEnumerable<string> Roles => [];
        public bool IsAuthenticated => true;
        public bool Valid => true;
    }
}
