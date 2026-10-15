namespace Infrastructure.IntegrationTests;

using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text.Encodings.Web;
using Application.Common.DTOs.Author;
using Application.Common.Interfaces;
using Contexts;
using Domain.Entities;
using Identity;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using TestSupport;

public sealed class AuthorEndpointTests
{
    private static readonly Guid UserId = Guid.Parse("11111111-1111-1111-1111-111111111111");

    [Fact]
    public async Task UpdateAuthor_ShouldIgnoreAliasEquivalentToPrimaryNameWithoutSpaces()
    {
        await using var factory = new AuthorApiFactory();
        var authorId = await factory.SeedAuthorAsync();
        using var client = factory.CreateAuthenticatedClient();

        var response = await client.PutAsJsonAsync($"/api/v1/author/{authorId}",
            new { otherNames = new[] { "耳根", "Ergen", "Eargen" } });

        var body = await response.Content.ReadAsStringAsync();
        Assert.True(response.IsSuccessStatusCode, $"Expected success, got {(int)response.StatusCode}: {body}");
        var author = await response.Content.ReadFromJsonAsync<AuthorDto>();
        Assert.NotNull(author);
        Assert.Equal(["Eargen", "耳根"], author.OtherNames);

        await using var scope = factory.Services.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
        var storedNames = await context.AuthorNames
            .Where(name => name.AuthorId == authorId && !name.IsPrimary)
            .OrderBy(name => name.Name)
            .Select(name => name.Name)
            .ToListAsync();
        Assert.Equal(["Eargen", "耳根"], storedNames);
    }

    private sealed class AuthorApiFactory : WebApplicationFactory<Program>
    {
        private readonly SqliteConnection _connection = new("DataSource=:memory:");

        private readonly ServiceProvider _sqliteServices = new ServiceCollection()
            .AddEntityFrameworkSqlite()
            .BuildServiceProvider();

        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            _connection.Open();
            builder.UseEnvironment("Testing");
            builder.ConfigureAppConfiguration((_, config) =>
            {
                config.AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["ConnectionStrings:DB"] = "Host=localhost;Database=test;Username=test;Password=test",
                    ["Jwt:Key"] = "test-test-test-test-test-test-test-test-test-test-test-test",
                    ["Jwt:Issuer"] = "Tsundoku.Tests",
                    ["Jwt:Audience"] = "Tsundoku.Tests",
                    ["Database:AutoMigrate"] = "false"
                });
            });
            builder.ConfigureTestServices(services =>
            {
                services.RemoveAll<DbContextOptions<ApplicationDbContext>>();
                services.RemoveAll<IDbContextOptionsConfiguration<ApplicationDbContext>>();
                services.RemoveAll<IAuthenticationSchemeProvider>();
                services.RemoveAll<IBookListCacheInvalidator>();
                services.RemoveAll<IHostedService>();
                services.RemoveAll<IUser>();
                services.AddDbContext<ApplicationDbContext>(options =>
                {
                    options.UseSqlite(_connection);
                    options.UseInternalServiceProvider(_sqliteServices);
                    options.EnableSensitiveDataLogging();
                });
                services.AddScoped<IBookListCacheInvalidator, NoopBookListCacheInvalidator>();
                services.AddScoped<IUser, TestUser>();
                services
                    .AddAuthentication(TestAuthHandler.AuthenticationScheme)
                    .AddScheme<AuthenticationSchemeOptions, TestAuthHandler>(TestAuthHandler.AuthenticationScheme,
                        _ => { });
                services.Configure<AuthenticationOptions>(options =>
                {
                    options.DefaultAuthenticateScheme = TestAuthHandler.AuthenticationScheme;
                    options.DefaultChallengeScheme = TestAuthHandler.AuthenticationScheme;
                    options.DefaultScheme = TestAuthHandler.AuthenticationScheme;
                });
            });
        }

        public HttpClient CreateAuthenticatedClient()
        {
            var client = CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
            client.DefaultRequestHeaders.Authorization =
                new AuthenticationHeaderValue(TestAuthHandler.AuthenticationScheme);
            return client;
        }

        public async Task<Guid> SeedAuthorAsync()
        {
            await using var scope = Services.CreateAsyncScope();
            var context = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
            await context.Database.EnsureCreatedAsync();
            context.Users.Add(new User
            {
                Id = UserId,
                UserName = "reader",
                NormalizedUserName = "READER",
                Email = "reader@example.com",
                NormalizedEmail = "READER@EXAMPLE.COM"
            });
            var author = TestData.Author("Er Gen", UserId, false);
            author.Names.Add(new AuthorName
            {
                Name = "Old alias", NormalizedName = "OLDALIAS", IsPrimary = false, Source = "Test"
            });
            context.Authors.Add(author);
            await context.SaveChangesAsync();
            return author.Id;
        }

        protected override void Dispose(bool disposing)
        {
            base.Dispose(disposing);
            if (disposing)
            {
                _connection.Dispose();
                _sqliteServices.Dispose();
            }
        }
    }

    private sealed class NoopBookListCacheInvalidator : IBookListCacheInvalidator
    {
        public Task InvalidateBooksAsync(Guid ownerId, CancellationToken cancellationToken)
        {
            return Task.CompletedTask;
        }
    }

    private sealed class TestUser : IUser
    {
        public Guid? Id => UserId;
        public Guid RequiredId => UserId;
        public string? Email => "reader@example.com";
        public string? Username => "reader";
        public IEnumerable<string> Roles => [];
        public bool IsAuthenticated => true;
        public bool Valid => true;
    }

    private sealed class TestAuthHandler(
        IOptionsMonitor<AuthenticationSchemeOptions> options,
        ILoggerFactory logger,
        UrlEncoder encoder) : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
    {
        public const string AuthenticationScheme = "Test";

        protected override Task<AuthenticateResult> HandleAuthenticateAsync()
        {
            var claims = new[]
            {
                new Claim(ClaimTypes.NameIdentifier, UserId.ToString()), new Claim(ClaimTypes.Name, "reader"),
                new Claim(ClaimTypes.Email, "reader@example.com")
            };
            var identity = new ClaimsIdentity(claims, AuthenticationScheme);
            var ticket = new AuthenticationTicket(new ClaimsPrincipal(identity), AuthenticationScheme);
            return Task.FromResult(AuthenticateResult.Success(ticket));
        }
    }
}
