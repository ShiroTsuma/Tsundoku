using System.Net;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text.Encodings.Web;
using Api.Controllers;
using Application.Common.DTOs.Book;
using Application.Common.Interfaces;
using Domain.Entities;
using Infrastructure.Contexts;
using Infrastructure.Identity;
using Infrastructure.IntegrationTests.TestSupport;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Infrastructure.IntegrationTests;

public class BookCoverEndpointTests
{
    private static readonly Guid UserId = Guid.Parse("11111111-1111-1111-1111-111111111111");

    [Fact]
    public async Task SetCoverFromUrl_ShouldUpdateExistingNotFoundCover()
    {
        await using var factory = new BookCoverApiFactory();
        var bookId = await factory.SeedBookWithNotFoundCoverAsync();
        using var client = factory.CreateAuthenticatedClient();

        var response = await client.PutAsJsonAsync(
            $"/api/v1/book/{bookId}/cover/url",
            new SetBookCoverFromUrlRequest("https://example.com/cover.jpg"));

        var body = await response.Content.ReadAsStringAsync();
        Assert.True(response.IsSuccessStatusCode, $"Expected success, got {(int)response.StatusCode}: {body}");
        var cover = await response.Content.ReadFromJsonAsync<BookCoverDto>();
        Assert.NotNull(cover);
        Assert.Equal("Uploaded", cover.Status);
        Assert.Equal("ManualUrl", cover.Source);

        await using var scope = factory.Services.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
        var stored = await context.BookCovers.SingleAsync(c => c.BookId == bookId);
        Assert.Equal(BookCoverStatus.Uploaded, stored.Status);
        Assert.Equal(BookCoverSource.ManualUrl, stored.Source);
        Assert.Equal("test/cover.jpg", stored.StoragePath);
        Assert.Equal("test/cover.thumb.jpg", stored.ThumbnailStoragePath);
        Assert.Null(stored.FailureReason);
    }

    [Fact]
    public async Task SetCoverFromUrl_ShouldCreateCover_WhenBookHasNoCoverRow()
    {
        await using var factory = new BookCoverApiFactory();
        var bookId = await factory.SeedBookWithoutCoverAsync();
        using var client = factory.CreateAuthenticatedClient();

        var response = await client.PutAsJsonAsync(
            $"/api/v1/book/{bookId}/cover/url",
            new SetBookCoverFromUrlRequest("https://example.com/cover.jpg"));

        var body = await response.Content.ReadAsStringAsync();
        Assert.True(response.IsSuccessStatusCode, $"Expected success, got {(int)response.StatusCode}: {body}");
        var cover = await response.Content.ReadFromJsonAsync<BookCoverDto>();
        Assert.NotNull(cover);
        Assert.Equal("Uploaded", cover.Status);

        await using var scope = factory.Services.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
        var stored = await context.BookCovers.SingleAsync(c => c.BookId == bookId);
        Assert.Equal(BookCoverStatus.Uploaded, stored.Status);
        Assert.Equal(BookCoverSource.ManualUrl, stored.Source);
    }

    private sealed class BookCoverApiFactory : WebApplicationFactory<Program>
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
                    ["Database:AutoMigrate"] = "false",
                    ["BookCovers:S3:Endpoint"] = "",
                    ["BookCovers:S3:AccessKey"] = "",
                    ["BookCovers:S3:SecretKey"] = "",
                    ["BookCovers:S3:Bucket"] = ""
                });
            });
            builder.ConfigureTestServices(services =>
            {
                services.RemoveAll<DbContextOptions<ApplicationDbContext>>();
                services.RemoveAll<IDbContextOptionsConfiguration<ApplicationDbContext>>();
                services.RemoveAll<IBookCoverRemoteImageService>();
                services.RemoveAll<IBookListCacheInvalidator>();
                services.RemoveAll<IAuthenticationSchemeProvider>();
                services.RemoveAll<IHostedService>();
                services.RemoveAll<IUser>();
                services.AddDbContext<ApplicationDbContext>(options =>
                {
                    options.UseSqlite(_connection);
                    options.UseInternalServiceProvider(_sqliteServices);
                    options.EnableSensitiveDataLogging();
                });
                services.AddScoped<IBookCoverRemoteImageService, FakeRemoteImageService>();
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
                new System.Net.Http.Headers.AuthenticationHeaderValue(TestAuthHandler.AuthenticationScheme);
            return client;
        }

        public async Task<Guid> SeedBookWithNotFoundCoverAsync()
        {
            await EnsureCreatedAsync();
            await using var scope = Services.CreateAsyncScope();
            var context = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
            var book = TestData.Book(UserId, "No Cover Found");
            book.Cover = new BookCover
            {
                Status = BookCoverStatus.NotFound,
                FailureReason =
                    "No cover found in saved links, AniList, Jikan, Google Books, Open Library, or Wikidata."
            };
            context.Books.Add(book);
            await context.SaveChangesAsync();
            return book.Id;
        }

        public async Task<Guid> SeedBookWithoutCoverAsync()
        {
            await EnsureCreatedAsync();
            await using var scope = Services.CreateAsyncScope();
            var context = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
            var book = TestData.Book(UserId, "No Cover Row");
            context.Books.Add(book);
            await context.SaveChangesAsync();
            return book.Id;
        }

        private async Task EnsureCreatedAsync()
        {
            await using var scope = Services.CreateAsyncScope();
            var context = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
            await context.Database.EnsureCreatedAsync();
            if (!await context.Users.AnyAsync(u => u.Id == UserId))
            {
                context.Users.Add(new User
                {
                    Id = UserId,
                    UserName = "reader",
                    NormalizedUserName = "READER",
                    Email = "reader@example.com",
                    NormalizedEmail = "READER@EXAMPLE.COM"
                });
                await context.SaveChangesAsync();
            }
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

    private sealed class FakeRemoteImageService : IBookCoverRemoteImageService
    {
        public Task<BookCoverStoredFiles> SaveFromUrlAsync(Guid ownerId, Guid bookId, string imageUrl,
            CancellationToken cancellationToken)
        {
            return Task.FromResult(new BookCoverStoredFiles(
                new BookCoverStoredVariant("test/cover.jpg", "image/jpeg", 123, 900, 1350),
                new BookCoverStoredVariant("test/cover.thumb.jpg", "image/jpeg", 45, 500, 750)));
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
        public IEnumerable<string> Roles => Array.Empty<string>();
        public bool IsAuthenticated => true;
        public bool Valid => true;
    }

    private sealed class TestAuthHandler : AuthenticationHandler<AuthenticationSchemeOptions>
    {
        public const string AuthenticationScheme = "Test";

        public TestAuthHandler(
            IOptionsMonitor<AuthenticationSchemeOptions> options,
            ILoggerFactory logger,
            UrlEncoder encoder)
            : base(options, logger, encoder)
        {
        }

        protected override Task<AuthenticateResult> HandleAuthenticateAsync()
        {
            var claims = new[]
            {
                new Claim(ClaimTypes.NameIdentifier, UserId.ToString()), new Claim(ClaimTypes.Name, "reader"),
                new Claim(ClaimTypes.Email, "reader@example.com")
            };
            var identity = new ClaimsIdentity(claims, AuthenticationScheme);
            var principal = new ClaimsPrincipal(identity);
            var ticket = new AuthenticationTicket(principal, AuthenticationScheme);
            return Task.FromResult(AuthenticateResult.Success(ticket));
        }
    }
}
