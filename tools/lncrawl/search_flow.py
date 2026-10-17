"""Metadata-only search orchestration, with bounded fan-out and incremental feedback."""
from concurrent.futures import ThreadPoolExecutor, wait, FIRST_COMPLETED
import re
import threading
import time
import unicodedata
from urllib.parse import urlsplit
from resilience import TemporarySourceError, SourcePausedError, SourceBusyError
from source_policy import normalized_host


def query_variants(query):
    # WordPress searches use AND semantics: an apostrophe/possessive difference
    # in a long title can discard an otherwise correct match.
    plain = unicodedata.normalize("NFKC", query).replace("’", "'").replace("‘", "'")
    words = re.findall(r"[^\W_]+", plain, flags=re.UNICODE)
    short = " ".join(words[:6])
    return list(dict.fromkeys([plain.strip(), short]))


def search_metadata(key, request, result, signal, *, sources, inspect, search, save, check, supports_url, budget=180, health=None):
    start = time.monotonic()
    urls = list(dict.fromkeys(url for url in request.get("urls", []) if supports_url(url)))[:20]
    linked_hosts = {normalized_host(urlsplit(url).hostname) for url in urls}
    skipped = set()
    if health is not None:
        admitted = []
        for source in sources:
            if health.admit(source.domain, preferred=normalized_host(source.domain) in linked_hosts):
                admitted.append(source)
            else:
                skipped.add(normalized_host(source.domain))
        sources = admitted
        urls = [url for url in urls if health.admit(urlsplit(url).hostname, preferred=True)]
    eligible_urls = set(urls)
    eligible_domains = {source.domain for source in sources}
    eligible_warnings = tuple(f"Saved link {urlsplit(url).hostname}:" for url in urls)
    result["warnings"] = [warning for warning in result["warnings"]
                          if not warning.startswith("Saved link ") or warning.startswith(eligible_warnings)]
    # Recovered jobs must use the current catalog, including their retry targets.
    result["novels"] = [novel for novel in result["novels"] if supports_url(novel["url"])]
    sources = sorted(sources, key=lambda source: (
        normalized_host(source.domain) not in linked_hosts,
        not (health.state(source.domain)['alwaysInclude'] if health else source.domain == "dobytranslations.com"), source.domain))
    result.update(totalSourceCount=len(sources), totalLinkCount=len(urls), skippedSourceCount=len(skipped), nextRetryAt=None, nextAttemptEpoch=0)
    if "_retryUrls" in result:
        urls = [url for url in result["_retryUrls"] if url in eligible_urls]
        pending = set(result["_retryDomains"])
        sources = [source for source in sources if source.domain in pending]
    done_urls = set(result.get("_doneUrls", [])) & eligible_urls
    done_domains = set(result.get("_doneDomains", [])) & eligible_domains
    result.update(checkedLinkCount=len(done_urls), searchedSourceCount=len(done_domains))
    seen = {novel["url"] for novel in result["novels"]}

    def publish():
        result.update(_doneUrls=list(done_urls), _doneDomains=list(done_domains))
        result["durationMs"] = int((time.monotonic() - start) * 1000)
        save(key, result)

    def add(novel):
        if novel["url"] not in seen and (request.get("scope") != "english" or novel["language"] == "en"):
            seen.add(novel["url"])
            result["novels"].append(novel)

    # Saved links are authoritative for this book and independent of title spelling.
    for url in urls:
        check(key, signal)
        host = urlsplit(url).hostname or "saved link"
        result["currentSource"] = f"Checking saved link: {host}"
        publish()
        try:
            _, novel = inspect(key, url, signal)
            add(novel)
        except TemporarySourceError as exc:
            result['warnings'].append(f"Saved link {host}: {exc}. Its tracked chapter update will retry independently.")
            if health and exc.attempted:
                health.observe(key, host, exc.outcome)
        except SourcePausedError as exc:
            result["warnings"].append(str(exc))
            if health and exc.attempted:
                health.observe(key, host, 'warning')
        except SourceBusyError:
            result['warnings'].append(f"Saved link {host}: source busy; use Refresh sources later.")
        except InterruptedError:
            raise
        except Exception as exc:
            result["warnings"].append(f"Saved link {host}: metadata could not be read.")
            # Log at the integration boundary, not into user-visible credentials/URLs.
            import logging
            logging.getLogger("tsundoku.crawler").warning("Saved source %s failed (%s)", host, type(exc).__name__)
            if health:
                health.observe(key, host, 'warning')
        else:
            if health:
                health.observe(key, host, 'success')
        done_urls.add(url)
        result["checkedLinkCount"] = len(done_urls)
        publish()

    # Source calls have their own timeout/signal. At most four sources run together.
    def probe(source, local_signal):
        novels, warnings, temporary, outcome = [], [], None, 'success'
        timer = threading.Timer(30, local_signal.set)
        timer.start()
        try:
            hits = []
            for query in query_variants(request["query"]):
                if local_signal.is_set():
                    break
                hits = search(key, source, query, local_signal)
                if hits:
                    break
            for hit in hits[:3]:
                if local_signal.is_set():
                    break
                if hit.url in seen or not supports_url(hit.url):
                    continue
                try:
                    _, novel = inspect(key, hit.url, local_signal)
                    novels.append(novel)
                except TemporarySourceError as exc:
                    temporary = exc
                except SourcePausedError as exc:
                    warnings.append(str(exc))
                    if exc.attempted:
                        outcome = 'warning'
                except SourceBusyError:
                    warnings.append(f"Source busy on {source.domain}; metadata time budget reached.")
                    outcome = None
                except InterruptedError:
                    raise
                except Exception:
                    warnings.append(f"Could not read a result from {source.domain}.")
                    outcome = 'warning'
            if local_signal.is_set():
                warnings.append(f"Metadata time budget reached on {source.domain}.")
                if temporary is None:
                    outcome = None
            return novels, warnings, temporary, outcome, False
        except TemporarySourceError as exc:
            return novels, warnings, exc, exc.outcome if exc.attempted else None, not exc.attempted
        except SourcePausedError as exc:
            return novels, [*warnings, str(exc)], None, 'warning' if exc.attempted else None, not exc.attempted
        except SourceBusyError:
            return novels, warnings, None, None, True
        except InterruptedError:
            raise
        except Exception:
            return novels, [f"Search unavailable on {source.domain}."], None, None if local_signal.is_set() else 'warning', False
        finally:
            timer.cancel()

    iterator = iter(sources)
    active = {}
    with ThreadPoolExecutor(max_workers=4, thread_name_prefix="metadata-search") as pool:
        def fill():
            while len(active) < 4 and time.monotonic() - start < budget:
                source = next(iterator, None)
                if source is None:
                    break
                child = threading.Event()
                active[pool.submit(probe, source, child)] = (source, child)
        try:
            fill()
            while active:
                check(key, signal)
                result["currentSource"] = "Checking " + ", ".join(s.domain for s, _ in active.values())
                publish()
                done, _ = wait(active, timeout=1, return_when=FIRST_COMPLETED)
                for future in done:
                    source, _ = active.pop(future)
                    novels, warnings, temporary, outcome, was_skipped = future.result()
                    for novel in novels:
                        add(novel)
                    if was_skipped:
                        skipped.add(normalized_host(source.domain))
                        result['totalSourceCount'] -= 1
                    else:
                        result["warnings"].extend(warnings)
                        done_domains.add(source.domain)
                        if temporary is not None:
                            result['warnings'].append(f"{source.domain}: {temporary}. Other results are available.")
                            outcome = temporary.outcome if temporary.attempted else None
                    if health and outcome is not None:
                        health.observe(key, source.domain, outcome)
                    result["searchedSourceCount"] = len(done_domains)
                if time.monotonic() - start >= budget:
                    for _, child in active.values():
                        child.set()
                else:
                    fill()
            if time.monotonic() - start >= budget and result["searchedSourceCount"] < result["totalSourceCount"]:
                result["warnings"].append("Search time limit reached; results are partial.")
        finally:
            for _, child in active.values():
                child.set()
    result["currentSource"] = None
    result.update(_retryUrls=[], _retryDomains=[], skippedSourceCount=len(skipped),
                  _doneUrls=list(done_urls), _doneDomains=list(done_domains))
    result["warnings"] = list(dict.fromkeys(result["warnings"]))
    publish()
