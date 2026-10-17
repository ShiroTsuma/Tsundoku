"""Search-only source quality. Burst volume never counts as repeated evidence."""
import time
from source_policy import normalized_host


class SourceHealth:
    def __init__(self, connect):
        self.connect = connect

    def initialize(self, db):
        db.execute("CREATE TABLE IF NOT EXISTS search_source_health (host TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 1, "
                   "always_include INTEGER NOT NULL DEFAULT 0, next_probe REAL NOT NULL DEFAULT 0, recovered_at REAL NOT NULL DEFAULT 0)")
        db.execute("CREATE TABLE IF NOT EXISTS search_source_observations (job_id TEXT NOT NULL, host TEXT NOT NULL, "
                   "bucket INTEGER NOT NULL, outcome TEXT NOT NULL, observed REAL NOT NULL, PRIMARY KEY(job_id,host,bucket))")
        db.execute("CREATE INDEX IF NOT EXISTS ix_search_source_observations_host ON search_source_observations(host,observed)")
        db.execute("INSERT OR IGNORE INTO search_source_health(host,enabled) VALUES('webnovelover.com',0)")
        db.execute("INSERT OR IGNORE INTO search_source_health(host,always_include) VALUES('dobytranslations.com',1)")

    def observe(self, job, host, outcome, now=None):
        # Never accept download/standalone scan observations into these rates.
        if outcome not in ('success', 'timeout', 'warning', 'rate_limited'):
            return
        now = time.time() if now is None else now
        host = normalized_host(host)
        recovered = outcome == 'success' and self.state(host, now)['autoSkipped']
        with self.connect() as db:
            row = db.execute("SELECT request FROM operations WHERE id=?", (job,)).fetchone()
            if not row:
                return
            import json
            if json.loads(row['request']).get('kind') != 'search':
                return
            db.execute("INSERT OR IGNORE INTO search_source_health(host) VALUES(?)", (host,))
            db.execute("INSERT OR IGNORE INTO search_source_observations VALUES(?,?,?,?,?)",
                       (job, host, int(now // 1800), outcome, now))
            if recovered:
                db.execute("UPDATE search_source_health SET recovered_at=? WHERE host=?", (now, host))
            db.execute("DELETE FROM search_source_observations WHERE observed<?", (now - 365 * 86400,))

    def state(self, host, now=None):
        now = time.time() if now is None else now
        host = normalized_host(host)
        with self.connect() as db:
            settings = db.execute("SELECT * FROM search_source_health WHERE host=?", (host,)).fetchone()
            samples = db.execute("SELECT outcome,observed,bucket FROM search_source_observations WHERE host=? AND observed>=?",
                                 (host, now - 365 * 86400)).fetchall()
        counts = {outcome: sum(s['outcome'] == outcome for s in samples)
                  for outcome in ('success', 'timeout', 'warning', 'rate_limited')}
        eligible = [s for s in samples if s['outcome'] != 'rate_limited' and
                    s['observed'] >= (settings['recovered_at'] if settings else 0)]
        buckets = {}
        for sample in eligible:
            buckets.setdefault(sample['bucket'], []).append(sample['outcome'])
        # At least 6 observations, 3 separate half-hour windows and an actual
        # hour of history; each window has equal weight, regardless of load.
        recent = sorted(buckets)[-4:]
        bad_windows = sum(sum(value != 'success' for value in buckets[b]) / len(buckets[b]) >= .8 for b in recent)
        stable_bad = (len(eligible) >= 6 and len(recent) >= 3 and bad_windows >= 3
                      and max(s['observed'] for s in eligible) - min(s['observed'] for s in eligible) >= 3600)
        total = len(samples)
        return dict(domain=host, enabled=bool(settings['enabled']) if settings else True,
                    alwaysInclude=bool(settings['always_include']) if settings else False,
                    sampleCount=total, successCount=counts['success'], timeoutCount=counts['timeout'],
                    warningCount=counts['warning'], rateLimitedCount=counts['rate_limited'],
                    successRate=counts['success'] / total if total else None,
                    timeoutRate=counts['timeout'] / total if total else None,
                    warningRate=counts['warning'] / total if total else None,
                    lastObservedAt=max((s['observed'] for s in samples), default=None),
                    autoSkipped=bool(stable_bad), nextProbeAt=settings['next_probe'] if settings else 0)

    def admit(self, host, preferred=False, now=None):
        now = time.time() if now is None else now
        state = self.state(host, now)
        if not state['enabled']:
            return False
        if preferred or state['alwaysInclude'] or not state['autoSkipped']:
            return True
        # One occasional recovery probe, shared across all jobs, instead of
        # permanently removing a source or probing it once per library book.
        with self.connect() as db:
            changed = db.execute("UPDATE search_source_health SET next_probe=? WHERE host=? AND next_probe<=?",
                                 (now + 6 * 3600, normalized_host(host), now)).rowcount
        return bool(changed)

    def update(self, host, enabled, always_include):
        host = normalized_host(host)
        with self.connect() as db:
            db.execute("INSERT INTO search_source_health(host,enabled,always_include) VALUES(?,?,?) "
                       "ON CONFLICT(host) DO UPDATE SET enabled=excluded.enabled,always_include=excluded.always_include",
                       (host, enabled, always_include))
        return self.state(host)
