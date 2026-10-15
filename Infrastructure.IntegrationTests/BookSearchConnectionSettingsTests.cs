namespace Infrastructure.IntegrationTests;

using BookSearch;
using Npgsql;

public sealed class BookSearchConnectionSettingsTests
{
    [Fact]
    public void Apply_ShouldConfigureTheCandidatePrefilterThreshold()
    {
        var connectionString = BookSearchConnectionSettings.Apply(
            "Host=localhost;Port=5432;Database=tsundoku;Username=postgres;Password=postgres");
        var builder = new NpgsqlConnectionStringBuilder(connectionString);

        Assert.Equal(0.4, BookSearchConnectionSettings.WordSimilarityThreshold);
        Assert.Contains(
            "-c pg_trgm.word_similarity_threshold=0.4",
            builder.Options,
            StringComparison.Ordinal);
    }
}
