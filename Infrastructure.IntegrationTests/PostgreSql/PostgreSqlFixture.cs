namespace Infrastructure.IntegrationTests.PostgreSql;

using Application.Common.Interfaces;
using BookSearch;
using Contexts;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql;
using Testcontainers.PostgreSql;

[CollectionDefinition(CollectionName, DisableParallelization = true)]
public sealed class PostgreSqlCollection : ICollectionFixture<PostgreSqlFixture>
{
    public const string CollectionName = "PostgreSQL";
}

public sealed class PostgreSqlFixture : IAsyncLifetime
{
    private readonly PostgreSqlContainer _container = new PostgreSqlBuilder("postgres:17-alpine")
        .WithDatabase("tsundoku_tests")
        .WithUsername("postgres")
        .WithPassword("postgres")
        .Build();

    public async Task InitializeAsync()
    {
        await _container.StartAsync();
        await ResetDatabaseAsync();
    }

    public Task DisposeAsync()
    {
        return _container.DisposeAsync().AsTask();
    }

    public ApplicationDbContext CreateContext(Guid userId, params IInterceptor[] interceptors)
    {
        var builder = new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseNpgsql(BookSearchConnectionSettings.Apply(_container.GetConnectionString()));
        if (interceptors.Length > 0)
        {
            builder.AddInterceptors(interceptors);
        }

        return new ApplicationDbContext(builder.Options, new FixtureUser(userId));
    }

    public async Task ResetDatabaseAsync()
    {
        await ResetDatabaseAsync(null);
    }

    public async Task ResetDatabaseAsync(string? targetMigration)
    {
        await using (var connection = new NpgsqlConnection(_container.GetConnectionString()))
        {
            await connection.OpenAsync();
            await using var command = connection.CreateCommand();
            command.CommandText = "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;";
            await command.ExecuteNonQueryAsync();
        }

        await using var context = CreateContext(Guid.Empty);
        await context.Database.GetService<IMigrator>().MigrateAsync(targetMigration);
    }

    private sealed record FixtureUser(Guid UserId) : IUser
    {
        public Guid? Id => UserId;
        public Guid RequiredId => UserId;
        public string? Email => null;
        public string? Username => null;
        public IEnumerable<string> Roles => [];
        public bool IsAuthenticated => true;
        public bool Valid => true;
    }
}
