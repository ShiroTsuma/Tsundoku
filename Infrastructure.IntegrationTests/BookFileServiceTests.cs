namespace Infrastructure.IntegrationTests;

using System.IO.Compression;
using System.Net;
using System.Runtime.CompilerServices;
using System.Security.Claims;
using System.Text;
using System.Text.Encodings.Web;
using System.Threading.RateLimiting;
using Api.Controllers;
using Application.Common.DTOs.Book;
using Application.Common.Interfaces;
using BookCovers;
using BookFiles;
using Contexts;
using Domain.Entities;
using Domain.Exceptions;
using FluentValidation;
using Identity;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Distributed;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Services;
using TestSupport;

public sealed class BookFileServiceTests
{
    [Theory]
    [InlineData(false, "Volume 2")]
    [InlineData(true, "Volume 2")]
    [InlineData(false, "Volume 2: The Awakening")]
    [InlineData(true, "Book One")]
    public async Task ContentsLabels_PreserveFirstAndLastTocEntries_WithoutGuessingNumbers(bool legacy,
        string containerLabel)
    {
        using var h = new Harness();
        var book = await h.AddBook("Contents");
        var nav = legacy
            ? "<ncx xmlns='http://www.daisy.org/z3986/2005/ncx/'><navMap><navPoint><navLabel><text>Front Page</text></navLabel><content src='chapter.xhtml'/></navPoint><navPoint><navLabel><text>Volume 2</text></navLabel><navPoint><navLabel><text>V2C100</text></navLabel><content src='chapter.xhtml#one'/></navPoint><navPoint><navLabel><text>V5C7: Afterword</text></navLabel><content src='chapter.xhtml#two'/></navPoint></navPoint></navMap></ncx>"
            : "<html xmlns='http://www.w3.org/1999/xhtml' xmlns:epub='http://www.idpf.org/2007/ops'><body><nav epub:type='toc'><ol><li><a href='chapter.xhtml'>Front Page</a></li><li><a href='chapter.xhtml'>Volume 2</a><ol><li><a href='chapter.xhtml#one'>V2C100</a></li><li><a href='chapter.xhtml#two'>V5C7: Afterword</a></li></ol></li></ol></nav></body></html>";
        nav = nav.Replace("Volume 2", containerLabel);
        await h.Import(book.Id, Epub("Contents", navigation: nav, legacy: legacy));
        var file = Assert.Single((await h.Service.ListAsync(book.Id, default)).Files);
        Assert.Equal("V2C100", file.FirstContentLabel);
        Assert.Equal("V5C7: Afterword", file.LastContentLabel);
    }

    [Fact]
    public async Task MissingToc_DoesNotInventAContentsRange()
    {
        using var h = new Harness();
        var book = await h.AddBook("No TOC");
        await h.Import(book.Id, Epub("No TOC"));
        var file = Assert.Single((await h.Service.ListAsync(book.Id, default)).Files);
        Assert.Null(file.FirstContentLabel);
        Assert.Null(file.LastContentLabel);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task ContentsLabels_ResolveNestedRelativePaths_AndKeepChaptersWithSubsections(bool legacy)
    {
        using var h = new Harness();
        var book = await h.AddBook("Nested TOC");
        var nav = legacy
            ? "<ncx xmlns='http://www.daisy.org/z3986/2005/ncx/'><navMap><navPoint><navLabel><text>Chapter 10</text></navLabel><content src='../chapter.xhtml#one'/><navPoint><navLabel><text>Section A</text></navLabel><content src='../chapter.xhtml#a'/></navPoint></navPoint><navPoint><navLabel><text>Chapter 2</text></navLabel><content src='.././chapter.xhtml#two'/><navPoint><navLabel><text>Section Z</text></navLabel><content src='../chapter.xhtml#z'/></navPoint></navPoint></navMap></ncx>"
            : "<html xmlns='http://www.w3.org/1999/xhtml' xmlns:epub='http://www.idpf.org/2007/ops'><body><nav epub:type='toc'><ol><li><a href='../chapter.xhtml#one'>Chapter 10</a><ol><li><a href='../chapter.xhtml#a'>Section A</a></li></ol></li><li><a href='.././chapter.xhtml#two'>Chapter 2</a><ol><li><a href='../chapter.xhtml#z'>Section Z</a></li></ol></li></ol></nav></body></html>";
        await h.Import(book.Id,
            Epub("Nested TOC", navigation: nav, legacy: legacy,
                navigationPath: legacy ? "nav/toc.ncx" : "nav/toc.xhtml"));
        var file = Assert.Single((await h.Service.ListAsync(book.Id, default)).Files);
        Assert.Equal("Chapter 10", file.FirstContentLabel);
        Assert.Equal("Chapter 2", file.LastContentLabel);
    }

    [Fact]
    public async Task MultipartEndpoint_StreamsWithoutMvcFormBuffering()
    {
        using var h = new Harness();
        var book = await h.AddBook("Streamed EPUB");
        using var host = await new HostBuilder().ConfigureWebHost(web => web.UseTestServer()
            .ConfigureServices(services =>
            {
                services.AddControllers().AddApplicationPart(typeof(BookFilesController).Assembly);
                services.AddSingleton<IBookFileService>(h.Service);
                services.AddSingleton(h.FileOptions);
                services.Configure<FormOptions>(o => o.MultipartBodyLengthLimit = 16);
                services.AddAuthentication("epub-tests")
                    .AddScheme<AuthenticationSchemeOptions, EndpointAuthentication>("epub-tests", _ => { });
                services.AddAuthorization();
                services.AddRateLimiter(o =>
                {
                    o.AddPolicy("expensive-user-action", _ => RateLimitPartition.GetNoLimiter("test"));
                    o.AddPolicy("full-backup", _ => RateLimitPartition.GetNoLimiter("test"));
                });
            }).Configure(app =>
            {
                app.UseRouting();
                app.UseAuthentication();
                app.UseAuthorization();
                app.UseRateLimiter();
                app.UseEndpoints(endpoints => endpoints.MapControllers());
            })).StartAsync();
        using var client = host.GetTestClient();
        using var form = new MultipartFormDataContent();
        form.Add(new ByteArrayContent(Epub("Streamed title")), "files", "volume.epub");
        var response = await client.PostAsync($"/api/v1/book/{book.Id}/files/import/sessions", form);
        Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
        Assert.Single(await h.Context.BookFileJobs.ToListAsync());
    }

    [Fact]
    public async Task ZipImport_ExtractsSubfoldersInNaturalOrder_AndConfirmIsIdempotent()
    {
        using var h = new Harness();
        var book = await h.AddBook("Volumes");
        using var zip = Zip(("nested/volume10.epub", Epub("Ten")), ("nested/volume2.epub", Epub("Two")),
            ("readme.txt", Encoding.UTF8.GetBytes("ignored")));
        var job = await h.Service.CreateImportAsync(book.Id, Uploads(new BookFileUpload(zip, "volumes.zip")), default);
        Assert.True(await h.Service.ProcessNextAsync(default));
        var preview = await h.Service.GetJobAsync(job.Id, default);
        Assert.Equal("Ready", preview.Status);
        Assert.Equal(new[] { "Two", "Ten" }, preview.Entries.Select(e => e.Title));
        Assert.Single(preview.Warnings);
        var selected = Select(preview, book.Id);
        await h.Service.FinalizeAsync(job.Id, selected, default);
        await h.Service.FinalizeAsync(job.Id, selected, default);
        Assert.True(await h.Service.ProcessNextAsync(default));
        var completed = await h.Service.GetJobAsync(job.Id, default);
        Assert.Equal("Completed", completed.Status);
        Assert.Equal(2, completed.ImportedCount);
        Assert.Equal(new[] { "Two", "Ten" }, (await h.Service.ListAsync(book.Id, default)).Files.Select(f => f.Title));
        Assert.Empty(await h.Context.StorageCleanupQueueItems.ToListAsync());
    }

    [Fact]
    public async Task DuplicateContentIsSkipped_ButSameFilenameWithDifferentContentIsKept()
    {
        using var h = new Harness();
        var book = await h.AddBook("Duplicates");
        await h.Import(book.Id, Epub("Original"), "volume.epub");
        using var identical = new MemoryStream(Epub("Original"));
        var job = await h.Service.CreateImportAsync(book.Id, Uploads(new BookFileUpload(identical, "renamed.epub")),
            default);
        await h.Service.ProcessNextAsync(default);
        var preview = await h.Service.GetJobAsync(job.Id, default);
        Assert.True(Assert.Single(preview.Entries).IsDuplicate);
        await h.Service.FinalizeAsync(job.Id, Select(preview, book.Id), default);
        await h.Service.ProcessNextAsync(default);
        Assert.Equal(1, (await h.Service.GetJobAsync(job.Id, default)).SkippedCount);
        await h.Import(book.Id, Epub("Different edition"), "volume.epub");
        Assert.Equal(2, (await h.Service.ListAsync(book.Id, default)).Files.Count);
    }

    [Fact]
    public async Task PublicSharing_IsExplicit_RevocationAppliesToIssuedTickets_AndRestoreIsPrivate()
    {
        using var h = new Harness();
        var book = await h.AddBook("Shared");
        await h.Import(book.Id, Epub("Volume"));
        var file = Assert.Single((await h.Service.ListAsync(book.Id, default)).Files);
        var snapshot = await h.Snapshot(book);
        var otherId = Guid.NewGuid();
        h.Context.Users.Add(new User { Id = otherId });
        await h.Context.SaveChangesAsync();
        var reader = h.For(otherId);
        Assert.Empty(await reader.ListPublicAsync(snapshot.Id, default));
        await Assert.ThrowsAsync<EntityNotFoundException<BookFile, Guid>>(() =>
            reader.CreateDownloadsAsync([file.Id], snapshot.Id, default));
        await h.Service.ShareAsync(book.Id, [file.Id], default);
        Assert.Single(await reader.ListPublicAsync(snapshot.Id, default));
        var ticket = Assert.Single(await reader.CreateDownloadsAsync([file.Id], snapshot.Id, default));
        await h.Service.DeleteAsync(book.Id, file.Id, default);
        await Assert.ThrowsAsync<EntityNotFoundException<BookFile, Guid>>(() =>
            reader.ConsumeDownloadAsync(TicketId(ticket), Token(ticket), default));
        Assert.Empty(await reader.ListPublicAsync(snapshot.Id, default));
        await h.Service.RestoreAsync(book.Id, file.Id, default);
        Assert.False(Assert.Single((await h.Service.ListAsync(book.Id, default)).Files).IsShared);
        Assert.Empty(await reader.ListPublicAsync(snapshot.Id, default));
        Assert.Empty(await h.Context.StorageCleanupQueueItems.ToListAsync());
    }

    [Fact]
    public async Task DownloadTickets_AreSingleUse_AndCannotBypassOwnership()
    {
        using var h = new Harness();
        var book = await h.AddBook("Private");
        await h.Import(book.Id, Epub("Private"));
        var file = Assert.Single((await h.Service.ListAsync(book.Id, default)).Files);
        await Assert.ThrowsAsync<EntityNotFoundException<BookFile, Guid>>(() =>
            h.For(Guid.NewGuid()).CreateDownloadsAsync([file.Id], null, default));
        var ticket = Assert.Single(await h.Service.CreateDownloadsAsync([file.Id], null, default));
        var downloaded = await h.Service.ConsumeDownloadAsync(TicketId(ticket), Token(ticket), default);
        using (downloaded.Content)
        {
            Assert.Equal(file.SizeBytes, downloaded.Content.Length);
        }

        await Assert.ThrowsAsync<EntityNotFoundException<BookFileDownloadTicket, Guid>>(() =>
            h.Service.ConsumeDownloadAsync(TicketId(ticket), Token(ticket), default));
    }

    [Fact]
    public async Task UnlistingPublicSnapshot_RevokesPreparedZipDownload()
    {
        using var h = new Harness();
        var book = await h.AddBook("Unlist");
        await h.Import(book.Id, Epub("Volume"));
        var snapshot = await h.Snapshot(book);
        var file = Assert.Single((await h.Service.ListAsync(book.Id, default)).Files);
        await h.Service.ShareAsync(book.Id, [file.Id], default);
        var job = await h.Service.CreateExportAsync([file.Id], snapshot.Id, false, default);
        await h.Service.ProcessNextAsync(default);
        var ticket = await h.Service.CreateJobDownloadAsync(job.Id, default);
        await h.Context.PublicBookSnapshots.Where(s => s.Id == snapshot.Id).ExecuteDeleteAsync();
        await Assert.ThrowsAsync<EntityNotFoundException<BookFile, Guid>>(() =>
            h.Service.ConsumeDownloadAsync(TicketId(ticket), Token(ticket), default));
    }

    [Fact]
    public async Task EpubArchive_RoundTripsTitlesAndOrder_AndMatchesBooksAfterIdsChange()
    {
        using var h = new Harness();
        var book = await h.AddBook("Restore me");
        await h.Import(book.Id, Epub("Ten"), "10.epub");
        await h.Import(book.Id, Epub("Two"), "2.epub");
        var files = (await h.Service.ListAsync(book.Id, default)).Files;
        await h.Service.ReorderAsync(book.Id, [files[1].Id, files[0].Id], default);
        await h.Service.UpdateAsync(book.Id, files[1].Id, "Custom title", default);
        var job = await h.Service.CreateExportAsync(files.Select(f => f.Id).ToArray(), null, true, default);
        await h.Service.ProcessNextAsync(default);
        var ticket = await h.Service.CreateJobDownloadAsync(job.Id, default);
        var archive = await h.Service.ConsumeDownloadAsync(TicketId(ticket), Token(ticket), default);
        using var saved = new MemoryStream();
        await archive.Content.CopyToAsync(saved);
        await archive.Content.DisposeAsync();
        using (var zip = new ZipArchive(new MemoryStream(saved.ToArray()), ZipArchiveMode.Read))
        {
            Assert.NotNull(zip.GetEntry("manifest.json"));
        }

        await h.Context.Books.Where(b => b.Id == book.Id).ExecuteDeleteAsync();
        h.Context.ChangeTracker.Clear();
        var replacement = await h.AddBook("Restore me");
        saved.Position = 0;
        var import =
            await h.Service.CreateImportAsync(null, Uploads(new BookFileUpload(saved, "tsundoku-epubs.zip")), default,
                saved.Length);
        await h.Service.ProcessNextAsync(default);
        var preview = await h.Service.GetJobAsync(import.Id, default);
        Assert.All(preview.Entries, e =>
        {
            Assert.Null(e.Error);
            Assert.Equal(replacement.Id, e.BookId);
        });
        await h.Service.FinalizeAsync(import.Id, Select(preview, replacement.Id), default);
        await h.Service.ProcessNextAsync(default);
        var restored = (await h.Service.ListAsync(replacement.Id, default)).Files;
        Assert.Equal(new[] { "Custom title", "Ten" }, restored.Select(f => f.Title));
        Assert.All(restored, f => Assert.False(f.IsShared));
    }

    [Fact]
    public async Task InvalidEpub_IsReportedWithoutWritingAFile()
    {
        using var h = new Harness();
        var book = await h.AddBook("Invalid");
        using var zip = Zip(("not-an-epub.txt", Encoding.UTF8.GetBytes("hello")));
        var job = await h.Service.CreateImportAsync(book.Id, Uploads(new BookFileUpload(zip, "fake.epub")), default);
        await h.Service.ProcessNextAsync(default);
        var preview = await h.Service.GetJobAsync(job.Id, default);
        Assert.NotNull(Assert.Single(preview.Entries).Error);
        await Assert.ThrowsAsync<ValidationException>(() =>
            h.Service.FinalizeAsync(job.Id, Select(preview, book.Id), default));
        Assert.Empty((await h.Service.ListAsync(book.Id, default)).Files);
    }

    [Theory]
    [InlineData("../outside.epub", 0)]
    [InlineData("safe.epub", unchecked((int)0xA0000000))]
    public async Task UnsafeOuterZip_BlocksImport(string name, int attributes)
    {
        using var h = new Harness();
        var book = await h.AddBook("Unsafe");
        using var zip = Zip((name, Epub("Unsafe")));
        if (attributes != 0)
        {
            using (var archive = new ZipArchive(zip, ZipArchiveMode.Update, true))
            {
                archive.GetEntry(name)!.ExternalAttributes = attributes;
            }

            zip.Position = 0;
        }

        var job = await h.Service.CreateImportAsync(book.Id, Uploads(new BookFileUpload(zip, "unsafe.zip")), default);
        await h.Service.ProcessNextAsync(default);
        Assert.Equal("Failed", (await h.Service.GetJobAsync(job.Id, default)).Status);
        await Assert.ThrowsAsync<AccountTemporarilyBlockedException>(() =>
            h.Guard.ThrowIfBlockedAsync(h.User, default));
    }

    [Fact]
    public async Task InnerZipBomb_IsDetectedEvenWhenTheOuterZipIsUncompressed()
    {
        using var h = new Harness();
        var book = await h.AddBook("Bomb");
        var epub = Epub("Bomb", new string('A', 1024 * 1024));
        using var zip = Zip(("bomb.epub", epub));
        var job = await h.Service.CreateImportAsync(book.Id, Uploads(new BookFileUpload(zip, "bomb.zip")), default);
        await h.Service.ProcessNextAsync(default);
        Assert.Equal("Failed", (await h.Service.GetJobAsync(job.Id, default)).Status);
        Assert.Empty((await h.Service.ListAsync(book.Id, default)).Files);
    }

    [Fact]
    public async Task FailedStorageWrite_HasDurableCompensatingCleanup()
    {
        using var h = new Harness(true);
        var book = await h.AddBook("Failure");
        using var file = new MemoryStream(Epub("Failure"));
        var job = await h.Service.CreateImportAsync(book.Id, Uploads(new BookFileUpload(file, "failure.epub")),
            default);
        await h.Service.ProcessNextAsync(default);
        await h.Service.FinalizeAsync(job.Id, Select(await h.Service.GetJobAsync(job.Id, default), book.Id), default);
        await h.Service.ProcessNextAsync(default);
        Assert.Equal("Failed", (await h.Service.GetJobAsync(job.Id, default)).Status);
        Assert.Empty(await h.Context.BookFiles.ToListAsync());
        var compensation = Assert.Single(await h.Context.StorageCleanupQueueItems.ToListAsync());
        Assert.Equal("BookFile", compensation.StorageKind);
        Assert.True(compensation.NextAttemptAt > DateTime.UtcNow);
    }

    [Fact]
    public async Task FiltersExportAllMatchingBooks_NotJustAListPage()
    {
        using var h = new Harness();
        var a = await h.AddBook("Fantasy A");
        var b = await h.AddBook("Fantasy B");
        var c = await h.AddBook("Other");
        await h.Import(a.Id, Epub("A"));
        await h.Import(b.Id, Epub("B"));
        await h.Import(c.Id, Epub("C"));
        var candidates = await h.Service.ExportCandidatesAsync("Fantasy", default);
        Assert.Equal(2, candidates.Count);
        Assert.DoesNotContain(candidates, x => x.BookId == c.Id);
    }

    [Fact]
    public async Task DeletedBook_QueuesObjectsBeforeCascade_AndExpiredTrashIsPurged()
    {
        using var h = new Harness();
        var book = await h.AddBook("Delete");
        await h.Import(book.Id, Epub("Delete"));
        var file = Assert.Single((await h.Service.ListAsync(book.Id, default)).Files);
        await h.Service.DeleteAsync(book.Id, file.Id, default);
        await h.Context.StorageCleanupQueueItems.ExecuteUpdateAsync(s =>
            s.SetProperty(q => q.NextAttemptAt, DateTime.UtcNow.AddMinutes(-1)));
        var processor = new StorageCleanupQueueProcessor(h.Context, new CoverStorage(), TimeProvider.System,
            NullLogger<StorageCleanupQueueProcessor>.Instance, h.Storage);
        await processor.ProcessBatchAsync(default);
        Assert.Empty(await h.Context.BookFiles.ToListAsync());
        Assert.Empty(await h.Context.StorageCleanupQueueItems.ToListAsync());
        await h.Import(book.Id, Epub("Again"));
        await h.Service.QueueDeletedBookFilesAsync(h.Database.UserId, book.Id, default);
        await h.Context.Books.Where(b => b.Id == book.Id).ExecuteDeleteAsync();
        Assert.Empty(await h.Context.BookFiles.ToListAsync());
        Assert.Single(await h.Context.StorageCleanupQueueItems.ToListAsync());
    }

    private static BookFileImportSelection[] Select(BookFileJobDto preview, Guid bookId)
    {
        return preview.Entries
            .Select(e => new BookFileImportSelection(e.Id, bookId, e.Title, e.SortOrder)).ToArray();
    }

    private static Guid TicketId(BookFileDownloadDto ticket)
    {
        return Guid.Parse(ticket.Url.Split('?')[0].Split('/').Last());
    }

    private static string Token(BookFileDownloadDto ticket)
    {
        return ticket.Url.Split("token=")[1];
    }

    private static async IAsyncEnumerable<BookFileUpload> Uploads(BookFileUpload upload,
        [EnumeratorCancellation] CancellationToken ct = default)
    {
        ct.ThrowIfCancellationRequested();
        yield return upload;
        await Task.CompletedTask;
    }

    private static byte[] Epub(string title, string body = "A chapter.", string? navigation = null, bool legacy = false,
        string? navigationPath = null)
    {
        using var target = new MemoryStream();
        using (var zip = new ZipArchive(target, ZipArchiveMode.Create, true))
        {
            void Write(string name, string text, CompressionLevel compression = CompressionLevel.NoCompression)
            {
                using var writer = new StreamWriter(zip.CreateEntry(name, compression).Open(), new UTF8Encoding(false));
                writer.Write(text);
            }

            Write("mimetype", "application/epub+zip");
            Write("META-INF/container.xml",
                "<container xmlns='urn:oasis:names:tc:opendocument:xmlns:container'><rootfiles><rootfile full-path='content.opf'/></rootfiles></container>");
            navigationPath ??= legacy ? "toc.ncx" : "nav.xhtml";
            var manifest = navigation == null
                ? ""
                : legacy
                    ? $"<manifest><item id='ncx' href='{navigationPath}' media-type='application/x-dtbncx+xml'/></manifest><spine toc='ncx'/>"
                    : $"<manifest><item id='nav' href='{navigationPath}' media-type='application/xhtml+xml' properties='nav'/></manifest>";
            Write("content.opf",
                $"<package xmlns='http://www.idpf.org/2007/opf'><metadata><dc:title xmlns:dc='http://purl.org/dc/elements/1.1/'>{title}</dc:title></metadata>{manifest}</package>");
            if (navigation != null)
            {
                Write(navigationPath, navigation);
            }

            Write("chapter.xhtml", body, CompressionLevel.Optimal);
        }

        return target.ToArray();
    }

    private static MemoryStream Zip(params (string Name, byte[] Bytes)[] files)
    {
        var stream = new MemoryStream();
        using (var zip = new ZipArchive(stream, ZipArchiveMode.Create, true))
        {
            foreach (var file in files)
            {
                using var target = zip.CreateEntry(file.Name, CompressionLevel.NoCompression).Open();
                target.Write(file.Bytes);
            }
        }

        stream.Position = 0;
        return stream;
    }

    private sealed class Harness : IDisposable
    {
        private readonly IOptions<BookFileOptions> _options;

        private readonly string _root =
            Path.Combine(Path.GetTempPath(), "tsundoku-epub-tests", Guid.NewGuid().ToString("N"));

        private readonly IOptions<BookImportSecurityOptions> _security =
            Options.Create(new BookImportSecurityOptions { SuspiciousCompressionMinimumBytes = 128 * 1024 });

        public Harness(bool failWrite = false)
        {
            Context = Database.CreateContext();
            User = new Reader(Database.UserId);
            _options = Options.Create(new BookFileOptions
            {
                StagingRoot = Path.Combine(_root, "staging"), StorageRoot = Path.Combine(_root, "files")
            });
            var local = new LocalBookFileStorage(_options);
            Storage = failWrite ? new BrokenStorage(local) : local;
            Guard = new AccountAbuseGuard(
                new MemoryDistributedCache(Options.Create(new MemoryDistributedCacheOptions())), _security,
                NullLogger<AccountAbuseGuard>.Instance);
            Service = For(Database.UserId);
        }

        public SqliteTestDatabase Database { get; } = new();
        public ApplicationDbContext Context { get; }
        public BookFileService Service { get; }
        public IBookFileStorage Storage { get; }
        public AccountAbuseGuard Guard { get; }
        public IUser User { get; }
        public IOptions<BookFileOptions> FileOptions => _options;

        public void Dispose()
        {
            Context.Dispose();
            Database.Dispose();
            if (Directory.Exists(_root))
            {
                Directory.Delete(_root, true);
            }
        }

        public BookFileService For(Guid id)
        {
            return new BookFileService(Context, new Reader(id), Storage,
                new StorageCleanupQueue(Context, TimeProvider.System), _options, _security, Guard);
        }

        public async Task<Book> AddBook(string title)
        {
            var book = TestData.Book(Database.UserId, title);
            Context.Books.Add(book);
            await Context.SaveChangesAsync();
            return book;
        }

        public async Task Import(Guid bookId, byte[] bytes, string filename = "volume.epub")
        {
            using var stream = new MemoryStream(bytes);
            var job = await Service.CreateImportAsync(bookId, Uploads(new BookFileUpload(stream, filename)), default);
            await Service.ProcessNextAsync(default);
            var preview = await Service.GetJobAsync(job.Id, default);
            Assert.Equal("Ready", preview.Status);
            Assert.All(preview.Entries, e => Assert.Null(e.Error));
            await Service.FinalizeAsync(job.Id, Select(preview, bookId), default);
            await Service.ProcessNextAsync(default);
            Assert.Equal("Completed", (await Service.GetJobAsync(job.Id, default)).Status);
        }

        public async Task<PublicBookSnapshot> Snapshot(Book book)
        {
            var snapshot = new PublicBookSnapshot
            {
                SourceBookId = book.Id,
                OwnerId = Database.UserId,
                PrimaryTitle = book.PrimaryTitle,
                NormalizedPrimaryTitle = book.NormalizedPrimaryTitle,
                ContentType = "Novel",
                AlternativeTitlesJson = "[]",
                AuthorOtherNamesJson = "[]",
                GenresJson = "[]",
                TagsJson = "[]",
                PublicTagIdsJson = "[]"
            };
            Context.PublicBookSnapshots.Add(snapshot);
            await Context.SaveChangesAsync();
            return snapshot;
        }
    }

    private sealed class Reader(Guid id) : IUser
    {
        public Guid? Id => id;
        public Guid RequiredId => id;
        public string? Email => "reader@test.local";
        public string? Username => "reader";
        public IEnumerable<string> Roles => [];
        public bool IsAuthenticated => true;
        public bool Valid => true;
    }

    private sealed class EndpointAuthentication(
        IOptionsMonitor<AuthenticationSchemeOptions> options,
        ILoggerFactory logger,
        UrlEncoder encoder)
        : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
    {
        protected override Task<AuthenticateResult> HandleAuthenticateAsync()
        {
            return Task.FromResult(
                AuthenticateResult.Success(
                    new AuthenticationTicket(
                        new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, "test")],
                            Scheme.Name)), Scheme.Name)));
        }
    }

    private sealed class BrokenStorage(IBookFileStorage inner) : IBookFileStorage
    {
        public async Task SaveAsync(string path, Stream content, CancellationToken ct)
        {
            await inner.SaveAsync(path, content, ct);
            throw new IOException("Storage response lost.");
        }

        public Task<Stream> OpenReadAsync(string path, CancellationToken ct)
        {
            return inner.OpenReadAsync(path, ct);
        }

        public Task DeleteIfExistsAsync(string path, CancellationToken ct)
        {
            return inner.DeleteIfExistsAsync(path, ct);
        }
    }

    private sealed class CoverStorage : IBookCoverStorage
    {
        public Task<BookCoverStoredFiles> SaveAsync(Guid ownerId, Guid bookId, Stream content, string fileName,
            string? contentType, CancellationToken ct)
        {
            throw new NotSupportedException();
        }

        public Task<Stream> OpenReadAsync(string storagePath, CancellationToken ct)
        {
            throw new NotSupportedException();
        }

        public Task DeleteIfExistsAsync(string? path, CancellationToken ct)
        {
            return Task.CompletedTask;
        }
    }
}
