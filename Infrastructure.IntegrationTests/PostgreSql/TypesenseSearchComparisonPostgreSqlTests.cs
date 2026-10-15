namespace Infrastructure.IntegrationTests.PostgreSql;

using System.Collections.Concurrent;
using System.Diagnostics;
using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Application.Common;
using Contexts;
using Domain.Repositories;
using Identity;
using Microsoft.EntityFrameworkCore;
using Persistence;
using TestSupport;
using Xunit.Abstractions;

[Collection(PostgreSqlCollection.CollectionName)]
public sealed class TypesenseSearchComparisonPostgreSqlTests(PostgreSqlFixture fixture, ITestOutputHelper output)
{
    private const int TotalOperations = 10_000;
    private const int FullSetAnalysisOperations = 1_000;
    private const int DefaultParallelism = 8;
    private const int PageSize = 250;
    private const string CollectionName = "tsundoku_search_comparison";
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    [Fact]
    public async Task GeneralSearch_ShouldMeasureTypesenseAgainstPostgreSqlOnTheConfiguredDataset()
    {
        if (!string.Equals(Environment.GetEnvironmentVariable("RUN_TYPESENSE_COMPARISON"), "1",
                StringComparison.Ordinal))
        {
            return;
        }

        var csvPath = GetRequiredEnvironmentVariable("SEARCH_BENCHMARK_CSV");
        var endpoint = GetRequiredEnvironmentVariable("TYPESENSE_COMPARISON_URL");
        var apiKey = GetRequiredEnvironmentVariable("TYPESENSE_COMPARISON_API_KEY");

        await fixture.ResetDatabaseAsync();
        var ownerId = Guid.NewGuid();
        await using var seedContext = fixture.CreateContext(ownerId);
        await AddUserAsync(seedContext, ownerId);
        var dataset = await BookCsvDatasetSeeder.SeedAsync(
            seedContext,
            ownerId,
            csvPath: csvPath,
            profile: BookCsvSeedProfile.PreserveSource);
        await RefreshSearchIndexAsync(seedContext, ownerId);

        var documents = await seedContext.Books
            .AsNoTracking()
            .Where(book => book.OwnerId == ownerId)
            .Select(book => new TypesenseDocument(book.Id.ToString(), book.SearchDocument))
            .ToArrayAsync();

        using var client = CreateClient(endpoint, apiKey);
        await RecreateCollectionAsync(client, documents);

        var workload = CreateGeneralWorkload(dataset.Samples);
        var parallelism = GetParallelism();
        var outcomes = new ConcurrentBag<ComparisonOutcome>();
        var elapsed = Stopwatch.StartNew();

        await Parallel.ForEachAsync(
            workload,
            new ParallelOptions { MaxDegreeOfParallelism = parallelism },
            async (workItem, cancellationToken) =>
            {
                await using var context = fixture.CreateContext(ownerId);
                var parserQuery = EncodeForQueryGrammar(workItem.Query);
                BookSearchCriteria criteria;
                try
                {
                    criteria = BookSearchQueryParser.Parse(parserQuery);
                }
                catch (Exception exception)
                {
                    throw new InvalidOperationException($"Generated general query is invalid: {parserQuery}",
                        exception);
                }

                var criteriaApplier = new BookSearchCriteriaApplier(context);

                var postgresStarted = Stopwatch.GetTimestamp();
                var postgresIds = await criteriaApplier
                    .Apply(context.Books.AsNoTracking().Where(book => book.OwnerId == ownerId), criteria)
                    .OrderByDescending(book => book.LastProgressUpdatedAt)
                    .ThenBy(book => book.PrimaryTitle)
                    .ThenBy(book => book.Id)
                    .Take(PageSize)
                    .Select(book => book.Id.ToString())
                    .ToArrayAsync(cancellationToken);
                var postgresDuration = Stopwatch.GetElapsedTime(postgresStarted).TotalMilliseconds;

                var typesenseStarted = Stopwatch.GetTimestamp();
                var typesenseResponse = await SearchTypesenseAsync(client, workItem.Query, cancellationToken);
                var typesenseDuration = Stopwatch.GetElapsedTime(typesenseStarted).TotalMilliseconds;
                var typesenseIds = typesenseResponse.Hits.Select(hit => hit.Document.Id).ToArray();

                outcomes.Add(new ComparisonOutcome(
                    workItem.Field,
                    workItem.Query,
                    postgresDuration,
                    typesenseDuration,
                    postgresIds.Order().SequenceEqual(typesenseIds.Order(), StringComparer.Ordinal),
                    postgresIds.Length,
                    typesenseResponse.Found,
                    postgresIds.Contains(workItem.SourceBookId.ToString(), StringComparer.Ordinal),
                    GetRank(typesenseIds, workItem.SourceBookId.ToString())));
            });
        elapsed.Stop();

        var postgresDurations = outcomes.Select(outcome => outcome.PostgreSqlDuration).Order().ToArray();
        var typesenseDurations = outcomes.Select(outcome => outcome.TypesenseDuration).Order().ToArray();
        var exactSetMatches = outcomes.Count(outcome => outcome.SameIds);
        var totalPostgresHits = outcomes.Sum(outcome => outcome.PostgreSqlCount);
        var totalTypesenseHits = outcomes.Sum(outcome => outcome.TypesenseCount);
        var postgresSourceHits = outcomes.Count(outcome => outcome.PostgreSqlContainsSource);
        var typesenseSourceHits = outcomes.Count(outcome => outcome.TypesenseSourceRank != null);
        var typesenseMrr = outcomes.Average(outcome => outcome.TypesenseSourceRank is { } rank ? 1d / rank : 0d);

        output.WriteLine(
            $"Dataset: {csvPath}; books: {dataset.BookCount}; general operations: {TotalOperations}; parallelism: {parallelism}");
        output.WriteLine(
            $"PostgreSQL search stage: p50={Percentile(postgresDurations, 0.50):F2} ms; p95={Percentile(postgresDurations, 0.95):F2} ms; p99={Percentile(postgresDurations, 0.99):F2} ms");
        output.WriteLine(
            $"Typesense search stage: p50={Percentile(typesenseDurations, 0.50):F2} ms; p95={Percentile(typesenseDurations, 0.95):F2} ms; p99={Percentile(typesenseDurations, 0.99):F2} ms");
        output.WriteLine(
            $"Exact ID-set matches: {exactSetMatches}/{TotalOperations}; PostgreSQL hits: {totalPostgresHits}; Typesense hits: {totalTypesenseHits}; wall-clock: {elapsed.Elapsed.TotalSeconds:F2} s");
        output.WriteLine("Known-source retrieval (source book chosen before randomizing its searchable value):");
        output.WriteLine($"all: PostgreSQL source recall@{PageSize}={postgresSourceHits}/{TotalOperations}; " +
                         $"Typesense source recall@{PageSize}={typesenseSourceHits}/{TotalOperations}; Typesense MRR@{PageSize}={typesenseMrr:F4}");
        foreach (var group in outcomes.GroupBy(outcome => outcome.Field)
                     .OrderBy(group => group.Key, StringComparer.Ordinal))
        {
            var count = group.Count();
            var postgresGroupSourceHits = group.Count(outcome => outcome.PostgreSqlContainsSource);
            var typesenseGroupSourceHits = group.Count(outcome => outcome.TypesenseSourceRank != null);
            var typesenseGroupMrr = group.Average(outcome => outcome.TypesenseSourceRank is { } rank ? 1d / rank : 0d);
            output.WriteLine(
                $"{group.Key}: count={count}; PostgreSQL source recall@{PageSize}={postgresGroupSourceHits}/{count}; " +
                $"Typesense source recall@{PageSize}={typesenseGroupSourceHits}/{count}; Typesense MRR@{PageSize}={typesenseGroupMrr:F4}");
        }

        Assert.Equal(TotalOperations, outcomes.Count);
        Assert.NotEmpty(documents);
    }

    [Fact]
    public async Task GeneralSearch_ShouldExplainTypesenseResultSetDivergenceOnTheConfiguredDataset()
    {
        if (!string.Equals(Environment.GetEnvironmentVariable("RUN_TYPESENSE_COMPARISON"), "1",
                StringComparison.Ordinal))
        {
            return;
        }

        var csvPath = GetRequiredEnvironmentVariable("SEARCH_BENCHMARK_CSV");
        var endpoint = GetRequiredEnvironmentVariable("TYPESENSE_COMPARISON_URL");
        var apiKey = GetRequiredEnvironmentVariable("TYPESENSE_COMPARISON_API_KEY");

        await fixture.ResetDatabaseAsync();
        var ownerId = Guid.NewGuid();
        await using var seedContext = fixture.CreateContext(ownerId);
        await AddUserAsync(seedContext, ownerId);
        var dataset = await BookCsvDatasetSeeder.SeedAsync(
            seedContext,
            ownerId,
            csvPath: csvPath,
            profile: BookCsvSeedProfile.PreserveSource);
        await RefreshSearchIndexAsync(seedContext, ownerId);
        var documents = await seedContext.Books
            .AsNoTracking()
            .Where(book => book.OwnerId == ownerId)
            .Select(book => new TypesenseDocument(book.Id.ToString(), book.SearchDocument))
            .ToArrayAsync();

        using var client = CreateClient(endpoint, apiKey);
        await RecreateCollectionAsync(client, documents);
        var outcomes = new ConcurrentBag<FullSetComparisonOutcome>();
        var workload = CreateGeneralWorkload(dataset.Samples, FullSetAnalysisOperations);

        await Parallel.ForEachAsync(
            workload,
            new ParallelOptions { MaxDegreeOfParallelism = GetParallelism() },
            async (workItem, cancellationToken) =>
            {
                await using var context = fixture.CreateContext(ownerId);
                var criteria = BookSearchQueryParser.Parse(EncodeForQueryGrammar(workItem.Query));
                var postgresIds = await new BookSearchCriteriaApplier(context)
                    .Apply(context.Books.AsNoTracking().Where(book => book.OwnerId == ownerId), criteria)
                    .Select(book => book.Id.ToString())
                    .ToArrayAsync(cancellationToken);
                var typesenseIds = await SearchTypesenseAllAsync(client, workItem.Query, cancellationToken);
                var postgresSet = postgresIds.ToHashSet(StringComparer.Ordinal);
                var typesenseSet = typesenseIds.ToHashSet(StringComparer.Ordinal);
                var sourceBookId = workItem.SourceBookId.ToString();

                outcomes.Add(new FullSetComparisonOutcome(
                    workItem.Field,
                    workItem.Query,
                    postgresSet.Count,
                    typesenseSet.Count,
                    postgresSet.Intersect(typesenseSet, StringComparer.Ordinal).Count(),
                    postgresSet.Contains(sourceBookId),
                    typesenseSet.Contains(sourceBookId),
                    typesenseIds.Take(PageSize).Contains(sourceBookId, StringComparer.Ordinal)));
            });

        var ordered = outcomes.OrderBy(outcome => outcome.Field, StringComparer.Ordinal)
            .ThenBy(outcome => outcome.Query, StringComparer.Ordinal).ToArray();
        var intersection = ordered.Sum(outcome => outcome.IntersectionCount);
        var postgresTotal = ordered.Sum(outcome => outcome.PostgreSqlCount);
        var typesenseTotal = ordered.Sum(outcome => outcome.TypesenseCount);
        var exactMatches = ordered.Count(outcome => outcome.PostgreSqlCount == outcome.TypesenseCount &&
                                                    outcome.IntersectionCount == outcome.PostgreSqlCount);
        var sourceMissingFromTypesense =
            ordered.Count(outcome => outcome.PostgreSqlContainsSource && !outcome.TypesenseContainsSource);
        var sourceBelowTypesensePage =
            ordered.Count(outcome => outcome.TypesenseContainsSource && !outcome.TypesenseSourceOnFirstPage);

        output.WriteLine(
            $"Full-set divergence: {FullSetAnalysisOperations} queries, {dataset.BookCount} books, page size={PageSize}");
        output.WriteLine(
            $"Exact full result sets: {exactMatches}/{FullSetAnalysisOperations}; shared IDs={intersection}; " +
            $"Typesense precision vs PostgreSQL={Ratio(intersection, typesenseTotal):P2}; " +
            $"Typesense recall vs PostgreSQL={Ratio(intersection, postgresTotal):P2}");
        output.WriteLine(
            $"Known source present in PostgreSQL but absent from all Typesense pages: {sourceMissingFromTypesense}/{FullSetAnalysisOperations}; " +
            $"known source present in Typesense but below its first page: {sourceBelowTypesensePage}/{FullSetAnalysisOperations}");
        foreach (var group in ordered.GroupBy(outcome => outcome.Field))
        {
            var groupIntersection = group.Sum(outcome => outcome.IntersectionCount);
            var groupPostgresTotal = group.Sum(outcome => outcome.PostgreSqlCount);
            var groupTypesenseTotal = group.Sum(outcome => outcome.TypesenseCount);
            var missingSource =
                group.Count(outcome => outcome.PostgreSqlContainsSource && !outcome.TypesenseContainsSource);
            output.WriteLine($"{group.Key}: precision={Ratio(groupIntersection, groupTypesenseTotal):P2}; " +
                             $"recall={Ratio(groupIntersection, groupPostgresTotal):P2}; source missing={missingSource}/{group.Count()}");
        }

        Assert.Equal(FullSetAnalysisOperations, outcomes.Count);
    }

    private static HttpClient CreateClient(string endpoint, string apiKey)
    {
        var baseAddress = new Uri(endpoint.TrimEnd('/') + "/", UriKind.Absolute);
        var client = new HttpClient { BaseAddress = baseAddress };
        client.DefaultRequestHeaders.Add("X-TYPESENSE-API-KEY", apiKey);
        return client;
    }

    private static async Task RecreateCollectionAsync(HttpClient client,
        IReadOnlyCollection<TypesenseDocument> documents)
    {
        using var deleteResponse = await client.DeleteAsync($"collections/{CollectionName}");
        if (deleteResponse.StatusCode != HttpStatusCode.NotFound)
        {
            deleteResponse.EnsureSuccessStatusCode();
        }

        var schema = new TypesenseCollection(
            CollectionName,
            [new TypesenseField("document", "string")]);
        using var createResponse = await client.PostAsJsonAsync("collections", schema, JsonOptions);
        createResponse.EnsureSuccessStatusCode();

        var jsonLines = string.Join('\n',
            documents.Select(document => JsonSerializer.Serialize(document, JsonOptions)));
        using var content = new StringContent(jsonLines, Encoding.UTF8, "text/plain");
        using var importResponse = await client.PostAsync(
            $"collections/{CollectionName}/documents/import?action=upsert",
            content);
        importResponse.EnsureSuccessStatusCode();
        var importLines = (await importResponse.Content.ReadAsStringAsync())
            .Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        Assert.Equal(documents.Count, importLines.Length);
        Assert.All(importLines, line =>
            Assert.True(JsonDocument.Parse(line).RootElement.GetProperty("success").GetBoolean(), line));
    }

    private static async Task<TypesenseSearchResponse> SearchTypesenseAsync(
        HttpClient client,
        string query,
        CancellationToken cancellationToken,
        int page = 1)
    {
        var requestUri = $"collections/{CollectionName}/documents/search?q={Uri.EscapeDataString(query)}" +
                         $"&query_by=document&prefix=false&drop_tokens_threshold=0&typo_tokens_threshold=0&num_typos=1&per_page={PageSize}&page={page}";
        var response =
            await client.GetFromJsonAsync<TypesenseSearchResponse>(requestUri, JsonOptions, cancellationToken);
        return Assert.IsType<TypesenseSearchResponse>(response);
    }

    private static async Task<IReadOnlyList<string>> SearchTypesenseAllAsync(
        HttpClient client,
        string query,
        CancellationToken cancellationToken)
    {
        var firstPage = await SearchTypesenseAsync(client, query, cancellationToken);
        var ids = firstPage.Hits.Select(hit => hit.Document.Id).ToList();
        for (var page = 2; ids.Count < firstPage.Found; page++)
        {
            var response = await SearchTypesenseAsync(client, query, cancellationToken, page);
            if (response.Hits.Count == 0)
            {
                break;
            }

            ids.AddRange(response.Hits.Select(hit => hit.Document.Id));
        }

        return ids;
    }

    private static IReadOnlyList<GeneralSearchWorkItem> CreateGeneralWorkload(
        IReadOnlyList<BookCsvDatasetSample> samples,
        int operationCount = TotalOperations)
    {
        Assert.NotEmpty(samples);
        var random = new Random(20260820);
        var workload = new GeneralSearchWorkItem[operationCount];
        for (var index = 0; index < workload.Length; index++)
        {
            var sample = samples[random.Next(samples.Count)];
            var candidates = new List<(string Field, string Value)>
            {
                ("title", sample.PrimaryTitle), ("type", sample.ContentType), ("status", sample.Status)
            };
            if (!string.IsNullOrWhiteSpace(sample.Author))
            {
                candidates.Add(("author", sample.Author));
            }

            candidates.AddRange(sample.Genres.Select(genre => ("genre", genre)));
            candidates.AddRange(sample.Tags.Select(tag => ("tag", tag)));
            var candidate = candidates[random.Next(candidates.Count)];
            workload[index] = new GeneralSearchWorkItem(
                sample.Id,
                candidate.Field,
                RandomizeTerm(candidate.Value, random));
        }

        return workload;
    }

    private static string RandomizeTerm(string value, Random random)
    {
        // The generated workload feeds the application's query grammar. Quotes are grammar delimiters,
        // so retain the searchable text while removing unescaped delimiters from imported metadata.
        value = value.Replace("\"", string.Empty, StringComparison.Ordinal)
            .Replace("'", string.Empty, StringComparison.Ordinal)
            .Trim();
        if (value.Length > 6 && random.NextDouble() < 0.20)
        {
            var start = random.Next(value.Length - 4);
            var end = random.Next(start + 4, value.Length + 1);
            value = value[start..end];
        }

        return random.NextDouble() switch
        {
            < 0.15 => value.ToLowerInvariant(),
            < 0.30 => value.ToUpperInvariant(),
            _ => value
        };
    }

    private static string EncodeForQueryGrammar(string value)
    {
        return value.Any(char.IsWhiteSpace) ? $"\"{value}\"" : value;
    }

    private static int GetParallelism()
    {
        return int.TryParse(Environment.GetEnvironmentVariable("SEARCH_SYSTEM_PARALLELISM"), out var value)
            ? Math.Clamp(value, 1, 64)
            : DefaultParallelism;
    }

    private static string GetRequiredEnvironmentVariable(string name)
    {
        return Environment.GetEnvironmentVariable(name) is { Length: > 0 } value
            ? value
            : throw new InvalidOperationException($"{name} must be set for the Typesense comparison.");
    }

    private static async Task RefreshSearchIndexAsync(ApplicationDbContext context, Guid ownerId)
    {
        var bookIds = await context.Books
            .Where(book => book.OwnerId == ownerId)
            .Select(book => book.Id)
            .ToArrayAsync();
        foreach (var bookId in bookIds)
        {
            await context.Database.ExecuteSqlInterpolatedAsync($"SELECT refresh_book_search_index({bookId})");
        }
    }

    private static async Task AddUserAsync(ApplicationDbContext context, Guid ownerId)
    {
        context.Users.Add(new User
        {
            Id = ownerId,
            UserName = $"reader-{ownerId:N}",
            NormalizedUserName = $"READER-{ownerId:N}",
            Email = $"{ownerId:N}@example.com",
            NormalizedEmail = $"{ownerId:N}@example.com"
        });
        await context.SaveChangesAsync();
    }

    private static double Percentile(IReadOnlyList<double> sorted, double percentile)
    {
        return sorted[(int)Math.Ceiling(percentile * sorted.Count) - 1];
    }

    private static double Ratio(int numerator, int denominator)
    {
        return denominator == 0 ? 1 : (double)numerator / denominator;
    }

    private static int? GetRank(IReadOnlyList<string> ids, string sourceBookId)
    {
        for (var index = 0; index < ids.Count; index++)
        {
            if (string.Equals(ids[index], sourceBookId, StringComparison.Ordinal))
            {
                return index + 1;
            }
        }

        return null;
    }

    private sealed record TypesenseField(string Name, string Type);

    private sealed record TypesenseCollection(string Name, IReadOnlyList<TypesenseField> Fields);

    private sealed record TypesenseDocument(string Id, string Document);

    private sealed record TypesenseHit(TypesenseDocument Document);

    private sealed record TypesenseSearchResponse(int Found, IReadOnlyList<TypesenseHit> Hits);

    private sealed record GeneralSearchWorkItem(Guid SourceBookId, string Field, string Query);

    private sealed record ComparisonOutcome(
        string Field,
        string Query,
        double PostgreSqlDuration,
        double TypesenseDuration,
        bool SameIds,
        int PostgreSqlCount,
        int TypesenseCount,
        bool PostgreSqlContainsSource,
        int? TypesenseSourceRank);

    private sealed record FullSetComparisonOutcome(
        string Field,
        string Query,
        int PostgreSqlCount,
        int TypesenseCount,
        int IntersectionCount,
        bool PostgreSqlContainsSource,
        bool TypesenseContainsSource,
        bool TypesenseSourceOnFirstPage);
}
