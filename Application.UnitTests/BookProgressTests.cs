using Application.Common.Interfaces;
using Application.Features.BookFeatures.Commands;
using Domain.Entities;
using Domain.Exceptions;
using Domain.Repositories;

namespace Application.UnitTests;

public class BookProgressTests
{
    private static readonly Guid OwnerId = Guid.Parse("cccccccc-cccc-cccc-cccc-cccccccccccc");

    [Fact]
    public async Task UpdateProgress_ShouldAddHistoryWhenProgressChanges()
    {
        var book = CreateBook();
        var repository = new FakeBookRepository(book);
        var handler = new UpdateBookProgressHandler(repository, new FakeBookListCacheInvalidator(), new FakeUser());

        await handler.Handle(new UpdateBookProgressCommand(book.Id, 20, "20", "updated"), CancellationToken.None);

        Assert.Equal(20, book.CurrentChapterNumber);
        Assert.Single(book.ProgressHistory);
        Assert.Equal("updated", book.ProgressHistory.First().Comment);
        Assert.True(repository.Saved);
    }

    [Fact]
    public async Task UpdateProgress_ShouldNotAddHistoryWhenProgressIsUnchanged()
    {
        var book = CreateBook();
        var repository = new FakeBookRepository(book);
        var handler = new UpdateBookProgressHandler(repository, new FakeBookListCacheInvalidator(), new FakeUser());

        await handler.Handle(new UpdateBookProgressCommand(book.Id, 10, "10", null), CancellationToken.None);

        Assert.Empty(book.ProgressHistory);
    }

    [Fact]
    public async Task UpdateProgress_ShouldUpdateLatestHistoryWhenOnlyCommentChanges()
    {
        var book = CreateBook();
        book.ProgressHistory.Add(new BookProgressHistory
        {
            BookId = book.Id, ChapterNumber = 10, ChapterLabel = "10", Comment = "initial note"
        });
        var repository = new FakeBookRepository(book);
        var handler = new UpdateBookProgressHandler(repository, new FakeBookListCacheInvalidator(), new FakeUser());

        await handler.Handle(new UpdateBookProgressCommand(book.Id, 10, "10", "same chapter note"),
            CancellationToken.None);

        Assert.Equal(10, book.CurrentChapterNumber);
        Assert.Single(book.ProgressHistory);
        Assert.Equal("same chapter note", book.ProgressHistory.First().Comment);
    }

    [Fact]
    public async Task UpdateProgress_ShouldThrowWhenBookDoesNotBelongToUser()
    {
        var repository = new FakeBookRepository(null);
        var handler = new UpdateBookProgressHandler(repository, new FakeBookListCacheInvalidator(), new FakeUser());

        await Assert.ThrowsAsync<EntityNotFoundException<Book, Guid>>(() =>
            handler.Handle(new UpdateBookProgressCommand(Guid.NewGuid(), 20, null, null), CancellationToken.None));
    }

    private static Book CreateBook()
    {
        return new Book
        {
            OwnerId = OwnerId,
            PrimaryTitle = "Novel",
            NormalizedPrimaryTitle = "NOVEL",
            ContentTypeId = Guid.NewGuid(),
            StatusId = Guid.NewGuid(),
            CurrentChapterNumber = 10,
            CurrentChapterLabel = "10"
        };
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
        private readonly Book? _book;

        public FakeBookRepository(Book? book)
        {
            _book = book;
        }

        public bool Saved { get; private set; }

        public Task AddAsync(Book book, CancellationToken cancellationToken)
        {
            return Task.CompletedTask;
        }

        public Task DeleteAsync(Guid id, Guid ownerId, CancellationToken cancellationToken)
        {
            return Task.CompletedTask;
        }

        public Task<Book?> GetByIdAsync(Guid id, Guid ownerId, CancellationToken cancellationToken)
        {
            return Task.FromResult(_book?.OwnerId == ownerId ? _book : null);
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

        public Task<bool> UpdateProgressAsync(Guid id, Guid ownerId, decimal? currentChapterNumber,
            string? currentChapterLabel, string? comment, CancellationToken cancellationToken, bool completed = false)
        {
            if (_book == null || _book.OwnerId != ownerId)
            {
                return Task.FromResult(false);
            }

            var progressChanged = _book.CurrentChapterNumber != currentChapterNumber ||
                                  _book.CurrentChapterLabel != currentChapterLabel;
            var hasComment = !string.IsNullOrWhiteSpace(comment);
            _book.CurrentChapterNumber = currentChapterNumber;
            _book.CurrentChapterLabel = currentChapterLabel;
            if (progressChanged)
            {
                _book.ProgressHistory.Add(new BookProgressHistory
                {
                    BookId = _book.Id,
                    ChapterNumber = currentChapterNumber,
                    ChapterLabel = currentChapterLabel,
                    Comment = comment
                });
            }
            else if (hasComment)
            {
                var latestHistory = _book.ProgressHistory
                    .OrderByDescending(history => history.ChangedAt)
                    .ThenByDescending(history => history.Id)
                    .FirstOrDefault();

                if (latestHistory is not null && latestHistory.ChapterNumber == currentChapterNumber &&
                    latestHistory.ChapterLabel == currentChapterLabel)
                {
                    latestHistory.Comment = comment;
                }
                else
                {
                    _book.ProgressHistory.Add(new BookProgressHistory
                    {
                        BookId = _book.Id,
                        ChapterNumber = currentChapterNumber,
                        ChapterLabel = currentChapterLabel,
                        Comment = comment
                    });
                }
            }

            Saved = true;
            return Task.FromResult(true);
        }

        public Task SaveAsync(CancellationToken cancellationToken)
        {
            Saved = true;
            return Task.CompletedTask;
        }
    }

    private sealed class FakeBookListCacheInvalidator : IBookListCacheInvalidator
    {
        public Task InvalidateBooksAsync(Guid ownerId, CancellationToken cancellationToken)
        {
            return Task.CompletedTask;
        }
    }
}
