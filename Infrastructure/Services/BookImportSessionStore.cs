namespace Infrastructure.Services;

using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

public sealed class BookImportSessionStore : IDisposable
{
    private readonly object _gate = new();
    private readonly string _instanceRoot;
    private readonly ILogger<BookImportSessionStore>? _logger;
    private readonly BookImportSecurityOptions _options;
    private readonly Dictionary<Guid, int> _pendingFullSessionsByOwner = [];
    private readonly Dictionary<Guid, ImportSession> _sessions = [];
    private bool _disposed;
    private int _pendingFullSessions;
    private long _reservedStagedBytes;

    public BookImportSessionStore(IOptions<BookImportSecurityOptions> options,
        ILogger<BookImportSessionStore>? logger = null)
    {
        _options = options.Value;
        _logger = logger;
        var baseRoot = Path.Combine(Path.GetTempPath(), "tsundoku-book-imports");
        Directory.CreateDirectory(baseRoot);
        RemoveOldInstanceDirectories(baseRoot, _options.SessionAbsoluteLifetime);
        _instanceRoot = Path.Combine(baseRoot, $"{Environment.ProcessId}-{Guid.NewGuid():N}");
        Directory.CreateDirectory(_instanceRoot);
    }

    public int ActiveFullSessionCount
    {
        get
        {
            lock (_gate)
            {
                return _sessions.Values.Count(session => session.IsFullImport);
            }
        }
    }

    public long ReservedStagedBytes
    {
        get
        {
            lock (_gate)
            {
                return _reservedStagedBytes;
            }
        }
    }

    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        ImportSession[] sessions;
        lock (_gate)
        {
            sessions = _sessions.Values.ToArray();
            _sessions.Clear();
        }

        DeleteDirectoryIfSafe(_instanceRoot);
    }

    internal FullSessionReservation ReserveFullSession(Guid ownerId, long reservedBytes)
    {
        CleanupExpired();
        lock (_gate)
        {
            var activeGlobal = _sessions.Values.Count(session => session.IsFullImport) + _pendingFullSessions;
            var activeForOwner = _sessions.Values.Count(session => session.IsFullImport && session.OwnerId == ownerId) +
                                 _pendingFullSessionsByOwner.GetValueOrDefault(ownerId);
            var allActiveGlobal = _sessions.Count + _pendingFullSessions;
            var allActiveForOwner = _sessions.Values.Count(session => session.OwnerId == ownerId) +
                                    _pendingFullSessionsByOwner.GetValueOrDefault(ownerId);
            if (allActiveGlobal >= _options.MaxActiveSessionsGlobal ||
                allActiveForOwner >= _options.MaxActiveSessionsPerUser)
            {
                throw new ImportCapacityExceededException(
                    "The maximum number of active import drafts has been reached. Finalize or cancel an existing draft first.");
            }

            if (activeGlobal >= _options.MaxActiveFullSessionsGlobal)
            {
                throw new FullImportCapacityExceededException(
                    "The server has reached the maximum number of active full import drafts. Try again later.");
            }

            if (activeForOwner >= _options.MaxActiveFullSessionsPerUser)
            {
                throw new FullImportCapacityExceededException(
                    "You already have the maximum number of active full import drafts. Finalize or cancel the existing draft first.");
            }

            if (reservedBytes <= 0 || reservedBytes > _options.MaxStagedBytesGlobal ||
                _reservedStagedBytes > _options.MaxStagedBytesGlobal - reservedBytes)
            {
                throw new FullImportCapacityExceededException(
                    "The server has reached the temporary storage limit for full imports. Try again later.");
            }

            _pendingFullSessions++;
            _pendingFullSessionsByOwner[ownerId] = _pendingFullSessionsByOwner.GetValueOrDefault(ownerId) + 1;
            _reservedStagedBytes += reservedBytes;
            return new FullSessionReservation(this, ownerId, reservedBytes);
        }
    }

    internal string CreateSessionDirectory(Guid sessionId)
    {
        var path = Path.Combine(_instanceRoot, sessionId.ToString("N"));
        EnsureWithinInstanceRoot(path);
        Directory.CreateDirectory(path);
        return path;
    }

    internal void Add(ImportSession session)
    {
        CleanupExpired();
        lock (_gate)
        {
            if (_sessions.Count + _pendingFullSessions >= _options.MaxActiveSessionsGlobal ||
                _sessions.Values.Count(existing => existing.OwnerId == session.OwnerId) +
                _pendingFullSessionsByOwner.GetValueOrDefault(session.OwnerId) >=
                _options.MaxActiveSessionsPerUser)
            {
                throw new ImportCapacityExceededException(
                    "The maximum number of active import drafts has been reached. Finalize or cancel an existing draft first.");
            }

            if (!_sessions.TryAdd(session.SessionId, session))
            {
                throw new InvalidOperationException("Import session identifier collision.");
            }
        }
    }

    internal ImportSession GetOwned(Guid sessionId, Guid ownerId)
    {
        CleanupExpired();
        lock (_gate)
        {
            if (!_sessions.TryGetValue(sessionId, out var session) || session.OwnerId != ownerId)
            {
                throw new ValidationException("Import session not found or expired.");
            }

            session.LastAccessAt = DateTimeOffset.UtcNow;
            return session;
        }
    }

    public void Remove(Guid sessionId)
    {
        ImportSession? removed;
        lock (_gate)
        {
            _sessions.Remove(sessionId, out removed);
        }

        DeleteSessionFiles(removed);
    }

    internal void DeleteUncommittedDirectory(string? path)
    {
        if (!string.IsNullOrWhiteSpace(path))
        {
            DeleteDirectoryIfSafe(path);
        }
    }

    public void CleanupExpired()
    {
        List<ImportSession> expired;
        lock (_gate)
        {
            expired = CleanupExpiredLocked(DateTimeOffset.UtcNow);
        }

        foreach (var session in expired)
        {
            DeleteSessionFiles(session);
        }

        if (expired.Count > 0)
        {
            _logger?.LogInformation("Removed {Count} expired book import sessions.", expired.Count);
        }
    }

    private List<ImportSession> CleanupExpiredLocked(DateTimeOffset now)
    {
        var expired = _sessions.Values
            .Where(session => now - session.LastAccessAt >= _options.SessionIdleTimeout ||
                              now - session.CreatedAt >= _options.SessionAbsoluteLifetime)
            .ToList();
        foreach (var session in expired)
        {
            _sessions.Remove(session.SessionId);
        }

        return expired;
    }

    private void CommitReservation(FullSessionReservation reservation, ImportSession session)
    {
        lock (_gate)
        {
            ReleaseReservationLocked(reservation.OwnerId, reservation.ReservedBytes);
            reservation.MarkCommitted();
            if (_reservedStagedBytes > _options.MaxStagedBytesGlobal - session.StagedBytes)
            {
                throw new FullImportCapacityExceededException(
                    "The server has reached the temporary storage limit for full imports. Try again later.");
            }

            _reservedStagedBytes += session.StagedBytes;
            session.ReservedStagedBytes = session.StagedBytes;
            if (!_sessions.TryAdd(session.SessionId, session))
            {
                _reservedStagedBytes -= session.StagedBytes;
                throw new InvalidOperationException("Import session identifier collision.");
            }
        }
    }

    private void ReleaseReservation(FullSessionReservation reservation)
    {
        lock (_gate)
        {
            ReleaseReservationLocked(reservation.OwnerId, reservation.ReservedBytes);
        }
    }

    private void ReleaseReservationLocked(Guid ownerId, long reservedBytes)
    {
        _pendingFullSessions = Math.Max(0, _pendingFullSessions - 1);
        var ownerCount = _pendingFullSessionsByOwner.GetValueOrDefault(ownerId) - 1;
        if (ownerCount <= 0)
        {
            _pendingFullSessionsByOwner.Remove(ownerId);
        }
        else
        {
            _pendingFullSessionsByOwner[ownerId] = ownerCount;
        }

        _reservedStagedBytes = Math.Max(0, _reservedStagedBytes - reservedBytes);
    }

    private void DeleteSessionFiles(ImportSession? session)
    {
        if (session == null)
        {
            return;
        }

        lock (_gate)
        {
            _reservedStagedBytes = Math.Max(0, _reservedStagedBytes - session.ReservedStagedBytes);
            session.ReservedStagedBytes = 0;
        }

        if (!string.IsNullOrWhiteSpace(session.TempDirectory))
        {
            DeleteDirectoryIfSafe(session.TempDirectory);
        }
    }

    private void DeleteDirectoryIfSafe(string path)
    {
        try
        {
            EnsureWithinInstanceRoot(path);
            if (Directory.Exists(path))
            {
                Directory.Delete(path, true);
            }
        }
        catch (IOException ex)
        {
            _logger?.LogWarning(ex, "Could not remove import staging directory {Path}.", path);
        }
        catch (UnauthorizedAccessException ex)
        {
            _logger?.LogWarning(ex, "Could not remove import staging directory {Path}.", path);
        }
    }

    private void EnsureWithinInstanceRoot(string path)
    {
        var root = Path.GetFullPath(_instanceRoot) + Path.DirectorySeparatorChar;
        var fullPath = Path.GetFullPath(path);
        if (!fullPath.StartsWith(root, StringComparison.OrdinalIgnoreCase) &&
            !string.Equals(fullPath, Path.GetFullPath(_instanceRoot), StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException("Invalid import staging path.");
        }
    }

    private static void RemoveOldInstanceDirectories(string baseRoot, TimeSpan maximumAge)
    {
        var cutoff = DateTime.UtcNow - maximumAge - TimeSpan.FromHours(1);
        foreach (var directory in Directory.EnumerateDirectories(baseRoot))
        {
            try
            {
                var name = Path.GetFileName(directory);
                var separator = name.IndexOf('-');
                var hasExpectedName = separator > 0 && int.TryParse(name[..separator], out _) &&
                                      name[(separator + 1)..].Length == 32 &&
                                      name[(separator + 1)..].All(Uri.IsHexDigit);
                if (hasExpectedName && Directory.GetLastWriteTimeUtc(directory) < cutoff)
                {
                    Directory.Delete(directory, true);
                }
            }
            catch (IOException)
            {
            }
            catch (UnauthorizedAccessException)
            {
            }
        }
    }

    internal sealed class FullSessionReservation : IDisposable
    {
        private bool _committed;
        private BookImportSessionStore? _store;

        public FullSessionReservation(BookImportSessionStore store, Guid ownerId, long reservedBytes)
        {
            _store = store;
            OwnerId = ownerId;
            ReservedBytes = reservedBytes;
        }

        public Guid OwnerId { get; }
        public long ReservedBytes { get; }

        public void Dispose()
        {
            var store = Interlocked.Exchange(ref _store, null);
            if (store != null && !_committed)
            {
                store.ReleaseReservation(this);
            }
        }

        public void Commit(ImportSession session)
        {
            var store = _store ?? throw new ObjectDisposedException(nameof(FullSessionReservation));
            store.CommitReservation(this, session);
        }

        public void MarkCommitted()
        {
            _committed = true;
        }
    }
}

internal sealed class BookImportSessionCleanupService : BackgroundService
{
    private readonly BookImportSecurityOptions _options;
    private readonly BookImportSessionStore _store;

    public BookImportSessionCleanupService(BookImportSessionStore store,
        IOptions<BookImportSecurityOptions> options)
    {
        _store = store;
        _options = options.Value;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(_options.CleanupInterval);
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            _store.CleanupExpired();
        }
    }
}
