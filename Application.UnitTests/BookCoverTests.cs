namespace Application.UnitTests;

using System.Net;
using System.Net.Http.Headers;
using System.Text;
using Common.Interfaces;
using Domain.Entities;
using Domain.Exceptions;
using Domain.Repositories;
using Features.BookFeatures.Commands;
using FluentValidation;
using Infrastructure.BookCovers;
using Microsoft.Extensions.Options;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.PixelFormats;

public class BookCoverTests
{
    private static readonly Guid OwnerId = Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    private static readonly Guid BookId = Guid.Parse("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");

    [Fact]
    public async Task Resolver_ShouldUseFirstProviderWithCandidate()
    {
        var resolver = new BookCoverResolver(new IBookCoverProvider[]
        {
            new FakeProvider(null),
            new FakeProvider(new BookCoverCandidate(BookCoverSource.GoogleBooks, "https://example.com/cover.jpg")),
            new FakeProvider(new BookCoverCandidate(BookCoverSource.Jikan, "https://example.com/other.jpg"))
        });

        var result = await resolver.FindAsync(CreateBook(), CancellationToken.None);

        Assert.NotNull(result);
        Assert.Equal(BookCoverSource.GoogleBooks, result.Source);
        Assert.Equal("https://example.com/cover.jpg", result.ImageUrl);
    }

    [Fact]
    public async Task BookLinkMetadataProvider_ShouldReadOpenGraphImage()
    {
        var html = """
                   <html>
                     <head>
                       <meta property="og:image" content="/covers/book.jpg" />
                     </head>
                   </html>
                   """;
        var provider = new BookLinkMetadataCoverProvider(new HttpClient(new FakeHttpMessageHandler(html))
        {
            BaseAddress = new Uri("https://source.example")
        });
        var book = CreateBook();
        book.Links.Add(new BookLink
        {
            Url = "https://source.example/series/book", SourceType = "Official", IsPrimary = true
        });

        var result = await provider.FindAsync(book, CancellationToken.None);

        Assert.NotNull(result);
        Assert.Equal(BookCoverSource.BookLinkMetadata, result.Source);
        Assert.Equal("https://source.example/covers/book.jpg", result.ImageUrl);
    }

    [Fact]
    public async Task BookLinkMetadataProvider_ShouldReadImageSrcLinkWhenMetaImagesAreRejected()
    {
        var html = """
                   <html>
                     <head>
                       <meta property="og:image" content="/assets/logo.png" />
                       <meta content="/covers/reversed.jpg" property="twitter:image" />
                       <link rel="preload image_src" href="/covers/fallback.webp" />
                     </head>
                   </html>
                   """;
        var provider = new BookLinkMetadataCoverProvider(new HttpClient(new FakeHttpMessageHandler(html)));
        var book = CreateBook();
        book.Links.Add(new BookLink
        {
            Url = "https://source.example/series/book", SourceType = "Official", IsPrimary = true
        });

        var result = await provider.FindAsync(book, CancellationToken.None);

        Assert.NotNull(result);
        Assert.Equal("https://source.example/covers/reversed.jpg", result.ImageUrl);
    }

    [Fact]
    public async Task BookLinkMetadataProvider_ShouldSkipInvalidNonHtmlAndChallengePages()
    {
        var invalidLinkBook = CreateBook();
        invalidLinkBook.Links.Add(
            new BookLink { Url = "file:///tmp/page.html", SourceType = "Local", IsPrimary = true });
        var challengeBook = CreateBook();
        challengeBook.Links.Add(new BookLink
        {
            Url = "https://source.example/challenge", SourceType = "Official", IsPrimary = true
        });
        var nonHtmlBook = CreateBook();
        nonHtmlBook.Links.Add(new BookLink
        {
            Url = "https://source.example/image", SourceType = "Official", IsPrimary = true
        });
        var invalidProvider =
            new BookLinkMetadataCoverProvider(new HttpClient(new FakeHttpMessageHandler("<html></html>")));
        var challengeProvider =
            new BookLinkMetadataCoverProvider(
                new HttpClient(new FakeHttpMessageHandler("<html>cf_chl challenge-platform</html>")));
        var nonHtmlProvider = new BookLinkMetadataCoverProvider(
            new HttpClient(new FakeHttpMessageHandler(Encoding.UTF8.GetBytes("not html"), "application/json")));

        Assert.Null(await invalidProvider.FindAsync(invalidLinkBook, CancellationToken.None));
        Assert.Null(await challengeProvider.FindAsync(challengeBook, CancellationToken.None));
        Assert.Null(await nonHtmlProvider.FindAsync(nonHtmlBook, CancellationToken.None));
    }

    [Fact]
    public async Task BookLinkMetadataProvider_ShouldSkipBadImageCandidatesAndUseLinkFallback()
    {
        var html = """
                   <html>
                     <head>
                       <meta property="og:image" content="data:image/png;base64,abc" />
                       <meta property="twitter:image" content="/avatars/user.jpg" />
                       <link rel="image_src" href="/covers/fallback.jpg" />
                     </head>
                   </html>
                   """;
        var provider = new BookLinkMetadataCoverProvider(new HttpClient(new FakeHttpMessageHandler(html)));
        var book = CreateBook();
        book.Links.Add(new BookLink
        {
            Url = "https://source.example/series/book", SourceType = "Official", IsPrimary = true
        });

        var result = await provider.FindAsync(book, CancellationToken.None);

        Assert.NotNull(result);
        Assert.Equal("https://source.example/covers/fallback.jpg", result.ImageUrl);
    }

    [Fact]
    public async Task AniListProvider_ShouldReadFirstCoverImage()
    {
        var provider = new AniListBookCoverProvider(new HttpClient(new FakeHttpMessageHandler("""
            {"data":{"Page":{"media":[{"coverImage":{"extraLarge":"https://cdn.example.com/anilist-xl.jpg","large":"https://cdn.example.com/anilist.jpg"}}]}}}
            """)) { BaseAddress = new Uri("https://graphql.anilist.co") });

        var result = await provider.FindAsync(CreateBook(), CancellationToken.None);

        Assert.NotNull(result);
        Assert.Equal(BookCoverSource.AniList, result.Source);
        Assert.Equal("https://cdn.example.com/anilist-xl.jpg", result.ImageUrl);
    }

    [Fact]
    public async Task AniListProvider_ShouldFallbackToAlternativeTitleAndLargeImage()
    {
        var provider = new AniListBookCoverProvider(new HttpClient(new SequenceHttpMessageHandler(
            new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent("""{"data":{"Page":{"media":[]}}}""", Encoding.UTF8, "application/json")
            },
            new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(
                    """{"data":{"Page":{"media":[{"coverImage":{"large":"https://cdn.example.com/anilist-large.jpg"}}]}}}""",
                    Encoding.UTF8, "application/json")
            })) { BaseAddress = new Uri("https://graphql.anilist.co") });
        var book = CreateBook();
        book.Titles.Add(new BookTitle { Title = "Alt Title", NormalizedTitle = "ALTTITLE", IsPrimary = false });

        var result = await provider.FindAsync(book, CancellationToken.None);

        Assert.NotNull(result);
        Assert.Equal("https://cdn.example.com/anilist-large.jpg", result.ImageUrl);
    }

    [Fact]
    public async Task JikanProvider_ShouldReadFirstCoverImage()
    {
        var provider = new JikanBookCoverProvider(new HttpClient(new FakeHttpMessageHandler("""
            {"data":[{"images":{"jpg":{"large_image_url":"https://cdn.example.com/jikan-large.jpg","image_url":"https://cdn.example.com/jikan.jpg"}}}]}
            """)) { BaseAddress = new Uri("https://api.jikan.moe") });

        var result = await provider.FindAsync(CreateBook(), CancellationToken.None);

        Assert.NotNull(result);
        Assert.Equal(BookCoverSource.Jikan, result.Source);
        Assert.Equal("https://cdn.example.com/jikan-large.jpg", result.ImageUrl);
    }

    [Fact]
    public async Task JikanProvider_ShouldFallbackToRegularImageAndSkipInvalidPayloads()
    {
        var provider = new JikanBookCoverProvider(new HttpClient(new SequenceHttpMessageHandler(
            new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent("""{"data":{}}""", Encoding.UTF8, "application/json")
            },
            new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(
                    """{"data":[{"images":{"jpg":{"image_url":"https://cdn.example.com/jikan.jpg"}}}]}""",
                    Encoding.UTF8, "application/json")
            })) { BaseAddress = new Uri("https://api.jikan.moe") });
        var book = CreateBook();
        book.Titles.Add(new BookTitle { Title = "Alt Title", NormalizedTitle = "ALTTITLE", IsPrimary = false });

        var result = await provider.FindAsync(book, CancellationToken.None);

        Assert.NotNull(result);
        Assert.Equal("https://cdn.example.com/jikan.jpg", result.ImageUrl);
    }

    [Fact]
    public async Task GoogleBooksProvider_ShouldReadCoverAndNormalizeHttps()
    {
        var provider = new GoogleBooksCoverProvider(new HttpClient(new FakeHttpMessageHandler("""
            {"items":[{"volumeInfo":{"imageLinks":{"thumbnail":"http://books.google.com/cover.jpg"}}}]}
            """)) { BaseAddress = new Uri("https://www.googleapis.com") });

        var result = await provider.FindAsync(CreateBook(), CancellationToken.None);

        Assert.NotNull(result);
        Assert.Equal(BookCoverSource.GoogleBooks, result.Source);
        Assert.Equal("https://books.google.com/cover.jpg", result.ImageUrl);
    }

    [Fact]
    public async Task GoogleBooksProvider_ShouldFallbackToSmallThumbnail()
    {
        var provider = new GoogleBooksCoverProvider(new HttpClient(new FakeHttpMessageHandler("""
            {"items":[{"volumeInfo":{"imageLinks":{"smallThumbnail":"http://books.google.com/small.jpg"}}}]}
            """)) { BaseAddress = new Uri("https://www.googleapis.com") });

        var result = await provider.FindAsync(CreateBook(), CancellationToken.None);

        Assert.NotNull(result);
        Assert.Equal("https://books.google.com/small.jpg", result.ImageUrl);
    }

    [Fact]
    public async Task OpenLibraryProvider_ShouldBuildCoverUrlFromCoverId()
    {
        var provider = new OpenLibraryCoverProvider(new HttpClient(new FakeHttpMessageHandler("""
            {"docs":[{"title":"I Shall Seal the Heavens","cover_i":12345}]}
            """)) { BaseAddress = new Uri("https://openlibrary.org") });

        var result = await provider.FindAsync(CreateBook(), CancellationToken.None);

        Assert.NotNull(result);
        Assert.Equal(BookCoverSource.OpenLibrary, result.Source);
        Assert.Equal("https://covers.openlibrary.org/b/id/12345-L.jpg", result.ImageUrl);
    }

    [Fact]
    public async Task OpenLibraryProvider_ShouldSkipDocsWithoutCoverAndUseAlternativeTitle()
    {
        var provider = new OpenLibraryCoverProvider(new HttpClient(new SequenceHttpMessageHandler(
            new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent("""{"docs":[{"title":"Primary"}]}""", Encoding.UTF8, "application/json")
            },
            new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent("""{"docs":[{"cover_i":999}]}""", Encoding.UTF8, "application/json")
            })) { BaseAddress = new Uri("https://openlibrary.org") });
        var book = CreateBook();
        book.Titles.Add(new BookTitle { Title = "Alt Title", NormalizedTitle = "ALTTITLE", IsPrimary = false });

        var result = await provider.FindAsync(book, CancellationToken.None);

        Assert.NotNull(result);
        Assert.Equal("https://covers.openlibrary.org/b/id/999-L.jpg", result.ImageUrl);
    }

    [Fact]
    public async Task WikidataProvider_ShouldReadImageBinding()
    {
        var provider = new WikidataCoverProvider(new HttpClient(new FakeHttpMessageHandler("""
            {"results":{"bindings":[{"image":{"type":"uri","value":"https://commons.wikimedia.org/wiki/Special:FilePath/Cover.jpg"}}]}}
            """)) { BaseAddress = new Uri("https://query.wikidata.org") });

        var result = await provider.FindAsync(CreateBook(), CancellationToken.None);

        Assert.NotNull(result);
        Assert.Equal(BookCoverSource.Wikidata, result.Source);
        Assert.Equal("https://commons.wikimedia.org/wiki/Special:FilePath/Cover.jpg", result.ImageUrl);
    }

    [Fact]
    public async Task WikidataProvider_ShouldSkipInvalidBindingsAndUseAlternativeTitle()
    {
        var provider = new WikidataCoverProvider(new HttpClient(new SequenceHttpMessageHandler(
            new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent("""{"results":{"bindings":[{"image":{"value":""}}]}}""", Encoding.UTF8,
                    "application/json")
            },
            new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(
                    """{"results":{"bindings":[{"image":{"value":"https://commons.wikimedia.org/wiki/Special:FilePath/Alt.jpg"}}]}}""",
                    Encoding.UTF8, "application/json")
            })) { BaseAddress = new Uri("https://query.wikidata.org") });
        var book = CreateBook();
        book.Titles.Add(new BookTitle
        {
            Title = "Alt \"Quoted\" Title", NormalizedTitle = "ALTQUOTEDTITLE", IsPrimary = false
        });

        var result = await provider.FindAsync(book, CancellationToken.None);

        Assert.NotNull(result);
        Assert.Equal("https://commons.wikimedia.org/wiki/Special:FilePath/Alt.jpg", result.ImageUrl);
    }

    [Fact]
    public async Task SetBookCoverFromUrl_ShouldStoreManualUrlCover()
    {
        var book = CreateBook(new BookCover
        {
            BookId = BookId,
            Status = BookCoverStatus.NotFound,
            FailureReason =
                "No cover found in saved links, AniList, Jikan, Google Books, Open Library, or Wikidata."
        });
        var repository = new FakeBookRepository(book);
        var coverRepository = new FakeBookCoverRepository();
        var remoteImageService = new FakeRemoteImageService();
        var handler = new SetBookCoverFromUrlHandler(
            repository,
            coverRepository,
            new FakeCoverStorage(),
            remoteImageService,
            new FakeBookListCacheInvalidator(),
            new FakeUser());

        var dto =
            await handler.Handle(new SetBookCoverFromUrlCommand(book.Id, "https://example.com/cover.jpg"),
                CancellationToken.None);

        Assert.Equal("Uploaded", dto.Status);
        Assert.Equal("ManualUrl", dto.Source);
        Assert.Equal("https://example.com/cover.jpg", book.Cover!.OriginalImageUrl);
        Assert.Equal("owner/book.jpg", book.Cover.StoragePath);
        Assert.Equal("owner/book.thumb.jpg", book.Cover.ThumbnailStoragePath);
        Assert.True(repository.Saved);
        Assert.False(coverRepository.Added);
    }

    [Fact]
    public async Task UploadBookCover_ShouldStoreManualUploadAndInvalidateCache()
    {
        var book = CreateBook(new BookCover
        {
            BookId = BookId,
            Status = BookCoverStatus.Found,
            StoragePath = "owner/old.jpg",
            ThumbnailStoragePath = "owner/old.thumb.jpg"
        });
        var repository = new FakeBookRepository(book);
        var coverRepository = new FakeBookCoverRepository();
        var storage = new FakeCoverStorage();
        var cacheInvalidator = new FakeBookListCacheInvalidator();
        var handler = new UploadBookCoverHandler(
            repository,
            coverRepository,
            storage,
            cacheInvalidator,
            new FakeUser());

        await using var content = new MemoryStream([1, 2, 3]);
        var dto =
            await handler.Handle(new UploadBookCoverCommand(book.Id, content, "cover.png", "image/png", content.Length),
                CancellationToken.None);

        Assert.Equal("Uploaded", dto.Status);
        Assert.Equal("ManualUpload", dto.Source);
        Assert.Equal("owner/book.jpg", book.Cover!.StoragePath);
        Assert.Equal(["owner/old.jpg", "owner/old.thumb.jpg"], storage.DeletedPaths);
        Assert.True(repository.Saved);
        Assert.Equal(book.OwnerId, cacheInvalidator.InvalidatedOwnerId);
    }

    [Fact]
    public async Task UploadBookCover_ShouldRejectEmptyContent()
    {
        var handler = new UploadBookCoverHandler(
            new FakeBookRepository(CreateBook()),
            new FakeBookCoverRepository(),
            new FakeCoverStorage(),
            new FakeBookListCacheInvalidator(),
            new FakeUser());

        await Assert.ThrowsAsync<ValidationException>(() =>
            handler.Handle(new UploadBookCoverCommand(BookId, new MemoryStream(), "cover.jpg", "image/jpeg", 0),
                CancellationToken.None));
    }

    [Fact]
    public async Task SetBookCoverFromUrl_ShouldRejectInvalidUrl()
    {
        var handler = new SetBookCoverFromUrlHandler(
            new FakeBookRepository(CreateBook()),
            new FakeBookCoverRepository(),
            new FakeCoverStorage(),
            new FakeRemoteImageService(),
            new FakeBookListCacheInvalidator(),
            new FakeUser());

        await Assert.ThrowsAsync<ValidationException>(() =>
            handler.Handle(new SetBookCoverFromUrlCommand(BookId, "file:///tmp/cover.jpg"), CancellationToken.None));
    }

    [Fact]
    public async Task SetBookCoverFromUrl_ShouldAddCover_WhenBookHasNoCoverRow()
    {
        var book = CreateBook(hasCover: false);
        var repository = new FakeBookRepository(book);
        var coverRepository = new FakeBookCoverRepository();
        var handler = new SetBookCoverFromUrlHandler(
            repository,
            coverRepository,
            new FakeCoverStorage(),
            new FakeRemoteImageService(),
            new FakeBookListCacheInvalidator(),
            new FakeUser());

        var dto =
            await handler.Handle(new SetBookCoverFromUrlCommand(book.Id, "https://example.com/cover.jpg"),
                CancellationToken.None);

        Assert.Equal("Uploaded", dto.Status);
        Assert.Equal("ManualUrl", dto.Source);
        Assert.NotNull(book.Cover);
        Assert.True(coverRepository.Added);
        Assert.False(repository.Saved);
    }

    [Fact]
    public async Task RemoteImageService_ShouldAcceptImageBytes_WhenUrlExtensionIsMisleading()
    {
        var storageRoot = CreateTempStorageRoot();
        try
        {
            var pngBytes = CreateTestPngBytes();
            var service = CreateRemoteImageService(storageRoot, pngBytes, "text/plain");

            var stored = await service.SaveFromUrlAsync(OwnerId, BookId,
                "https://example.com/not-an-image.txt", CancellationToken.None);

            Assert.Equal("image/jpeg", stored.Original.MimeType);
            Assert.EndsWith(".jpg", stored.Original.StoragePath);
            Assert.EndsWith(".thumb.jpg", stored.Thumbnail.StoragePath);
            Assert.True(File.Exists(Path.Combine(storageRoot, stored.Original.StoragePath)));
            Assert.True(File.Exists(Path.Combine(storageRoot, stored.Thumbnail.StoragePath)));
        }
        finally
        {
            DeleteTempStorageRoot(storageRoot);
        }
    }

    [Fact]
    public async Task RemoteImageService_ShouldRejectNonImageBytes_WhenUrlLooksLikeJpg()
    {
        var storageRoot = CreateTempStorageRoot();
        try
        {
            var service = CreateRemoteImageService(storageRoot,
                Encoding.UTF8.GetBytes("<html>not an image</html>"), "text/html");

            await Assert.ThrowsAsync<ValidationException>(() =>
                service.SaveFromUrlAsync(OwnerId, BookId, "https://example.com/cover.jpg", CancellationToken.None));
        }
        finally
        {
            DeleteTempStorageRoot(storageRoot);
        }
    }

    [Theory]
    [InlineData("http://127.0.0.1/cover.jpg")]
    [InlineData("http://10.0.0.5/cover.jpg")]
    [InlineData("http://172.16.0.5/cover.jpg")]
    [InlineData("http://192.168.1.5/cover.jpg")]
    [InlineData("http://169.254.169.254/latest/meta-data/")]
    [InlineData("http://[::1]/cover.jpg")]
    [InlineData("http://[fc00::1]/cover.jpg")]
    public async Task RemoteImageService_ShouldRejectPrivateOrLoopbackHosts(string imageUrl)
    {
        var storageRoot = CreateTempStorageRoot();
        try
        {
            var handler = new FakeHttpMessageHandler(CreateTestPngBytes(), "image/png");
            var service = CreateRemoteImageService(storageRoot, handler);

            await Assert.ThrowsAsync<ValidationException>(() =>
                service.SaveFromUrlAsync(OwnerId, BookId, imageUrl, CancellationToken.None));

            Assert.Equal(0, handler.RequestCount);
        }
        finally
        {
            DeleteTempStorageRoot(storageRoot);
        }
    }

    [Theory]
    [InlineData("not-a-url")]
    [InlineData("file:///tmp/cover.jpg")]
    public async Task RemoteImageService_ShouldRejectInvalidOrNonHttpUrls(string imageUrl)
    {
        var storageRoot = CreateTempStorageRoot();
        try
        {
            var handler = new FakeHttpMessageHandler(CreateTestPngBytes(), "image/png");
            var service = CreateRemoteImageService(storageRoot, handler);

            await Assert.ThrowsAsync<ValidationException>(() =>
                service.SaveFromUrlAsync(OwnerId, BookId, imageUrl, CancellationToken.None));

            Assert.Equal(0, handler.RequestCount);
        }
        finally
        {
            DeleteTempStorageRoot(storageRoot);
        }
    }

    [Fact]
    public async Task RemoteImageService_ShouldRejectUnsuccessfulStatusCode()
    {
        var storageRoot = CreateTempStorageRoot();
        try
        {
            var handler = new FakeHttpMessageHandler(Array.Empty<byte>(), "text/plain", HttpStatusCode.NotFound);
            var service = CreateRemoteImageService(storageRoot, handler);

            var exception = await Assert.ThrowsAsync<ValidationException>(() =>
                service.SaveFromUrlAsync(OwnerId, BookId, "https://93.184.216.34/missing.jpg", CancellationToken.None));

            Assert.Contains("HTTP 404", exception.Message);
            Assert.Equal(1, handler.RequestCount);
        }
        finally
        {
            DeleteTempStorageRoot(storageRoot);
        }
    }

    [Fact]
    public async Task RemoteImageService_ShouldRejectRedirectResponses()
    {
        var storageRoot = CreateTempStorageRoot();
        try
        {
            var service = CreateRemoteImageService(
                storageRoot,
                new FakeHttpMessageHandler(Array.Empty<byte>(), "text/plain", HttpStatusCode.Redirect));

            await Assert.ThrowsAsync<ValidationException>(() =>
                service.SaveFromUrlAsync(OwnerId, BookId, "https://example.com/redirect", CancellationToken.None));
        }
        finally
        {
            DeleteTempStorageRoot(storageRoot);
        }
    }

    [Fact]
    public async Task RefreshBookCover_ShouldAddPendingCover_WhenBookHasNoCoverRow()
    {
        var book = CreateBook(hasCover: false);
        var repository = new FakeBookRepository(book);
        var coverRepository = new FakeBookCoverRepository();
        var queue = new FakeBookCoverQueue();
        var handler = new RefreshBookCoverHandler(
            repository,
            coverRepository,
            queue,
            new FakeCoverStorage(),
            new FakeBookListCacheInvalidator(),
            new FakeUser());

        var dto = await handler.Handle(new RefreshBookCoverCommand(book.Id), CancellationToken.None);

        Assert.Equal("Pending", dto.Status);
        Assert.NotNull(book.Cover);
        Assert.True(coverRepository.Added);
        Assert.False(repository.Saved);
        Assert.Equal(book.Id, queue.QueuedBookId);
    }

    [Fact]
    public async Task RefreshBookCover_ShouldResetExistingCoverDeleteFilesAndInvalidateCache()
    {
        var book = CreateBook(new BookCover
        {
            BookId = BookId,
            Status = BookCoverStatus.Found,
            Source = BookCoverSource.GoogleBooks,
            StoragePath = "owner/current.jpg",
            ThumbnailStoragePath = "owner/current.thumb.jpg",
            OriginalImageUrl = "https://example.com/current.jpg",
            FailureReason = "old"
        });
        var repository = new FakeBookRepository(book);
        var coverRepository = new FakeBookCoverRepository();
        var queue = new FakeBookCoverQueue();
        var storage = new FakeCoverStorage();
        var cacheInvalidator = new FakeBookListCacheInvalidator();
        var handler = new RefreshBookCoverHandler(
            repository,
            coverRepository,
            queue,
            storage,
            cacheInvalidator,
            new FakeUser());

        var dto = await handler.Handle(new RefreshBookCoverCommand(book.Id), CancellationToken.None);

        Assert.Equal("Pending", dto.Status);
        Assert.Null(book.Cover!.StoragePath);
        Assert.Null(book.Cover.OriginalImageUrl);
        Assert.Equal(["owner/current.jpg", "owner/current.thumb.jpg"], storage.DeletedPaths);
        Assert.True(repository.Saved);
        Assert.False(coverRepository.Added);
        Assert.Equal(book.Id, queue.QueuedBookId);
        Assert.Equal(book.OwnerId, cacheInvalidator.InvalidatedOwnerId);
    }

    [Fact]
    public async Task DeleteBookCover_ShouldRemoveCoverLinkStorageAndInvalidateCache()
    {
        var book = CreateBook(new BookCover
        {
            BookId = BookId,
            Status = BookCoverStatus.Uploaded,
            Source = BookCoverSource.ManualUrl,
            StoragePath = "owner/book.jpg",
            ThumbnailStoragePath = "owner/book.thumb.jpg",
            OriginalImageUrl = "https://example.com/cover.jpg"
        });
        book.Links.Add(
            new BookLink { Url = "https://example.com/cover.jpg", SourceType = "Cover", Label = "ManualUrl" });
        var repository = new FakeBookRepository(book);
        var coverRepository = new FakeBookCoverRepository();
        var storage = new FakeCoverStorage();
        var cacheInvalidator = new FakeBookListCacheInvalidator();
        var handler = new DeleteBookCoverHandler(
            repository,
            coverRepository,
            storage,
            cacheInvalidator,
            new FakeUser());

        await handler.Handle(new DeleteBookCoverCommand(book.Id), CancellationToken.None);

        Assert.Null(book.Cover);
        Assert.Empty(book.Links);
        Assert.True(coverRepository.Saved);
        Assert.Equal(["owner/book.jpg", "owner/book.thumb.jpg"], storage.DeletedPaths);
        Assert.Equal(book.OwnerId, cacheInvalidator.InvalidatedOwnerId);
    }

    [Fact]
    public async Task DeleteBookCover_ShouldReturnWhenBookHasNoCover()
    {
        var book = CreateBook(hasCover: false);
        var coverRepository = new FakeBookCoverRepository();
        var storage = new FakeCoverStorage();
        var cacheInvalidator = new FakeBookListCacheInvalidator();
        var handler = new DeleteBookCoverHandler(
            new FakeBookRepository(book),
            coverRepository,
            storage,
            cacheInvalidator,
            new FakeUser());

        await handler.Handle(new DeleteBookCoverCommand(book.Id), CancellationToken.None);

        Assert.False(coverRepository.Saved);
        Assert.Empty(storage.DeletedPaths);
        Assert.Null(cacheInvalidator.InvalidatedOwnerId);
    }

    [Fact]
    public async Task GetBookCoverFileHandlers_ShouldReturnOriginalAndThumbnailFiles()
    {
        var cover = new BookCover
        {
            BookId = BookId,
            StoragePath = "owner/book.jpg",
            MimeType = "image/jpeg",
            ThumbnailStoragePath = "owner/book.thumb.webp",
            ThumbnailMimeType = "image/webp"
        };
        var coverRepository = new FakeBookCoverRepository { Cover = cover };
        var storage = new FakeCoverStorage();
        var originalHandler = new GetBookCoverFileHandler(coverRepository, storage, new FakeUser());
        var thumbnailHandler = new GetBookCoverThumbnailFileHandler(coverRepository, storage, new FakeUser());

        var original =
            await originalHandler.Handle(new GetBookCoverFileQuery(BookId), CancellationToken.None);
        var thumbnail =
            await thumbnailHandler.Handle(new GetBookCoverThumbnailFileQuery(BookId), CancellationToken.None);

        Assert.Equal("image/jpeg", original.MimeType);
        Assert.Equal($"{BookId}.jpg", original.FileName);
        Assert.Equal("image/webp", thumbnail.MimeType);
        Assert.Equal($"{BookId}.thumb.webp", thumbnail.FileName);
    }

    [Fact]
    public async Task GetBookCoverFileHandlers_ShouldRejectMissingStorageMetadata()
    {
        var coverRepository = new FakeBookCoverRepository { Cover = new BookCover { BookId = BookId } };
        var storage = new FakeCoverStorage();
        var originalHandler = new GetBookCoverFileHandler(coverRepository, storage, new FakeUser());
        var thumbnailHandler = new GetBookCoverThumbnailFileHandler(coverRepository, storage, new FakeUser());

        await Assert.ThrowsAsync<EntityNotFoundException<BookCover, Guid>>(() =>
            originalHandler.Handle(new GetBookCoverFileQuery(BookId), CancellationToken.None));
        await Assert.ThrowsAsync<EntityNotFoundException<BookCover, Guid>>(() =>
            thumbnailHandler.Handle(new GetBookCoverThumbnailFileQuery(BookId), CancellationToken.None));
    }

    [Fact]
    public async Task LocalBookCoverStorage_ShouldOpenReadAndDeleteStoredFiles()
    {
        var storageRoot = CreateTempStorageRoot();
        try
        {
            var storage =
                new LocalBookCoverStorage(
                    Options.Create(new BookCoverOptions { StorageRoot = storageRoot, MaxBytes = 1024 * 1024 }));
            await using var content = new MemoryStream(CreateTestPngBytes());

            var stored = await storage.SaveAsync(OwnerId, BookId, content, "cover.png", "image/png",
                CancellationToken.None);
            await using (var stream =
                         await storage.OpenReadAsync(stored.Original.StoragePath, CancellationToken.None))
            {
                Assert.True(stream.Length > 0);
            }

            await storage.DeleteIfExistsAsync(stored.Original.StoragePath, CancellationToken.None);
            await storage.DeleteIfExistsAsync(stored.Thumbnail.StoragePath, CancellationToken.None);

            Assert.False(File.Exists(Path.Combine(storageRoot, stored.Original.StoragePath)));
            Assert.False(File.Exists(Path.Combine(storageRoot, stored.Thumbnail.StoragePath)));
        }
        finally
        {
            DeleteTempStorageRoot(storageRoot);
        }
    }

    [Fact]
    public async Task LocalBookCoverStorage_ShouldRejectImagesAbovePixelLimitBeforeDecoding()
    {
        var storageRoot = CreateTempStorageRoot();
        try
        {
            var storage = new LocalBookCoverStorage(Options.Create(new BookCoverOptions
            {
                StorageRoot = storageRoot,
                MaxBytes = 1024 * 1024,
                MaxWidth = 100,
                MaxHeight = 100,
                MaxPixels = 4
            }));
            await using var content = new MemoryStream(CreateTestPngBytes());

            var exception = await Assert.ThrowsAsync<ValidationException>(() =>
                storage.SaveAsync(OwnerId, BookId, content, "cover.png", "image/png", CancellationToken.None));

            Assert.Contains("dimensions exceed", exception.Message, StringComparison.OrdinalIgnoreCase);
            Assert.Empty(Directory.EnumerateFiles(storageRoot, "*", SearchOption.AllDirectories));
        }
        finally
        {
            DeleteTempStorageRoot(storageRoot);
        }
    }

    [Fact]
    public async Task LocalBookCoverStorage_ShouldRejectMissingAndEscapingPaths()
    {
        var storageRoot = CreateTempStorageRoot();
        try
        {
            var storage =
                new LocalBookCoverStorage(
                    Options.Create(new BookCoverOptions { StorageRoot = storageRoot, MaxBytes = 1024 * 1024 }));

            await Assert.ThrowsAsync<EntityNotFoundException<BookCover, Guid>>(() =>
                storage.OpenReadAsync("missing.jpg", CancellationToken.None));
            await Assert.ThrowsAsync<InvalidOperationException>(() =>
                storage.OpenReadAsync("..\\..\\escape.jpg", CancellationToken.None));
        }
        finally
        {
            DeleteTempStorageRoot(storageRoot);
        }
    }

    [Fact]
    public async Task LocalBookCoverStorage_DeleteIfExistsAsync_ShouldIgnoreNullWhitespaceAndMissingFiles()
    {
        var storageRoot = CreateTempStorageRoot();
        try
        {
            var storage =
                new LocalBookCoverStorage(
                    Options.Create(new BookCoverOptions { StorageRoot = storageRoot, MaxBytes = 1024 * 1024 }));

            await storage.DeleteIfExistsAsync(null, CancellationToken.None);
            await storage.DeleteIfExistsAsync("   ", CancellationToken.None);
            await storage.DeleteIfExistsAsync("missing.jpg", CancellationToken.None);
        }
        finally
        {
            DeleteTempStorageRoot(storageRoot);
        }
    }

    [Fact]
    public async Task InMemoryBookCoverQueue_ShouldReturnQueuedBookIds()
    {
        var queue = new InMemoryBookCoverQueue();
        var bookId = Guid.NewGuid();
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(1));

        await queue.QueueAsync(bookId, cts.Token);

        await foreach (var queuedBookId in queue.ReadAllAsync(cts.Token))
        {
            Assert.Equal(bookId, queuedBookId);
            break;
        }
    }

    private static Book CreateBook(BookCover? cover = null, bool hasCover = true)
    {
        return new Book
        {
            Id = BookId,
            OwnerId = OwnerId,
            PrimaryTitle = "I Shall Seal the Heavens",
            NormalizedPrimaryTitle = "ISHALLSEALTHEHEAVENS",
            ContentTypeId = Guid.NewGuid(),
            StatusId = Guid.NewGuid(),
            Cover = hasCover ? cover ?? new BookCover { BookId = BookId } : null
        };
    }

    private static BookCoverRemoteImageService CreateRemoteImageService(string storageRoot, byte[] content,
        string contentType)
    {
        return CreateRemoteImageService(storageRoot, new FakeHttpMessageHandler(content, contentType));
    }

    private static BookCoverRemoteImageService CreateRemoteImageService(string storageRoot, HttpMessageHandler handler)
    {
        var storage = new LocalBookCoverStorage(Options.Create(new BookCoverOptions
        {
            StorageRoot = storageRoot, MaxBytes = 1024
        }));
        var client = new HttpClient(handler);

        return new BookCoverRemoteImageService(new FakeHttpClientFactory(client), storage);
    }

    private static byte[] CreateTestPngBytes()
    {
        using var image = new Image<Rgba32>(2, 3, new Rgba32(255, 0, 0, 128));
        using var buffer = new MemoryStream();
        image.SaveAsPng(buffer);
        return buffer.ToArray();
    }

    private static string CreateTempStorageRoot()
    {
        var root = Path.Combine(Path.GetTempPath(), "tsundoku-cover-tests", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        return root;
    }

    private static void DeleteTempStorageRoot(string storageRoot)
    {
        if (Directory.Exists(storageRoot))
        {
            Directory.Delete(storageRoot, true);
        }
    }

    private sealed class FakeProvider : IBookCoverProvider
    {
        private readonly BookCoverCandidate? _candidate;

        public FakeProvider(BookCoverCandidate? candidate)
        {
            _candidate = candidate;
        }

        public Task<BookCoverCandidate?> FindAsync(Book book, CancellationToken cancellationToken)
        {
            return Task.FromResult(_candidate);
        }
    }

    private sealed class FakeHttpMessageHandler : HttpMessageHandler
    {
        private readonly byte[] _content;
        private readonly string _contentType;
        private readonly HttpStatusCode _statusCode;

        public FakeHttpMessageHandler(string html)
            : this(Encoding.UTF8.GetBytes(html), "text/html")
        {
        }

        public FakeHttpMessageHandler(byte[] content, string contentType)
            : this(content, contentType, HttpStatusCode.OK)
        {
        }

        public FakeHttpMessageHandler(byte[] content, string contentType, HttpStatusCode statusCode)
        {
            _content = content;
            _contentType = contentType;
            _statusCode = statusCode;
        }

        public int RequestCount { get; private set; }

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            RequestCount++;
            var content = new ByteArrayContent(_content);
            content.Headers.ContentType = new MediaTypeHeaderValue(_contentType);

            return Task.FromResult(new HttpResponseMessage(_statusCode) { Content = content });
        }
    }

    private sealed class SequenceHttpMessageHandler : HttpMessageHandler
    {
        private readonly Queue<HttpResponseMessage> _responses;

        public SequenceHttpMessageHandler(params HttpResponseMessage[] responses)
        {
            _responses = new Queue<HttpResponseMessage>(responses);
        }

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            if (_responses.Count == 0)
            {
                throw new InvalidOperationException("No fake responses remaining.");
            }

            return Task.FromResult(_responses.Dequeue());
        }
    }

    private sealed class FakeHttpClientFactory : IHttpClientFactory
    {
        private readonly HttpClient _client;

        public FakeHttpClientFactory(HttpClient client)
        {
            _client = client;
        }

        public HttpClient CreateClient(string name)
        {
            return _client;
        }
    }

    private sealed class FakeUser : IUser
    {
        public Guid? Id => OwnerId;
        public Guid RequiredId => OwnerId;
        public string? Email => "reader@example.com";
        public string? Username => "reader";
        public IEnumerable<string> Roles => Array.Empty<string>();
        public bool IsAuthenticated => true;
        public bool Valid => true;
    }

    private sealed class FakeBookRepository : IBookRepository
    {
        private readonly Book _book;

        public FakeBookRepository(Book book)
        {
            _book = book;
        }

        public bool Saved { get; private set; }

        public Task<Book?> GetByIdAsync(Guid id, Guid ownerId, CancellationToken cancellationToken)
        {
            return Task.FromResult(id == _book.Id && ownerId == _book.OwnerId ? _book : null);
        }

        public Task<Book?> GetByNameAsync(string name, Guid ownerId, Guid contentTypeId,
            CancellationToken cancellationToken)
        {
            return Task.FromResult<Book?>(null);
        }

        public Task<int> GetCountAsync(Guid ownerId, CancellationToken cancellationToken)
        {
            return Task.FromResult(0);
        }

        public Task AddAsync(Book book, CancellationToken cancellationToken)
        {
            return Task.CompletedTask;
        }

        public Task DeleteAsync(Guid id, Guid ownerId, CancellationToken cancellationToken)
        {
            return Task.CompletedTask;
        }

        public Task SaveAsync(CancellationToken cancellationToken)
        {
            Saved = true;
            return Task.CompletedTask;
        }
    }

    private sealed class FakeBookCoverRepository : IBookCoverRepository
    {
        public BookCover? Cover { get; init; }
        public bool Saved { get; private set; }
        public bool Added { get; private set; }

        public Task<BookCover?> GetByBookIdAsync(Guid bookId, Guid ownerId, CancellationToken cancellationToken)
        {
            return Task.FromResult(Cover);
        }

        public Task<BookCover?> GetByBookIdAsync(Guid bookId, CancellationToken cancellationToken)
        {
            return Task.FromResult(Cover);
        }

        public Task<BookCover?> GetByPendingUploadTokenAsync(Guid token, Guid ownerId,
            CancellationToken cancellationToken)
        {
            return Task.FromResult(Cover?.PendingUploadToken == token && Cover.Book.OwnerId == ownerId ? Cover : null);
        }

        public Task<IReadOnlyCollection<BookCover>> GetPendingAsync(int take, CancellationToken cancellationToken)
        {
            return Task.FromResult<IReadOnlyCollection<BookCover>>(Array.Empty<BookCover>());
        }

        public Task AddAsync(BookCover cover, CancellationToken cancellationToken)
        {
            Added = true;
            Saved = true;
            return Task.CompletedTask;
        }

        public Task DeleteAsync(BookCover cover, CancellationToken cancellationToken)
        {
            Saved = true;
            return Task.CompletedTask;
        }

        public Task SaveAsync(CancellationToken cancellationToken)
        {
            Saved = true;
            return Task.CompletedTask;
        }
    }

    private sealed class FakeBookListCacheInvalidator : IBookListCacheInvalidator
    {
        public Guid? InvalidatedOwnerId { get; private set; }

        public Task InvalidateBooksAsync(Guid ownerId, CancellationToken cancellationToken)
        {
            InvalidatedOwnerId = ownerId;
            return Task.CompletedTask;
        }
    }

    private sealed class FakeCoverStorage : IBookCoverStorage
    {
        public List<string> DeletedPaths { get; } = [];

        public Task<BookCoverStoredFiles> SaveAsync(Guid ownerId, Guid bookId, Stream content, string fileName,
            string? contentType, CancellationToken cancellationToken)
        {
            return Task.FromResult(new BookCoverStoredFiles(
                new BookCoverStoredVariant("owner/book.jpg", "image/jpeg", 123, 900, 1350),
                new BookCoverStoredVariant("owner/book.thumb.jpg", "image/jpeg", 45, 500, 750)));
        }

        public Task<Stream> OpenReadAsync(string storagePath, CancellationToken cancellationToken)
        {
            return Task.FromResult<Stream>(new MemoryStream());
        }

        public Task DeleteIfExistsAsync(string? storagePath, CancellationToken cancellationToken)
        {
            if (storagePath != null)
            {
                DeletedPaths.Add(storagePath);
            }

            return Task.CompletedTask;
        }
    }

    private sealed class FakeRemoteImageService : IBookCoverRemoteImageService
    {
        public Task<BookCoverStoredFiles> SaveFromUrlAsync(Guid ownerId, Guid bookId, string imageUrl,
            CancellationToken cancellationToken)
        {
            return Task.FromResult(new BookCoverStoredFiles(
                new BookCoverStoredVariant("owner/book.jpg", "image/jpeg", 123, 900, 1350),
                new BookCoverStoredVariant("owner/book.thumb.jpg", "image/jpeg", 45, 500, 750)));
        }
    }

    private sealed class FakeBookCoverQueue : IBookCoverQueue
    {
        public Guid? QueuedBookId { get; private set; }

        public ValueTask QueueAsync(Guid bookId, CancellationToken cancellationToken)
        {
            QueuedBookId = bookId;
            return ValueTask.CompletedTask;
        }
    }
}
