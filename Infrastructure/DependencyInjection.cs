namespace Infrastructure;

using Amazon.Runtime;
using Amazon.S3;
using Authentication;
using BookCovers;
using BookFiles;
using BookMetadata;
using BookSearch;
using Caching;
using Crawler;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.IdentityModel.Tokens;
using Services;

public static class DependencyInjection
{
    private const string JwtSection = "Jwt";
    private const string JwtKey = "Key";
    private const string JwtIssuer = "Issuer";
    private const string JwtAudience = "Audience";
    private const string DatabaseConnectionString = "DB";
    private const string RedisConnectionString = "Redis";
    private const string BookCoversSection = "BookCovers";
    private const string BookCoverS3Section = "BookCovers:S3";
    private const string DefaultS3Region = "garage";

    public static void AddInfrastructureServices(this IHostApplicationBuilder builder)
    {
        var jwtSettings = builder.Configuration.GetSection(JwtSection);

        var keyString = jwtSettings[JwtKey];
        if (keyString == null)
        {
            throw new ArgumentNullException(nameof(keyString));
        }

        var key = Encoding.UTF8.GetBytes(keyString);

        var connectionString = builder.Configuration.GetConnectionString(DatabaseConnectionString);
        var bookSearchConnectionString = BookSearchConnectionSettings.Apply(connectionString);
        var redisConnectionString = builder.Configuration.GetConnectionString(RedisConnectionString);
        builder.Services.AddDbContext<ApplicationDbContext>(options =>
        {
            options.UseNpgsql(bookSearchConnectionString,
                npgsqlOptions => { npgsqlOptions.UseQuerySplittingBehavior(QuerySplittingBehavior.SplitQuery); });
        });
        builder.Services.AddDistributedMemoryCache();
        if (!string.IsNullOrWhiteSpace(redisConnectionString))
        {
            builder.Services.AddStackExchangeRedisCache(options => { options.Configuration = redisConnectionString; });
        }

        builder.Services.AddScoped<IBookRepository, BookRepository>();
        builder.Services.AddScoped<BookSearchCriteriaApplier>();
        builder.Services.AddScoped<BookSortBuilder>();
        builder.Services.AddScoped<BookListProjectionQuery>();
        builder.Services.AddScoped<IBookListQueryService, BookReadQueryService>();
        builder.Services.AddScoped<IBookSearchSuggestionQueryService, BookSearchSuggestionQueryService>();
        builder.Services.AddScoped<IBookExportQueryService, BookExportQueryService>();
        builder.Services.AddScoped<IBookSummaryQueryService, BookSummaryQueryService>();
        builder.Services.AddScoped<IBookAnalyticsQueryService, BookAnalyticsQueryService>();
        builder.Services.AddScoped<IAuthorRepository, AuthorRepository>();
        builder.Services.AddScoped<IAuthorLifecycleService, AuthorLifecycleService>();
        builder.Services.AddScoped<IGenreRepository, GenreRepository>();
        builder.Services.AddScoped<IStatusRepository, StatusRepository>();
        builder.Services.AddScoped<ITypeRepository, TypeRepository>();
        builder.Services.AddScoped<ITagRepository, TagRepository>();
        builder.Services.AddScoped<IBookCoverRepository, BookCoverRepository>();
        builder.Services.AddScoped<IReadingTimeSettingRepository, ReadingTimeSettingRepository>();
        builder.Services.AddScoped<BookListCache>();
        builder.Services.AddScoped<IBookListCache>(provider => provider.GetRequiredService<BookListCache>());
        builder.Services.AddScoped<IBookListCacheInvalidator>(provider => provider.GetRequiredService<BookListCache>());
        builder.Services.AddScoped<IBookCsvImportService, BookCsvImportService>();
        builder.Services.AddScoped<IBookHtmlParser, BookHtmlParser>();
        builder.Services.AddScoped<IBookHtmlResolver, NovelUpdatesHtmlResolver>();
        builder.Services.AddScoped<IBookHtmlResolver, RoyalRoadHtmlResolver>();
        builder.Services.AddScoped<IBookHtmlResolver, ScribbleHubHtmlResolver>();
        builder.Services.AddScoped<IBookHtmlResolver, WebNovelHtmlResolver>();
        builder.Services.AddScoped<IBookHtmlResolver, AnimePlanetHtmlResolver>();
        builder.Services.AddScoped<IBookHtmlResolver, MangaUpdatesHtmlResolver>();
        builder.Services.AddScoped<IBookHtmlResolver, RanobeDbHtmlResolver>();
        builder.Services.AddScoped<IBookHtmlResolver, WuxiaWorldHtmlResolver>();
        builder.Services.AddScoped<IBookHtmlResolver, AniListHtmlResolver>();
        builder.Services.AddScoped<IBookHtmlResolver, JNovelClubHtmlResolver>();
        builder.Services.AddScoped<IBookHtmlResolver, SevenSeasHtmlResolver>();
        builder.Services.AddScoped<IBookHtmlResolver, YenPressHtmlResolver>();
        builder.Services.AddScoped<IBookHtmlResolver, SyosetuHtmlResolver>();
        builder.Services.AddScoped<IBookHtmlResolver, KakuyomuHtmlResolver>();
        builder.Services.AddOptions<BookImportSecurityOptions>()
            .Bind(builder.Configuration.GetSection(BookImportSecurityOptions.SectionName))
            .Validate(options => options.MaxFullBackupRequestBytes > 0 &&
                                 options.AdminMaxFullBackupRequestBytes >= options.MaxFullBackupRequestBytes &&
                                 options.MaxArchiveEntries > 0 &&
                                 options.MaxCsvRows > 0 &&
                                 options.MaxManifestBooks > 0 &&
                                 options.MaxCsvBytes > 0 &&
                                 options.MaxManifestBytes > 0 &&
                                 options.MaxCoverBytes > 0 &&
                                 options.MaxUncompressedArchiveBytes > 0 &&
                                 options.AdminMaxUncompressedArchiveBytes >= options.MaxUncompressedArchiveBytes &&
                                 options.MaxCompressionRatio >= 1 &&
                                 options.SuspiciousCompressionRatio > options.MaxCompressionRatio &&
                                 options.SuspiciousCompressionMinimumBytes > 0 &&
                                 options.SuspiciousCompressionMinimumBytes <= options.MaxUncompressedArchiveBytes &&
                                 options.SuspiciousAccountBlockDuration > TimeSpan.Zero &&
                                 options.MaxConcurrentFullImportOperations > 0 &&
                                 options.MaxActiveSessionsGlobal > 0 &&
                                 options.MaxActiveSessionsPerUser > 0 &&
                                 options.MaxActiveFullSessionsGlobal > 0 &&
                                 options.MaxActiveFullSessionsPerUser > 0 &&
                                 options.MaxActiveFullSessionsGlobal <= options.MaxActiveSessionsGlobal &&
                                 options.MaxActiveFullSessionsPerUser <= options.MaxActiveSessionsPerUser &&
                                 options.MaxStagedBytesGlobal >= options.AdminMaxUncompressedArchiveBytes &&
                                 options.SessionIdleTimeout > TimeSpan.Zero &&
                                 options.SessionAbsoluteLifetime >= options.SessionIdleTimeout &&
                                 options.CleanupInterval > TimeSpan.Zero &&
                                 options.DraftProcessingTimeout > TimeSpan.Zero &&
                                 options.FinalizeProcessingTimeout > TimeSpan.Zero,
                "Book import security limits are invalid.")
            .ValidateOnStart();
        builder.Services.AddSingleton<BookImportSessionStore>();
        builder.Services.AddSingleton<BookImportConcurrencyGate>();
        builder.Services.AddSingleton<AccountAbuseGuard>();
        builder.Services.AddHostedService<BookImportSessionCleanupService>();
        builder.Services.AddScoped<IAdminLibraryService, AdminLibraryService>();
        builder.Services.AddScoped<IGlobalTagService, GlobalTagService>();
        builder.Services.AddScoped<MetadataSimilarityReconciler>();
        builder.Services.AddScoped<IMetadataPolicy, MetadataPolicy>();
        builder.Services.AddScoped<IPublicBookService, PublicBookService>();
        builder.Services.AddScoped<IStorageCleanupQueue, StorageCleanupQueue>();
        builder.Services.AddScoped<StorageCleanupQueueProcessor>();
        builder.Services.AddSingleton(TimeProvider.System);
        builder.Services.AddHostedService<StorageCleanupBackgroundService>();
        builder.Services.AddScoped<BookSearchIndexUpdater>();
        builder.Services.AddScoped<BookSearchIndexQueueProcessor>();
        builder.Services.AddHostedService<BookSearchIndexBackgroundService>();
        builder.Services.AddScoped<IAdminAccountService, AdminAccountService>();

        builder.Services.AddOptions<BookCoverOptions>()
            .Bind(builder.Configuration.GetSection(BookCoversSection))
            .Validate(options => options.MaxBytes > 0 && options.MaxWidth > 0 && options.MaxHeight > 0 &&
                                 options.MaxPixels > 0 &&
                                 options.MaxPixels <= (long)options.MaxWidth * options.MaxHeight,
                "Book cover security limits are invalid.")
            .ValidateOnStart();
        var s3Options = builder.Configuration.GetSection(BookCoverS3Section).Get<BookCoverS3Options>();
        if (!string.IsNullOrWhiteSpace(s3Options?.Endpoint) &&
            !string.IsNullOrWhiteSpace(s3Options.AccessKey) &&
            !string.IsNullOrWhiteSpace(s3Options.SecretKey) &&
            !string.IsNullOrWhiteSpace(s3Options.Bucket))
        {
            builder.Services.AddSingleton<IAmazonS3>(_ =>
            {
                var credentials = new BasicAWSCredentials(s3Options.AccessKey, s3Options.SecretKey);
                var config = new AmazonS3Config
                {
                    ServiceURL = s3Options.Endpoint,
                    ForcePathStyle = true,
                    AuthenticationRegion = string.IsNullOrWhiteSpace(s3Options.Region)
                        ? DefaultS3Region
                        : s3Options.Region
                };
                return new AmazonS3Client(credentials, config);
            });
            builder.Services.AddScoped<IBookCoverStorage, S3BookCoverStorage>();
            builder.Services.AddScoped<IBookFileStorage, S3BookFileStorage>();
        }
        else
        {
            builder.Services.AddScoped<IBookCoverStorage, LocalBookCoverStorage>();
            builder.Services.AddScoped<IBookFileStorage, LocalBookFileStorage>();
        }

        builder.Services.AddOptions<BookFileOptions>()
            .Bind(builder.Configuration.GetSection(BookFileOptions.SectionName))
            .Validate(o => o.MaxFileBytes > 0 && o.MaxUploadBytes >= o.MaxFileBytes &&
                           o.MaxExtractedBytes >= o.MaxFileBytes &&
                           o.MaxExpandedEpubBytes > 0 && o.MaxOwnerStorageBytes >= o.MaxFileBytes &&
                           o.MaxLibraryArchiveBytes >= o.MaxFileBytes &&
                           o.MaxStagingBytes >= 2 * o.MaxLibraryArchiveBytes && o.MaxConcurrentOperations > 0 &&
                           o.MaxFilesPerImport > 0 &&
                           o.MaxArchiveEntries > 0 && o.MaxLibraryArchiveEntries > 0 && o.MaxActiveJobsPerOwner > 0 &&
                           o.ProcessingTimeout > TimeSpan.Zero && o.JobLifetime > o.ProcessingTimeout &&
                           o.Retention > TimeSpan.Zero &&
                           o.TicketLifetime > TimeSpan.Zero && !string.IsNullOrWhiteSpace(o.StagingRoot) &&
                           !string.IsNullOrWhiteSpace(o.StorageRoot),
                "EPUB storage limits are invalid.").ValidateOnStart();
        builder.Services.AddScoped<BookFileService>();
        builder.Services.AddScoped<IBookFileService>(p => p.GetRequiredService<BookFileService>());
        builder.Services.AddHostedService<BookFileBackgroundService>();
        builder.Services.AddOptions<CrawlerOptions>().Bind(builder.Configuration.GetSection("Crawler"))
            .Validate(o => !o.Enabled || o.ApiKey.Length >= 32 && Uri.TryCreate(o.BaseUrl, UriKind.Absolute, out _) &&
                o.MaxConcurrentDownloads > 0 && o.MaxActiveJobsPerOwner > 0 && o.JobLifetime > TimeSpan.Zero &&
                o.MinScanHours >= 1 && o.MaxScanHours >= o.MinScanHours, "Crawler configuration is invalid.")
            .ValidateOnStart();
        builder.Services.AddHttpClient<ICrawlerClient, CrawlerClient>((sp, client) =>
        {
            client.BaseAddress = new Uri(sp.GetRequiredService<Microsoft.Extensions.Options.IOptions<CrawlerOptions>>().Value.BaseUrl.TrimEnd('/') + "/");
            client.Timeout = TimeSpan.FromSeconds(60);
        });
        builder.Services.AddScoped<IEpubCrawlerService, EpubCrawlerService>();
        builder.Services.AddScoped<ICrawlerMonitorService, CrawlerMonitorService>();
        builder.Services.AddScoped<ICrawlerSourceAdminService, CrawlerSourceAdminService>();
        builder.Services.AddScoped<CrawlerWorker>();
        builder.Services.AddHostedService<CrawlerBackgroundService>();

        builder.Services.AddScoped<IBookCoverRemoteImageService, BookCoverRemoteImageService>();
        builder.Services.AddSingleton<IBookCoverOperationGate, BookCoverOperationGate>();
        builder.Services.AddSingleton<InMemoryBookCoverQueue>();
        builder.Services.AddSingleton<IBookCoverQueue>(provider =>
            provider.GetRequiredService<InMemoryBookCoverQueue>());
        builder.Services.AddScoped<BookCoverResolver>();
        builder.Services.AddScoped<BookCoverProcessor>();
        builder.Services.AddHostedService<BookCoverBackgroundService>();
        builder.Services.AddHttpClient<IBookCoverProvider, BookLinkMetadataCoverProvider>(client =>
        {
            client.DefaultRequestHeaders.UserAgent.ParseAdd(BookCoverOptions.DefaultUserAgent);
        });
        builder.Services.AddHttpClient<IBookCoverProvider, AniListBookCoverProvider>(client =>
        {
            client.BaseAddress = new Uri("https://graphql.anilist.co");
            client.DefaultRequestHeaders.UserAgent.ParseAdd(BookCoverOptions.DefaultUserAgent);
        });
        builder.Services.AddHttpClient<IBookCoverProvider, JikanBookCoverProvider>(client =>
        {
            client.BaseAddress = new Uri("https://api.jikan.moe");
            client.DefaultRequestHeaders.UserAgent.ParseAdd(BookCoverOptions.DefaultUserAgent);
        });
        builder.Services.AddHttpClient<IBookCoverProvider, GoogleBooksCoverProvider>(client =>
        {
            client.BaseAddress = new Uri("https://www.googleapis.com");
            client.DefaultRequestHeaders.UserAgent.ParseAdd(BookCoverOptions.DefaultUserAgent);
        });
        builder.Services.AddHttpClient<IBookCoverProvider, OpenLibraryCoverProvider>(client =>
        {
            client.BaseAddress = new Uri("https://openlibrary.org");
            client.DefaultRequestHeaders.UserAgent.ParseAdd(BookCoverOptions.DefaultUserAgent);
        });
        builder.Services.AddHttpClient<IBookCoverProvider, WikidataCoverProvider>(client =>
        {
            client.BaseAddress = new Uri("https://query.wikidata.org");
            client.DefaultRequestHeaders.UserAgent.ParseAdd(BookCoverOptions.DefaultUserAgent);
        });
        builder.Services.AddHttpClient(BookCoverHttpClients.Images,
                client => { client.DefaultRequestHeaders.UserAgent.ParseAdd(BookCoverOptions.DefaultUserAgent); })
            .ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler { AllowAutoRedirect = false });

        builder.Services.AddHttpContextAccessor();
        builder.Services.AddScoped<IUser, CurrentUser>();

        builder.Services.Configure<JwtSettings>(
            builder.Configuration.GetSection(JwtSection));
        builder.Services.AddScoped<IJwtTokenGenerator, JwtTokenGenerator>();

        builder.Services.AddScoped<IIdentityService, IdentityService>();
        builder.Services.AddHostedService<AdminRoleSeeder>();
        builder.Services.AddIdentity<User, IdentityRole<Guid>>(options =>
            {
                options.Password.RequireDigit = true;
                options.Password.RequireLowercase = true;
                options.Password.RequireUppercase = true;
                options.Password.RequireNonAlphanumeric = true;
                options.Password.RequiredLength = 8;
            })
            .AddEntityFrameworkStores<ApplicationDbContext>()
            .AddDefaultTokenProviders();

        builder.Services.AddAuthentication(options =>
            {
                options.DefaultAuthenticateScheme = JwtBearerDefaults.AuthenticationScheme;
                options.DefaultChallengeScheme = JwtBearerDefaults.AuthenticationScheme;
            })
            .AddJwtBearer(options =>
            {
                options.TokenValidationParameters = new TokenValidationParameters
                {
                    ValidateIssuer = true,
                    ValidateAudience = true,
                    ValidateLifetime = true,
                    ValidateIssuerSigningKey = true,
                    ValidIssuer = jwtSettings[JwtIssuer],
                    ValidAudience = jwtSettings[JwtAudience],
                    IssuerSigningKey = new SymmetricSecurityKey(key),
                    ClockSkew = TimeSpan.Zero
                };
            });

        builder.Services.AddAuthorization();
    }
}
