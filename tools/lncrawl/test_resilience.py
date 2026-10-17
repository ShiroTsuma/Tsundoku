import json
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import threading

from integration_store import Store
from resilience import TemporarySourceError, SourcePausedError, transient_failure, observed_call, call_with_source_pause
from integration_store import empty_result
from search_flow import search_metadata


class RetryPolicyTests(unittest.TestCase):
    def test_http_rate_limits_respect_seconds_and_http_date(self):
        for header in ("120", "Thu, 01 Jan 1970 00:18:40 GMT"):
            exc = Exception()
            exc.response = SimpleNamespace(status_code=429, headers={"Retry-After": header})
            delay, _ = transient_failure(exc, 1000)
            self.assertEqual(120, delay)

    def test_permanent_errors_and_authentication_are_not_retried(self):
        for status in (401, 403, 404, 410):
            exc = Exception()
            exc.response = SimpleNamespace(status_code=status, headers={})
            self.assertIsNone(transient_failure(exc, 1000))
        self.assertIsNone(transient_failure(ValueError("broken parser"), 1000))
        Impassable = type("Impassable", (Exception,), {})
        self.assertIsNone(transient_failure(Impassable(), 1000))
        challenge = type("Exhausted", (Exception,), {})()
        challenge.layer = SimpleNamespace(name="TURNSTILE")
        challenge.response = SimpleNamespace(status_code=503, headers={})
        self.assertIsNone(transient_failure(challenge, 1000))
        self.assertIsNotNone(transient_failure(TimeoutError(), 1000))

    def test_observer_preserves_source_checks_and_retry_after_on_exhaustion(self):
        seen = []
        original = lambda response, body, diagnosis: seen.append(body) or diagnosis
        crawler = SimpleNamespace(scraper=SimpleNamespace(_overrule=original))
        response = SimpleNamespace(status_code=503, headers={"Retry-After": "600"})
        def action():
            self.assertEqual("busy", crawler.scraper._overrule(response, "body", "busy"))
            raise Exception("request exhausted")
        with self.assertRaises(Exception) as caught:
            observed_call(crawler, action)
        self.assertEqual(600, transient_failure(caught.exception, 1000)[0])
        self.assertEqual(["body"], seen)
        self.assertIs(original, crawler.scraper._overrule)


class DurableRetryTests(unittest.TestCase):
    def test_browser_verification_pauses_the_source_across_books_aliases_and_restarts(self):
        with TemporaryDirectory() as root:
            path = Path(root) / "store.db"
            store = Store(path)
            calls = []
            def challenge():
                calls.append("request")
                raise Exception("L9 Managed JavaScript challenge; challenge served with 403")
            with self.assertRaises(SourcePausedError):
                call_with_source_pause(store, "www.webnovel.com", challenge, 1000)
            store = Store(path)
            for _ in range(20):
                with self.assertRaises(SourcePausedError):
                    call_with_source_pause(store, "webnovel.com", challenge, 1001)
            self.assertEqual(["request"], calls)
            self.assertEqual(1900, store.source_pause("webnovel.com")["until"])
            self.assertEqual("ok", call_with_source_pause(store, "webnovel.com", lambda: "ok", 1901))

    def test_browser_pause_uses_configuration_and_longer_server_retry_after(self):
        with TemporaryDirectory() as root, patch.dict("os.environ", {"CRAWLER_VERIFICATION_PAUSE_SECONDS": "120"}):
            store = Store(Path(root) / "store.db")
            def challenge():
                exc = Exception("Managed JavaScript challenge")
                exc.response = SimpleNamespace(status_code=403, headers={"Retry-After": "1800"})
                raise exc
            with self.assertRaises(SourcePausedError):
                call_with_source_pause(store, "example.com", challenge, 1000)
            self.assertEqual(2800, store.source_pause("example.com")["until"])

    def test_partial_search_is_completed_with_warning_when_failed_sources_exhaust_retries(self):
        with TemporaryDirectory() as root, patch("integration_store.time.time", return_value=1000):
            store = Store(Path(root) / "store.db")
            result = store.submit("search", {"kind": "search"})
            result["novels"] = [{"url": "https://good.example/novel", "title": "Test"}]
            for _ in range(6):
                store.defer("search", result, TemporarySourceError("busy.example", 1000), now=1000)
            self.assertEqual("completed", result["status"])
            self.assertIsNone(result["error"])
            self.assertIsNone(result["nextRetryAt"])
            self.assertEqual(1, len(result["novels"]))
            self.assertIn("Results already found", result["warnings"][0])

    def test_blocked_source_does_not_retry_or_discard_other_search_results(self):
        result = empty_result()
        def search(key, source, query, signal):
            if source.domain == "blocked.example":
                raise SourcePausedError("blocked.example: Source requires browser verification.", attempted=True)
            return [SimpleNamespace(url="https://good.example/novel")]
        search_metadata("one", dict(query="Test", scope="all"), result, threading.Event(),
                        sources=[SimpleNamespace(domain="blocked.example"), SimpleNamespace(domain="good.example")],
                        inspect=lambda key, url, signal: (None, dict(url=url, title="Test", language="en", chapters=[])),
                        search=search, save=lambda *_: None, check=lambda *_: None, supports_url=lambda url: True)
        self.assertEqual(1, len(result["novels"]))
        self.assertEqual(2, result["searchedSourceCount"])
        self.assertEqual([], result["_retryDomains"])
        self.assertIn("browser verification", result["warnings"][0])

    def test_active_inventory_includes_waiting_retries_but_not_cancelled_jobs(self):
        with TemporaryDirectory() as root, patch("integration_store.time.time", return_value=1000):
            store = Store(Path(root) / "store.db")
            for key in ("a", "b", "c"):
                result = store.submit(key, {"kind": "inspect"})
                if key == "a":
                    store.defer(key, result, TemporarySourceError("example.com", 1600))
            store.cancel("b")
            self.assertEqual(["a", "c"], store.active_ids())
            self.assertEqual(["c"], store.active_ids("b"))

    def test_search_finishes_partial_without_waiting_for_failed_domains(self):
        result = empty_result()
        calls = []
        failing = True
        def search(key, source, query, signal):
            calls.append(source.domain)
            if source.domain == "busy.example" and failing:
                raise TemporarySourceError(source.domain, 1600)
            return [SimpleNamespace(url=f"https://{source.domain}/novel")]
        def inspect(key, url, signal):
            return None, dict(url=url, title="Test", language="en", chapters=[])
        def run():
            search_metadata("one", dict(query="Test", scope="all"), result, threading.Event(),
                            sources=[SimpleNamespace(domain="good.example"), SimpleNamespace(domain="busy.example")],
                            inspect=inspect, search=search, save=lambda *_: None, check=lambda *_: None,
                            supports_url=lambda url: True)
        run()
        self.assertEqual(1, len(result["novels"]))
        self.assertEqual([], result["_retryDomains"])
        self.assertIn('busy.example', result['warnings'][0])
        failing = False
        run()
        self.assertEqual(1, len(result["novels"]))
        self.assertEqual(1, calls.count("good.example"))
        self.assertEqual(2, result["searchedSourceCount"])

    def test_restart_preserves_deadline_partial_files_and_domain_cooldown(self):
        with TemporaryDirectory() as root, patch("integration_store.time.time", return_value=1000):
            path = Path(root) / "store.db"
            store = Store(path)
            result = store.submit("one", {"kind": "download"})
            store.claim()
            result["files"] = [{"status": "ready"}]
            store.cooldown("example.com", 1600)
            store.cooldown("example.com", 1100)
            store.defer("one", result, TemporarySourceError("example.com", 1600))
            store = Store(path)
            self.assertIsNone(store.claim())
            self.assertEqual(1600, store.cooldown("example.com"))
            with patch("integration_store.time.time", return_value=1601):
                resumed = json.loads(store.claim()["result"])
                self.assertEqual("ready", resumed["files"][0]["status"])
                self.assertEqual(1, resumed["retryAttempt"])

    def test_bounded_backoff_and_cancel_while_waiting(self):
        with TemporaryDirectory() as root, patch("integration_store.time.time", return_value=1000):
            store = Store(Path(root) / "store.db")
            result = store.submit("one", {"kind": "download"})
            deadlines = []
            for _ in range(6):
                store.defer("one", result, TemporarySourceError("example.com", 1000), now=1000)
                deadlines.append(result["nextAttemptEpoch"])
            self.assertEqual([1060, 1180, 1540, 2620, 4600], deadlines[:5])
            self.assertEqual("failed", result["status"])
            other = store.submit("two", {"kind": "inspect"})
            store.defer("two", other, TemporarySourceError("example.com", 2000))
            store.cancel("two")
            self.assertEqual("cancelled", json.loads(store.get("two")["result"])["status"])
            self.assertIsNone(store.claim())

    def test_running_cancellation_survives_restart(self):
        with TemporaryDirectory() as root:
            path = Path(root) / "store.db"
            store = Store(path)
            store.submit("one", {"kind": "download"})
            store.claim()
            store.cancel("one")
            store = Store(path)
            self.assertEqual("cancelled", json.loads(store.get("one")["result"])["status"])


if __name__ == "__main__":
    unittest.main()
