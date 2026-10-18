namespace Infrastructure.Contexts;

using BookSearch;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using NpgsqlTypes;

public class ApplicationDbContext : IdentityDbContext<User, IdentityRole<Guid>, Guid>
{
    private readonly IUser _user;

    public ApplicationDbContext(DbContextOptions<ApplicationDbContext> options, IUser user)
        : base(options)
    {
        _user = user;
    }

    public DbSet<Book> Books { get; set; }
    public DbSet<BookFile> BookFiles { get; set; }
    public DbSet<CrawlerJob> CrawlerJobs { get; set; }
    public DbSet<BookCrawlerSource> BookCrawlerSources { get; set; }
    public DbSet<BookCrawlerDiscovery> BookCrawlerDiscoveries { get; set; }
    public DbSet<PublicBookFile> PublicBookFiles { get; set; }
    public DbSet<BookFileJob> BookFileJobs { get; set; }
    public DbSet<BookFileDownloadTicket> BookFileDownloadTickets { get; set; }
    public DbSet<BookCover> BookCovers { get; set; }
    public DbSet<BookTitle> BookTitles { get; set; }
    public DbSet<BookLink> BookLinks { get; set; }
    public DbSet<BookProgressHistory> BookProgressHistory { get; set; }
    public DbSet<ReadingTimeSetting> ReadingTimeSettings { get; set; }
    public DbSet<RefreshToken> RefreshTokens { get; set; }
    public DbSet<Author> Authors { get; set; }
    public DbSet<AuthorName> AuthorNames { get; set; }
    public DbSet<Genre> Genres { get; set; }
    public DbSet<Status> Statuses { get; set; }
    public DbSet<ContentType> ContentTypes { get; set; }
    public DbSet<Tag> Tags { get; set; }
    public DbSet<PublicBookSnapshot> PublicBookSnapshots { get; set; }
    public DbSet<BookShareAuthorPromotion> BookShareAuthorPromotions { get; set; }
    public DbSet<BookShareTagPromotion> BookShareTagPromotions { get; set; }
    public DbSet<StorageCleanupQueueItem> StorageCleanupQueueItems { get; set; }
    public DbSet<BookSearchIndexQueueItem> BookSearchIndexQueueItems { get; set; }

    public override Task<int> SaveChangesAsync(CancellationToken cancellationToken = new())
    {
        foreach (var entry in ChangeTracker.Entries<BaseAuditableEntity>())
        {
            switch (entry.State)
            {
                case EntityState.Added:
                    var now = DateTimeOffset.UtcNow;
                    entry.Entity.Created = now;
                    entry.Entity.CreatedBy = _user.Id;
                    entry.Entity.LastModified = now;
                    entry.Entity.LastModifiedBy = _user.Id;
                    if (entry.Entity is Book book && book.LastProgressUpdatedAt == default)
                    {
                        book.LastProgressUpdatedAt = now;
                    }

                    break;

                case EntityState.Modified:
                    entry.Entity.LastModified = DateTimeOffset.UtcNow;
                    entry.Entity.LastModifiedBy = _user.Id;
                    break;
            }
        }

        return base.SaveChangesAsync(cancellationToken);
    }

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        ConfigureBook(modelBuilder, Database.IsNpgsql());
        ConfigureBookFiles(modelBuilder);
        modelBuilder.Entity<CrawlerJob>(e =>
        {
            e.HasOne<Book>().WithMany().HasForeignKey(j => j.BookId).OnDelete(DeleteBehavior.Cascade);
            e.Property(j => j.Kind).HasMaxLength(20);
            e.Property(j => j.Status).HasMaxLength(20);
            e.Property(j => j.RequestKey).HasMaxLength(100);
            e.HasIndex(j => new { j.OwnerId, j.Kind, j.RequestKey }).IsUnique();
            e.HasIndex(j => new { j.Status, j.NextAttemptAtUtc });
            e.Property(j => j.ResultJson).IsConcurrencyToken();
        });
        modelBuilder.Entity<BookCrawlerSource>(e =>
        {
            e.HasOne<Book>().WithMany().HasForeignKey(s => s.BookId).OnDelete(DeleteBehavior.Cascade);
            e.Property(s => s.Url).HasMaxLength(2000);
            e.HasIndex(s => new { s.BookId, s.Url }).IsUnique();
            e.HasIndex(s => new { s.Tracked, s.NextScanAtUtc });
        });
        modelBuilder.Entity<BookCrawlerDiscovery>(e =>
        {
            e.HasOne<Book>().WithMany().HasForeignKey(s => s.BookId).OnDelete(DeleteBehavior.Cascade);
            e.HasIndex(s => s.BookId).IsUnique();
            e.HasIndex(s => s.NextCheckAtUtc);
        });
        modelBuilder.Entity<MetadataAlias>(e =>
        {
            e.Property(a => a.SourceKind).HasMaxLength(5);
            e.Property(a => a.Name).HasMaxLength(100);
            e.Property(a => a.NormalizedName).HasMaxLength(100);
            e.HasIndex(a => new { a.SourceKind, a.NormalizedName }).IsUnique();
            e.HasOne<Tag>().WithMany().HasForeignKey(a => a.TagId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne<Genre>().WithMany().HasForeignKey(a => a.GenreId).OnDelete(DeleteBehavior.Cascade);
            e.ToTable(t => {
                t.HasCheckConstraint("CK_MetadataAlias_Kind", "\"SourceKind\" IN ('tag', 'genre')");
                t.HasCheckConstraint("CK_MetadataAlias_Target", "(\"TagId\" IS NULL) <> (\"GenreId\" IS NULL)");
            });
        });
        modelBuilder.Entity<MetadataImplication>(e =>
        {
            e.HasOne<Tag>().WithMany().HasForeignKey(a => a.SourceTagId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne<Genre>().WithMany().HasForeignKey(a => a.SourceGenreId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne<Tag>().WithMany().HasForeignKey(a => a.TargetTagId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne<Genre>().WithMany().HasForeignKey(a => a.TargetGenreId).OnDelete(DeleteBehavior.Cascade);
            e.ToTable(t => {
                t.HasCheckConstraint("CK_MetadataImplication_Source", "(\"SourceTagId\" IS NULL) <> (\"SourceGenreId\" IS NULL)");
                t.HasCheckConstraint("CK_MetadataImplication_Target", "(\"TargetTagId\" IS NULL) <> (\"TargetGenreId\" IS NULL)");
            });
        });
        ConfigureAuthor(modelBuilder);
        ConfigureGenre(modelBuilder);
        ConfigureStatus(modelBuilder);
        ConfigureContentType(modelBuilder);
        ConfigureTag(modelBuilder);
        ConfigurePublicBooks(modelBuilder);
        ConfigureStorageCleanupQueue(modelBuilder);
        ConfigureBookSearchIndexQueue(modelBuilder);
        ConfigureReadingTimeSettings(modelBuilder);
        if (Database.IsNpgsql())
        {
            ConfigureBookSearchFunctions(modelBuilder);
        }

        ConfigureIdentity(modelBuilder);
        SeedSystemDictionaries(modelBuilder);
    }

    private static void ConfigureBookFiles(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<BookFile>(entity =>
        {
            entity.HasOne<Book>().WithMany().HasForeignKey(f => f.BookId).OnDelete(DeleteBehavior.Cascade);
            entity.HasIndex(f => new { f.BookId, f.SortOrder });
            entity.HasIndex(f => new { f.OwnerId, f.DeletedAtUtc });
            entity.HasIndex(f => new { f.BookId, f.Sha256 }).IsUnique().HasFilter("\"DeletedAtUtc\" IS NULL");
            entity.Property(f => f.StoragePath).HasMaxLength(500);
            entity.Property(f => f.OriginalFileName).HasMaxLength(250);
            entity.Property(f => f.Title).HasMaxLength(250);
            entity.Property(f => f.FirstContentLabel).HasMaxLength(500);
            entity.Property(f => f.LastContentLabel).HasMaxLength(500);
            entity.Property(f => f.Sha256).HasMaxLength(64);
            entity.Property(f => f.MimeType).HasMaxLength(100);
            entity.ToTable(t => t.HasCheckConstraint("CK_BookFiles_Size", "\"SizeBytes\" > 0"));
        });
        modelBuilder.Entity<PublicBookFile>(entity =>
        {
            entity.HasKey(f => new { f.SnapshotId, f.BookFileId });
            entity.HasOne<PublicBookSnapshot>().WithMany().HasForeignKey(f => f.SnapshotId)
                .OnDelete(DeleteBehavior.Cascade);
            entity.HasOne<BookFile>().WithMany().HasForeignKey(f => f.BookFileId).OnDelete(DeleteBehavior.Cascade);
        });
        modelBuilder.Entity<BookFileJob>(entity =>
        {
            entity.Property(j => j.Kind).HasMaxLength(30);
            entity.Property(j => j.Status).HasMaxLength(30).IsConcurrencyToken();
            entity.Property(j => j.UpdatedAtUtc).IsConcurrencyToken();
            entity.Property(j => j.Error).HasMaxLength(2000);
            entity.HasIndex(j => new { j.Status, j.CreatedAtUtc });
            entity.HasIndex(j => new { j.OwnerId, j.ExpiresAtUtc });
        });
        modelBuilder.Entity<BookFileDownloadTicket>(entity =>
        {
            entity.Property(t => t.TokenHash).HasMaxLength(64);
            entity.HasIndex(t => t.ExpiresAtUtc);
        });
    }

    private static void ConfigureBook(ModelBuilder modelBuilder, bool isPostgres)
    {
        modelBuilder.Entity<Book>(entity =>
        {
            entity.ToTable(table => table.HasCheckConstraint(
                "CK_Books_NormalizedPrimaryTitle_NoSpaces",
                "\"NormalizedPrimaryTitle\" = replace(\"NormalizedPrimaryTitle\", ' ', '')"));
            entity.HasIndex(b => new { b.OwnerId, b.NormalizedPrimaryTitle, b.ContentTypeId }).IsUnique();
            entity.HasIndex(b => new { b.OwnerId, b.CurrentChapterNumber });
            entity.HasIndex(b => new { b.OwnerId, b.Rating });
            entity.HasIndex(b => new { b.OwnerId, b.Priority });
            entity.HasIndex(b => new { b.OwnerId, b.Created });
            entity.HasIndex(b => new { b.OwnerId, b.LastProgressUpdatedAt });
            entity.HasIndex(b => new { b.OwnerId, b.StatusId });
            entity.HasIndex(b => new { b.OwnerId, b.ContentTypeId });

            entity.Property(b => b.PrimaryTitle).HasMaxLength(500);
            entity.Property(b => b.NormalizedPrimaryTitle).HasMaxLength(500);
            entity.Property(b => b.SearchDocument).HasDefaultValue(string.Empty);
            if (isPostgres)
            {
                entity.Property<NpgsqlTsVector>("SearchVector")
                    .HasColumnType("tsvector")
                    .IsRequired()
                    .HasDefaultValueSql("''::tsvector");
            }

            entity.Property(b => b.CurrentChapterLabel).HasMaxLength(100);

            entity.HasOne(b => b.Author)
                .WithMany(a => a.Books)
                .HasForeignKey(b => b.AuthorId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(b => b.ContentType)
                .WithMany(t => t.Books)
                .HasForeignKey(b => b.ContentTypeId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(b => b.Status)
                .WithMany(s => s.Books)
                .HasForeignKey(b => b.StatusId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne<User>()
                .WithMany(u => u.Books)
                .HasForeignKey(b => b.OwnerId)
                .IsRequired()
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<BookCover>(entity =>
        {
            entity.HasIndex(c => c.BookId).IsUnique();
            entity.HasIndex(c => new { c.BookId, c.Status, c.Source });
            entity.HasIndex(c => c.PendingUploadToken).IsUnique().HasFilter("\"PendingUploadToken\" IS NOT NULL");
            entity.Property(c => c.Status).HasConversion<string>().HasMaxLength(32);
            entity.Property(c => c.Source).HasConversion<string>().HasMaxLength(32);
            entity.Property(c => c.StoragePath).HasMaxLength(500);
            entity.Property(c => c.ThumbnailStoragePath).HasMaxLength(500);
            entity.Property(c => c.OriginalImageUrl).HasMaxLength(2000);
            entity.Property(c => c.MimeType).HasMaxLength(100);
            entity.Property(c => c.ThumbnailMimeType).HasMaxLength(100);
            entity.Property(c => c.FailureReason).HasMaxLength(1000);
            entity.HasOne(c => c.Book)
                .WithOne(b => b.Cover)
                .HasForeignKey<BookCover>(c => c.BookId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<BookTitle>(entity =>
        {
            entity.ToTable(table => table.HasCheckConstraint(
                "CK_BookTitles_NormalizedTitle_NoSpaces",
                "\"NormalizedTitle\" = replace(\"NormalizedTitle\", ' ', '')"));
            entity.HasIndex(t => t.NormalizedTitle);
            entity.HasIndex(t => new { t.BookId, t.NormalizedTitle }).IsUnique();
            entity.HasIndex(t => new { t.BookId, t.IsPrimary });
            entity.Property(t => t.Title).HasMaxLength(500);
            entity.Property(t => t.NormalizedTitle).HasMaxLength(500);
            entity.Property(t => t.Language).HasMaxLength(10);
            entity.Property(t => t.Source).HasMaxLength(50);
            entity.HasOne(t => t.Book)
                .WithMany(b => b.Titles)
                .HasForeignKey(t => t.BookId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<BookLink>(entity =>
        {
            entity.HasIndex(l => new { l.BookId, l.SourceType });
            entity.Property(l => l.Url).HasMaxLength(2000);
            entity.Property(l => l.Label).HasMaxLength(200);
            entity.Property(l => l.SourceType).HasMaxLength(50);
            entity.HasOne(l => l.Book)
                .WithMany(b => b.Links)
                .HasForeignKey(l => l.BookId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<BookProgressHistory>(entity =>
        {
            entity.HasIndex(h => new { h.BookId, h.ChangedAt, h.Id });
            entity.Property(h => h.ChapterLabel).HasMaxLength(100);
            entity.Property(h => h.Comment).HasMaxLength(1000);
            entity.HasOne(h => h.Book)
                .WithMany(b => b.ProgressHistory)
                .HasForeignKey(h => h.BookId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<BookGenre>(entity =>
        {
            entity.HasKey(e => new { e.BookId, e.GenreId });
            entity.HasOne(e => e.Book)
                .WithMany(b => b.BookGenres)
                .HasForeignKey(e => e.BookId)
                .OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(e => e.Genre)
                .WithMany(g => g.BookGenres)
                .HasForeignKey(e => e.GenreId)
                .OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<BookTag>(entity =>
        {
            entity.HasKey(e => new { e.BookId, e.TagId });
            entity.HasOne(e => e.Book)
                .WithMany(b => b.BookTags)
                .HasForeignKey(e => e.BookId)
                .OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(e => e.Tag)
                .WithMany(t => t.BookTags)
                .HasForeignKey(e => e.TagId)
                .OnDelete(DeleteBehavior.Cascade);
        });
    }

    private static void ConfigureAuthor(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Author>(entity =>
        {
            entity.ToTable(table => table.HasCheckConstraint(
                "CK_Authors_NormalizedPrimaryName_NoSpaces",
                "\"NormalizedPrimaryName\" = replace(\"NormalizedPrimaryName\", ' ', '')"));
            entity.HasIndex(a => a.NormalizedPrimaryName)
                .IsUnique()
                .HasFilter("\"IsPublic\" = TRUE");
            entity.HasIndex(a => new { a.OwnerId, a.NormalizedPrimaryName })
                .IsUnique()
                .HasFilter("\"IsPublic\" = FALSE");
            entity.Property(a => a.PrimaryName).HasMaxLength(300);
            entity.Property(a => a.NormalizedPrimaryName).HasMaxLength(300);
            entity.HasOne<User>()
                .WithMany(user => user.OwnedAuthors)
                .HasForeignKey(a => a.OwnerId)
                .OnDelete(DeleteBehavior.SetNull);
        });

        modelBuilder.Entity<AuthorName>(entity =>
        {
            entity.ToTable(table => table.HasCheckConstraint(
                "CK_AuthorNames_NormalizedName_NoSpaces",
                "\"NormalizedName\" = replace(\"NormalizedName\", ' ', '')"));
            entity.HasIndex(a => new { a.AuthorId, a.NormalizedName }).IsUnique();
            entity.Property(a => a.Name).HasMaxLength(300);
            entity.Property(a => a.NormalizedName).HasMaxLength(300);
            entity.Property(a => a.Language).HasMaxLength(10);
            entity.Property(a => a.Source).HasMaxLength(50);
            entity.HasOne(a => a.Author)
                .WithMany(a => a.Names)
                .HasForeignKey(a => a.AuthorId)
                .OnDelete(DeleteBehavior.Cascade);
        });
    }

    private static void ConfigureGenre(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Genre>(entity =>
        {
            entity.ToTable(table => table.HasCheckConstraint(
                "CK_Genres_NormalizedName_NoSpaces",
                "\"NormalizedName\" = replace(\"NormalizedName\", ' ', '')"));
            entity.HasIndex(g => g.NormalizedName).IsUnique();
            entity.Property(g => g.Name).HasMaxLength(100);
            entity.Property(g => g.NormalizedName).HasMaxLength(100);
        });
    }

    private static void ConfigureStatus(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Status>(entity =>
        {
            entity.HasIndex(s => s.Slug).IsUnique();
            entity.Property(s => s.Name).HasMaxLength(100);
            entity.Property(s => s.Slug).HasMaxLength(100);
        });
    }

    private static void ConfigureContentType(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<ContentType>(entity =>
        {
            entity.HasIndex(t => t.Slug).IsUnique();
            entity.Property(t => t.Name).HasMaxLength(100);
            entity.Property(t => t.Slug).HasMaxLength(100);
        });
    }

    private static void ConfigureTag(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Tag>(entity =>
        {
            entity.ToTable(table => table.HasCheckConstraint(
                "CK_Tags_NormalizedName_NoSpaces",
                "\"NormalizedName\" = replace(\"NormalizedName\", ' ', '')"));
            entity.HasIndex(t => new { t.OwnerId, t.NormalizedName }).IsUnique();
            entity.HasIndex(t => t.NormalizedName)
                .IsUnique()
                .HasFilter("\"IsGlobal\" = TRUE");
            entity.Property(t => t.Name).HasMaxLength(100);
            entity.Property(t => t.NormalizedName).HasMaxLength(100);
            entity.Property(t => t.Color).HasMaxLength(32);
            entity.HasOne<User>()
                .WithMany(u => u.OwnedTags)
                .HasForeignKey(t => t.OwnerId)
                .OnDelete(DeleteBehavior.Cascade)
                .IsRequired(false);
        });
    }

    private static void ConfigureReadingTimeSettings(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<ReadingTimeSetting>(entity =>
        {
            entity.HasIndex(setting => new { setting.UserId, setting.ContentTypeId }).IsUnique();
            entity.Property(setting => setting.MinutesPerChapter).HasPrecision(6, 2);
            entity.ToTable(table => table.HasCheckConstraint(
                "CK_ReadingTimeSettings_MinutesPerChapter_Range",
                "CAST(\"MinutesPerChapter\" AS REAL) >= 0 AND CAST(\"MinutesPerChapter\" AS REAL) <= 1440"));
            entity.HasOne(setting => setting.ContentType)
                .WithMany()
                .HasForeignKey(setting => setting.ContentTypeId)
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<User>()
                .WithMany()
                .HasForeignKey(setting => setting.UserId)
                .OnDelete(DeleteBehavior.Cascade);
        });
    }

    private static void ConfigurePublicBooks(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<PublicBookSnapshot>(entity =>
        {
            entity.ToTable(table => table.HasCheckConstraint(
                "CK_PublicBookSnapshots_NormalizedPrimaryTitle_NoSpaces",
                "\"NormalizedPrimaryTitle\" = replace(\"NormalizedPrimaryTitle\", ' ', '')"));
            entity.HasIndex(snapshot => snapshot.SourceBookId).IsUnique();
            entity.HasIndex(snapshot => snapshot.NormalizedPrimaryTitle);
            entity.HasIndex(snapshot => new { snapshot.OwnerId, snapshot.SnapshotAt });
            entity.Property(snapshot => snapshot.PrimaryTitle).HasMaxLength(500);
            entity.Property(snapshot => snapshot.NormalizedPrimaryTitle).HasMaxLength(500);
            entity.Property(snapshot => snapshot.AuthorName).HasMaxLength(300);
            entity.Property(snapshot => snapshot.ContentType).HasMaxLength(100);
            entity.Property(snapshot => snapshot.CoverStoragePath).HasMaxLength(500);
            entity.Property(snapshot => snapshot.CoverThumbnailStoragePath).HasMaxLength(500);
            entity.Property(snapshot => snapshot.CoverMimeType).HasMaxLength(100);
            entity.Property(snapshot => snapshot.SnapshotAt).IsConcurrencyToken();
            entity.HasOne(snapshot => snapshot.SourceBook).WithOne()
                .HasForeignKey<PublicBookSnapshot>(snapshot => snapshot.SourceBookId)
                .OnDelete(DeleteBehavior.Cascade);
            entity.HasOne<User>().WithMany().HasForeignKey(snapshot => snapshot.OwnerId)
                .OnDelete(DeleteBehavior.Cascade);
        });
        modelBuilder.Entity<BookShareAuthorPromotion>(entity =>
        {
            entity.HasKey(promotion => promotion.AuthorId);
            entity.HasOne(promotion => promotion.Author).WithOne()
                .HasForeignKey<BookShareAuthorPromotion>(promotion => promotion.AuthorId)
                .OnDelete(DeleteBehavior.Cascade);
        });
        modelBuilder.Entity<BookShareTagPromotion>(entity =>
        {
            entity.HasKey(promotion => promotion.TagId);
            entity.HasOne(promotion => promotion.Tag).WithOne()
                .HasForeignKey<BookShareTagPromotion>(promotion => promotion.TagId)
                .OnDelete(DeleteBehavior.Cascade);
        });
    }

    private static void ConfigureIdentity(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<RefreshToken>(entity =>
        {
            entity.HasIndex(t => t.TokenHash).IsUnique();
            entity.Property(t => t.TokenHash).HasMaxLength(200);
            entity.Property(t => t.ReplacedByTokenHash).HasMaxLength(200);
            entity.Property(t => t.ReasonRevoked).HasMaxLength(200);
            entity.HasOne<User>()
                .WithMany(u => u.RefreshTokens)
                .HasForeignKey(t => t.UserId)
                .OnDelete(DeleteBehavior.Cascade);
        });
    }

    private static void ConfigureStorageCleanupQueue(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<StorageCleanupQueueItem>(entity =>
        {
            entity.HasIndex(item => new { item.StorageKind, item.StoragePath }).IsUnique();
            entity.Property(item => item.StorageKind).HasMaxLength(30).HasDefaultValue("Cover");
            entity.HasIndex(item => item.NextAttemptAt);
            entity.Property(item => item.StoragePath).HasMaxLength(500);
            entity.Property(item => item.LastError).HasMaxLength(2000);
        });
    }

    private static void ConfigureBookSearchIndexQueue(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<BookSearchIndexQueueItem>(entity =>
        {
            entity.HasKey(item => item.BookId);
            entity.HasIndex(item => new { item.NextAttemptAt, item.LeaseUntil });
            entity.Property(item => item.LastError).HasMaxLength(2000);
            entity.HasOne(item => item.Book)
                .WithOne()
                .HasForeignKey<BookSearchIndexQueueItem>(item => item.BookId)
                .OnDelete(DeleteBehavior.Cascade);
        });
    }

    private static void ConfigureBookSearchFunctions(ModelBuilder modelBuilder)
    {
        var method = typeof(BookSearchDbFunctions).GetMethod(
            nameof(BookSearchDbFunctions.HasCloseLexeme),
            [typeof(NpgsqlTsVector), typeof(string)])!;

        modelBuilder.HasDbFunction(method)
            .HasName("book_search_has_close_lexeme")
            .HasSchema("public");
    }

    private static void SeedSystemDictionaries(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<ContentType>().HasData(
            new ContentType { Id = Guid.Parse("10000000-0000-0000-0000-000000000001"), Name = "Novel", Slug = "novel" },
            new ContentType { Id = Guid.Parse("10000000-0000-0000-0000-000000000002"), Name = "Manga", Slug = "manga" },
            new ContentType
            {
                Id = Guid.Parse("10000000-0000-0000-0000-000000000003"), Name = "Manhwa", Slug = "manhwa"
            },
            new ContentType
            {
                Id = Guid.Parse("10000000-0000-0000-0000-000000000004"), Name = "Manhua", Slug = "manhua"
            },
            new ContentType { Id = Guid.Parse("10000000-0000-0000-0000-000000000005"), Name = "Other", Slug = "other" }
        );

        modelBuilder.Entity<Status>().HasData(
            new Status
            {
                Id = Guid.Parse("20000000-0000-0000-0000-000000000001"),
                Name = "Reading",
                Slug = "reading",
                SortOrder = 10
            },
            new Status
            {
                Id = Guid.Parse("20000000-0000-0000-0000-000000000002"),
                Name = "Completed",
                Slug = "completed",
                SortOrder = 20
            },
            new Status
            {
                Id = Guid.Parse("20000000-0000-0000-0000-000000000003"),
                Name = "Plan To Read",
                Slug = "plan-to-read",
                SortOrder = 30
            },
            new Status
            {
                Id = Guid.Parse("20000000-0000-0000-0000-000000000004"),
                Name = "On Hold",
                Slug = "on-hold",
                SortOrder = 40
            },
            new Status
            {
                Id = Guid.Parse("20000000-0000-0000-0000-000000000005"),
                Name = "Dropped",
                Slug = "dropped",
                SortOrder = 50
            },
            new Status
            {
                Id = Guid.Parse("20000000-0000-0000-0000-000000000006"),
                Name = "Unknown",
                Slug = "unknown",
                SortOrder = 60
            }
        );
    }
}
