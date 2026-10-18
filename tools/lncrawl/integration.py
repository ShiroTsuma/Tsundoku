"""Private Tsundoku API. No upstream user/admin/source-editor routes are exposed."""
import asyncio
from contextlib import asynccontextmanager
import hmac
import ipaddress
import json
import logging
import os
from pathlib import Path
import random
import shutil
import threading
import time
import zipfile
from urllib.parse import urlsplit
from uuid import UUID

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.responses import FileResponse
from integration_store import Store, empty_result
from download_plan import resolve_chapter_ids
from search_flow import search_metadata
from source_policy import allowed_host, normalized_host, supported_url
from processing_control import processing_enabled, set_processing, ProcessingPaused
from resilience import TemporarySourceError, SourcePausedError, SourceBusyError, observed_call, transient_failure, check_source_pause, call_with_source_pause
from lncrawl.context import ctx
from lncrawl.dao import Artifact
from lncrawl.enums import OutputFormat
from lncrawl.services.binder.epub import make_epub

log = logging.getLogger("tsundoku.crawler")
ROOT = Path(os.environ.get("LNCRAWL_DATA_PATH", "/data"))
store = None
signals = {}
stopping = threading.Event()
domain_locks = {}
domain_next = {}
lock = threading.Lock()


def authorize(x_crawler_key: str = Header(default="")):
    expected = os.environ.get("CRAWLER_API_KEY", "")
    if len(expected) < 32 or not hmac.compare_digest(expected, x_crawler_key):
        raise HTTPException(401, "Invalid integration credential")


def public_url(url):
    parsed = urlsplit(url)
    if not allowed_host(parsed.hostname):
        raise ValueError("This reference site is excluded from the EPUB crawler")
    if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("Only public HTTP(S) novel URLs are supported")
    if parsed.port not in (None, 80, 443) or not parsed.path.strip("/"):
        raise ValueError("Choose a novel page on a supported source")
    # This container deliberately has no external DNS/route. Resolution and the
    # public-IP check happen at the mandatory egress proxy, also on redirects.
    try:
        literal = ipaddress.ip_address(parsed.hostname)
    except ValueError:
        literal = None
    if literal is not None and not literal.is_global:
        raise ValueError("Private and reserved destinations are blocked")
    source = ctx.sources.get_source(parsed.hostname)
    if not source or source.is_disabled:
        raise ValueError("The source is not supported or is disabled")
    return source


def check(key, signal):
    if not processing_enabled() and not stopping.is_set():
        raise ProcessingPaused('Crawler processing is paused')
    row = store.get(key)
    if stopping.is_set() or signal.is_set() or not row or row["cancelled"] or time.time() - row["created"] > 86400:
        signal.set()
        raise InterruptedError("Operation cancelled or expired")
    if shutil.disk_usage(ROOT).free < 512 * 1024 * 1024:
        raise ValueError("Crawler disk space is low. Free storage before downloading again.")


def paced(key, url, signal, action):
    host = normalized_host(urlsplit(url).hostname)
    with lock:
        gate = domain_locks.setdefault(host, threading.Lock())
    while not gate.acquire(timeout=.25):
        if signal.is_set() and not stopping.is_set():
            raise SourceBusyError("Source is busy in another operation")
        check(key, signal)
    try:
        check_source_pause(store, host, time.time())
        cooldown = store.cooldown(host)
        if cooldown > time.time():
            raise TemporarySourceError(host, cooldown, "Source is cooling down", attempted=False)
        while time.monotonic() < domain_next.get(host, 0):
            if signal.is_set() and not stopping.is_set():
                raise SourceBusyError("Source pacing budget reached")
            check(key, signal)
            signal.wait(min(1, domain_next[host] - time.monotonic()))
        check(key, signal)
        try:
            return call_with_source_pause(store, host, action, time.time())
        except Exception as exc:
            if not processing_enabled():
                raise ProcessingPaused('Crawler processing is paused') from exc
            failure = transient_failure(exc, time.time())
            if failure is not None:
                delay, reason = failure
                attempt = json.loads(store.get(key)["result"]).get("retryAttempt", 0)
                until = time.time() + max(delay, min(3600, 60 * 3 ** attempt) * random.uniform(1, 1.2))
                store.cooldown(host, until)
                outcome = "rate_limited" if reason == "Source rate limit" else "timeout" if "connection interrupted" in reason.lower() else "warning"
                raise TemporarySourceError(host, until, reason, outcome=outcome) from exc
            raise
        finally:
            domain_next[host] = time.monotonic() + random.uniform(2, 4)
    finally:
        gate.release()


def inspect(key, url, signal):
    source = public_url(url)
    user = ctx.users.get_admin().id

    def fetch():
        # Metadata plus chapter index, never chapter contents or cover downloads.
        crawler = ctx.sources.init_crawler(url, timeout=12, probe=True)
        crawler.download_cover = lambda *_args, **_kwargs: None
        try:
            return observed_call(crawler, lambda: ctx.crawler.fetch_novel(user_id=user, url=url, signal=signal, custom=crawler))
        finally:
            crawler.close()

    novel = paced(key, url, signal, fetch)
    chapters = sorted(ctx.chapters.list(novel_id=novel.id), key=lambda c: c.serial)
    return novel, dict(title=novel.title, url=novel.url, domain=novel.domain,
                       language=source.language or novel.language or "", chapters=[dict(id=c.id, url=c.url, label=c.title) for c in chapters],
                       latestChapterLabel=chapters[-1].title if chapters else None, updatedAt=None)


def search_source(key, source, query, signal):
    def fetch():
        crawler = ctx.sources.init_crawler(source.url, timeout=12, probe=True)
        try:
            return observed_call(crawler, lambda: ctx.crawler.search_novel(user_id=ctx.users.get_admin().id, query=query,
                                           domain=source.domain, signal=signal, custom=crawler))
        finally:
            crawler.close()
    return paced(key, source.url, signal, fetch)


def run(key, request, result, signal):
    start = time.monotonic()
    result["status"] = "crawling"
    result.update(error=None, nextRetryAt=None, nextAttemptEpoch=0)
    store.save(key, result)
    if request["kind"] == "search":
        supported = [s for s in ctx.sources.list(include_rejected=False)
                     if not s.is_disabled and allowed_host(s.domain)]
        domains = {normalized_host(s.domain) for s in supported}
        sources = [s for s in supported if s.can_search and
                   (request.get("scope") == "all" or s.language == "en")]
        search_metadata(key, request, result, signal, sources=sources, inspect=inspect,
                        search=search_source, save=store.save, check=check,
                        supports_url=lambda url: supported_url(url, domains), health=store.health)
    elif request["kind"] == "inspect":
        _, data = inspect(key, request["url"], signal)
        result["novels"] = [data]
    elif request["kind"] == "download":
        novel, current = inspect(key, request["url"], signal)
        # Searching inspects metadata only. Actual downloads also fetch the cover
        # so the normal builder can include its cover and front pages.
        if novel.cover_url and not novel.cover_available:
            def fetch_cover():
                crawler = ctx.sources.init_crawler(novel.url, timeout=30, probe=True)
                try:
                    return observed_call(crawler, lambda: crawler.download_cover(
                        novel.cover_url, ctx.files.resolve(novel.cover_file)))
                finally:
                    crawler.close()
            paced(key, novel.url, signal, fetch_cover)
        available = {c["id"]: c["url"] for c in current["chapters"]}
        plans = request["files"]
        if not plans or len(plans) > 100:
            raise ValueError("Choose 1 to 100 EPUB files")
        if not result["files"]:
            result["files"] = [dict(title=p["title"], firstChapter=p["firstChapter"], lastChapter=p["lastChapter"],
                                    chaptersDone=0, status="waiting") for p in plans]
        for index, plan in enumerate(plans):
            check(key, signal)
            state = result["files"][index]
            target = output(key, index)
            if state["status"] == "ready" and target.is_file():
                continue
            ids = resolve_chapter_ids(request["chapters"], current["chapters"], plan)
            state["chaptersDone"] = 0
            state["status"] = result["status"] = "crawling"
            for chapter_id in ids:
                check(key, signal)
                public_url(available[chapter_id])
                chapter = ctx.chapters.get(chapter_id)
                if not chapter.is_available:
                    def fetch_chapter():
                        crawler = ctx.sources.init_crawler(novel.url, timeout=30, probe=True)
                        try:
                            return observed_call(crawler, lambda: ctx.crawler.fetch_chapter(
                                user_id=ctx.users.get_admin().id, chapter_id=chapter_id, signal=signal, custom=crawler))
                        finally:
                            crawler.close()
                    chapter = paced(key, available[chapter_id], signal, fetch_chapter)
                if not chapter.is_available:
                    raise ValueError("A chapter is missing; an incomplete EPUB was not created.")
                for image in ctx.images.list(chapter_id=chapter_id):
                    check(key, signal)
                    # Images may live on an external CDN; the egress proxy validates every destination.
                    if not image.is_available:
                        def fetch_image():
                            crawler = ctx.sources.init_crawler(novel.url, timeout=30, probe=True)
                            try:
                                return observed_call(crawler, lambda: ctx.crawler.fetch_image(
                                    user_id=ctx.users.get_admin().id, image_id=image.id, signal=signal, custom=crawler))
                            finally:
                                crawler.close()
                        paced(key, image.url, signal, fetch_image)
                state["chaptersDone"] += 1
                store.save(key, result)
            state["status"] = result["status"] = "building"
            store.save(key, result)
            artifact = Artifact(novel_id=novel.id, format=OutputFormat.epub,
                                file_name=f"tsundoku-{key}-{index}.epub")
            work = ROOT / "integration-tmp" / key / str(index)
            work.mkdir(parents=True, exist_ok=True)
            try:
                make_epub(work, artifact, signal=signal, chapter_ids=set(ids), title=plan["title"])
                check(key, signal)
                built = ctx.files.resolve(artifact.output_file)
                expected_names = {f"chapter_{ctx.chapters.get(c).serial:05}.xhtml" for c in ids}
                with zipfile.ZipFile(built) as archive:
                    actual_names = {Path(name).name for name in archive.namelist()
                                    if Path(name).name.startswith("chapter_") and name.endswith(".xhtml")}
                if actual_names != expected_names:
                    raise ValueError("The generated EPUB does not contain the exact selected chapter set.")
                if built.stat().st_size > 100 * 1024 * 1024:
                    raise ValueError("An EPUB exceeds the 100 MiB file limit. Choose fewer chapters per file.")
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.move(str(built), str(target))
                state["status"] = "ready"
                store.save(key, result)
            finally:
                shutil.rmtree(work, ignore_errors=True)
    else:
        raise ValueError("Unknown integration operation")
    check(key, signal)
    result["status"] = "completed"
    result["durationMs"] = int((time.monotonic() - start) * 1000)


def output(key, index):
    return ROOT / "integration-files" / str(UUID(key)) / f"{index}.epub"


def worker():
    while not stopping.is_set():
        if not processing_enabled():
            stopping.wait(.25)
            continue
        row = store.claim()
        if not row:
            stopping.wait(1)
            continue
        key = row["id"]
        signal = threading.Event()
        signals[key] = signal
        result = json.loads(row["result"])
        try:
            run(key, json.loads(row["request"]), result, signal)
        except ProcessingPaused:
            result.update(status='queued', error=None)
        except InterruptedError:
            if stopping.is_set():
                continue  # leave recoverable state for next startup
            result["status"] = "cancelled"
        except TemporarySourceError as exc:
            store.defer(key, result, exc)
        except Exception as exc:
            if isinstance(exc, SourcePausedError):
                log.warning("Crawler operation %s: %s", key, exc)
            else:
                log.exception("Crawler operation %s failed", key)
            result["status"] = "cancelled" if signal.is_set() else "failed"
            result["error"] = str(exc)[:500] if isinstance(exc, ValueError) else "Source unavailable or blocked. Try again later."
        finally:
            if not stopping.is_set():
                store.save(key, result)
            signals.pop(key, None)


def janitor():
    while not stopping.wait(60):
        try:
            for row in store.expired():
                if row["status"] not in ("completed", "failed", "cancelled"):
                    store.cancel(row["id"])
                    if row["id"] in signals:
                        signals[row["id"]].set()
                elif time.time() - row["created"] > 26 * 3600:
                    shutil.rmtree(ROOT / "integration-files" / row["id"], ignore_errors=True)
                    store.delete(row["id"])
            # Keep metadata, but release old downloaded bodies/images. is_available
            # in the engine checks the filesystem, so a later manual download refetches.
            novels = ctx.files.resolve("novels")
            if novels.is_dir():
                cutoff = time.time() - 7 * 86400
                for path in novels.glob("*/chapters/*.zst"):
                    if path.stat().st_mtime < cutoff:
                        path.unlink(missing_ok=True)
                for path in novels.glob("*/images/*"):
                    if path.is_file() and path.stat().st_mtime < cutoff:
                        path.unlink(missing_ok=True)
        except Exception:
            log.exception("Crawler cleanup failed; will retry")


@asynccontextmanager
async def lifespan(app):
    global store
    if len(os.environ.get("CRAWLER_API_KEY", "")) < 32:
        raise RuntimeError("CRAWLER_API_KEY must contain at least 32 characters")
    stopping.clear()
    ctx.setup(sync_remote_index=False)
    ctx.sources.ensure_load()
    # Load bundled sources last, ahead of older files in the persistent data volume.
    ctx.sources.load_crawlers(
        Path(__file__).parent / "sources/en/d/dobytranslations.py",
        Path(__file__).parent / "sources/en/t/tinytranslation.py")
    # Mandatory egress route. The crawler has no external Docker network.
    ctx.config.crawler.enable_proxy = True
    ctx.config.crawler.allow_fallback_on_proxy_miss = False
    ctx.config.crawler.proxies = os.environ.get("PROXY_URLS", "http://crawler-egress:3128")
    ctx.users.get_admin()
    store = Store(ROOT / "tsundoku-operations.sqlite3")
    threads = [threading.Thread(target=worker, daemon=True) for _ in range(2)]
    threads.append(threading.Thread(target=janitor, daemon=True))
    for thread in threads:
        thread.start()
    yield
    stopping.set()
    for signal in list(signals.values()):
        signal.set()
    for thread in threads:
        await asyncio.to_thread(thread.join, 10)
    ctx.destroy()


app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)


@app.get("/health")
def health():
    return {"status": "ok", "engineVersion": "4.14.0", "processingEnabled": processing_enabled()}


@app.get("/integration/processing", dependencies=[Depends(authorize)])
def processing_state():
    return {"processingEnabled": processing_enabled()}


@app.put("/integration/processing", dependencies=[Depends(authorize)])
def update_processing(settings: dict):
    if type(settings.get('processingEnabled')) is not bool:
        raise HTTPException(400, 'Choose whether processing is enabled')
    return set_processing(settings['processingEnabled'])


@app.get("/integration/source-health", dependencies=[Depends(authorize)])
def source_health():
    catalog = {normalized_host(s.domain): s for s in ctx.sources.list(include_rejected=False) if not s.is_disabled and allowed_host(s.domain)}
    return dict(processingEnabled=processing_enabled(), sources=[
        dict(**store.health.state(s.domain), url=s.url, language=s.language, canSearch=s.can_search)
        for s in catalog.values()])


@app.put("/integration/source-health/{domain}", dependencies=[Depends(authorize)])
def update_source_health(domain: str, settings: dict):
    known = {normalized_host(s.domain) for s in ctx.sources.list(include_rejected=False) if not s.is_disabled and allowed_host(s.domain)}
    if normalized_host(domain) not in known or type(settings.get("enabled")) is not bool or type(settings.get("alwaysInclude")) is not bool:
        raise HTTPException(400, "Choose a supported source and valid search settings")
    return store.health.update(domain, settings['enabled'], settings['alwaysInclude'])


@app.get("/integration/sources", dependencies=[Depends(authorize)])
def sources():
    return [dict(domain=s.domain, url=s.url, language=s.language, canSearch=s.can_search)
            for s in ctx.sources.list(include_rejected=False) if not s.is_disabled and allowed_host(s.domain)]


@app.put("/integration/jobs/{key}", dependencies=[Depends(authorize)])
def submit(key: UUID, request: dict):
    if len(json.dumps(request)) > 4 * 1024 * 1024:
        raise HTTPException(413, "Operation is too large")
    if request.get("kind") not in ("search", "inspect", "download"):
        raise HTTPException(400, "Unknown operation")
    try:
        return store.submit(str(key), request)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc


@app.get("/integration/active-jobs", dependencies=[Depends(authorize)])
def active_jobs(after: str = ""):
    return store.active_ids(after)


@app.get("/integration/jobs/{key}", dependencies=[Depends(authorize)])
def get(key: UUID):
    row = store.get(str(key))
    if not row:
        raise HTTPException(404)
    return json.loads(row["result"])


@app.post("/integration/jobs/{key}/cancel", dependencies=[Depends(authorize)])
def cancel(key: UUID):
    store.cancel(str(key))
    if str(key) in signals:
        signals[str(key)].set()
    return {"cancelRequested": True}


@app.get("/integration/jobs/{key}/files/{index}", dependencies=[Depends(authorize)])
def file(key: UUID, index: int):
    row = store.get(str(key))
    if not row or index < 0:
        raise HTTPException(404)
    files = json.loads(row["result"])["files"]
    path = output(str(key), index)
    if index >= len(files) or files[index]["status"] != "ready" or not path.is_file():
        raise HTTPException(404)
    return FileResponse(path, media_type="application/epub+zip")


@app.delete("/integration/jobs/{key}", dependencies=[Depends(authorize)])
def delete(key: UUID):
    row = store.get(str(key))
    if row and row["status"] not in ("completed", "failed", "cancelled"):
        raise HTTPException(409, "Operation is still running")
    shutil.rmtree(ROOT / "integration-files" / str(key), ignore_errors=True)
    store.delete(str(key))
    return {"deleted": True}
