"""Persistent idempotent operations; one process owns the crawler engine."""
import json
from contextlib import contextmanager
import sqlite3
import time
from pathlib import Path
from source_health import SourceHealth


def empty_result():
    return dict(status="queued", novels=[], files=[], searchedSourceCount=0,
                durationMs=0, warnings=[], error=None, totalSourceCount=0,
                checkedLinkCount=0, totalLinkCount=0, currentSource=None,
                retryAttempt=0, nextRetryAt=None, nextAttemptEpoch=0)


class Store:
    def __init__(self, path):
        self.path = str(path)
        self.health = SourceHealth(self.connect)
        Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.execute("CREATE TABLE IF NOT EXISTS operations (id TEXT PRIMARY KEY, request TEXT NOT NULL, "
                       "result TEXT NOT NULL, status TEXT NOT NULL, cancelled INTEGER NOT NULL DEFAULT 0, "
                       "created REAL NOT NULL)")
            db.execute("CREATE TABLE IF NOT EXISTS source_cooldowns (host TEXT PRIMARY KEY, until REAL NOT NULL)")
            db.execute("CREATE TABLE IF NOT EXISTS source_pauses (host TEXT PRIMARY KEY, until REAL NOT NULL, reason TEXT NOT NULL)")
            self.health.initialize(db)
            db.execute("CREATE TABLE IF NOT EXISTS integration_policies (name TEXT PRIMARY KEY)")
            changed = db.execute("INSERT OR IGNORE INTO integration_policies VALUES('single-pass-search-v1')").rowcount
            if changed:
                db.execute("UPDATE operations SET result=json_set(result,'$.nextAttemptEpoch',0,'$.nextRetryAt',NULL) "
                           "WHERE json_extract(request,'$.kind')='search' AND status NOT IN ('completed','failed','cancelled')")
            # An interrupted operation reuses its immutable request and existing outputs.
            db.execute("UPDATE operations SET status='queued' WHERE status NOT IN ('completed','failed','cancelled')")
            db.execute("UPDATE operations SET status='cancelled',result=json_set(result,'$.status','cancelled',"
                       "'$.nextRetryAt',NULL,'$.nextAttemptEpoch',0) WHERE cancelled=1 "
                       "AND status NOT IN ('completed','failed','cancelled')")

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=30)
        db.row_factory = sqlite3.Row
        try:
            with db:
                yield db
        finally:
            db.close()

    def submit(self, key, request):
        encoded = json.dumps(request, sort_keys=True)
        with self.connect() as db:
            db.execute("INSERT OR IGNORE INTO operations(id,request,result,status,created) VALUES(?,?,?,'queued',?)",
                       (key, encoded, json.dumps(empty_result()), time.time()))
            row = db.execute("SELECT * FROM operations WHERE id=?", (key,)).fetchone()
            if row["request"] != encoded:
                raise ValueError("Operation identifier already belongs to a different request")
            return json.loads(row["result"])

    def get(self, key):
        with self.connect() as db:
            row = db.execute("SELECT * FROM operations WHERE id=?", (key,)).fetchone()
            return dict(row) if row else None

    def claim(self):
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            # Manual downloads precede metadata-only work. Search remains interactive.
            row = db.execute("SELECT * FROM operations WHERE status='queued' AND cancelled=0 "
                             "AND COALESCE(json_extract(result,'$.nextAttemptEpoch'),0)<=? ORDER BY "
                             "CASE WHEN json_extract(request,'$.kind')='download' THEN 0 "
                             "WHEN json_extract(request,'$.kind')='search' AND COALESCE(json_extract(request,'$.background'),0)=0 THEN 1 "
                             "WHEN json_extract(request,'$.kind')='inspect' THEN 2 "
                             "WHEN json_extract(request,'$.initialDiscovery')=1 THEN 3 "
                             "ELSE 4 END, created LIMIT 1", (time.time(),)).fetchone()
            if row:
                db.execute("UPDATE operations SET status='running' WHERE id=?", (row["id"],))
            return dict(row) if row else None

    def save(self, key, result):
        with self.connect() as db:
            db.execute("UPDATE operations SET result=?,status=? WHERE id=?",
                       (json.dumps(result), result["status"], key))

    def cancel(self, key):
        with self.connect() as db:
            db.execute("UPDATE operations SET cancelled=1 WHERE id=?", (key,))
            row = db.execute("SELECT result,status FROM operations WHERE id=?", (key,)).fetchone()
            if row and row["status"] == "queued":
                result = json.loads(row["result"])
                result["status"] = "cancelled"
                db.execute("UPDATE operations SET status='cancelled',result=? WHERE id=?", (json.dumps(result), key))

    def cooldown(self, host, until=None):
        from source_policy import normalized_host
        host = normalized_host(host)
        with self.connect() as db:
            if until is not None:
                db.execute("INSERT INTO source_cooldowns(host,until) VALUES(?,?) "
                           "ON CONFLICT(host) DO UPDATE SET until=MAX(until,excluded.until)", (host, until))
            row = db.execute("SELECT MAX(until) FROM source_cooldowns WHERE host IN (?,?)", (host, "www." + host)).fetchone()
            return row[0] or 0

    def source_pause(self, host, until=None, reason=None):
        from source_policy import normalized_host
        host = normalized_host(host)
        with self.connect() as db:
            if until is not None:
                db.execute("INSERT INTO source_pauses(host,until,reason) VALUES(?,?,?) "
                           "ON CONFLICT(host) DO UPDATE SET until=MAX(until,excluded.until),reason=excluded.reason",
                           (host, until, reason))
            row = db.execute("SELECT until,reason FROM source_pauses WHERE host=?", (host,)).fetchone()
            return dict(row) if row else None

    def defer(self, key, result, error, now=None):
        from resilience import iso_time
        now = time.time() if now is None else now
        row = self.get(key)
        if not row or row["cancelled"]:
            result.update(status="cancelled", nextRetryAt=None, nextAttemptEpoch=0)
        else:
            attempt = result.get("retryAttempt", 0) + 1
            delay = min(3600, 60 * 3 ** (attempt - 1))
            due = max(now + delay, error.retry_at)
            if attempt > 5 or due >= row["created"] + 86400:
                if json.loads(row["request"]).get("kind") == "search" and result.get("novels"):
                    result.update(status="completed", error=None, nextRetryAt=None, nextAttemptEpoch=0, currentSource=None)
                    result["warnings"].append("Some sources remained unavailable after automatic retries. Results already found are ready to choose.")
                else:
                    result.update(status="failed", error="Source unavailable after automatic retries. Finished files remain available.",
                                  nextRetryAt=None, nextAttemptEpoch=0)
            else:
                result.update(status="queued", retryAttempt=attempt, nextRetryAt=iso_time(due),
                              nextAttemptEpoch=due, error=None,
                              currentSource=f"{error.host}: {error}. Automatic retry scheduled.")
        self.save(key, result)

    def delete(self, key):
        with self.connect() as db:
            db.execute("DELETE FROM operations WHERE id=? AND status IN ('completed','failed','cancelled')", (key,))

    def expired(self, age=86400):
        with self.connect() as db:
            return [dict(r) for r in db.execute("SELECT * FROM operations WHERE created<?", (time.time() - age,))]

    def active_ids(self, after=""):
        with self.connect() as db:
            return [r["id"] for r in db.execute("SELECT id FROM operations WHERE id>? "
                "AND status NOT IN ('completed','failed','cancelled') ORDER BY id LIMIT 100", (after,))]
