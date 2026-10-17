import json
from pathlib import Path
import socket
import tempfile
import unittest
from unittest.mock import patch

from egress import public_addresses
from integration_store import Store
from search_flow import search_metadata, query_variants
from source_policy import supported_url
import threading
from types import SimpleNamespace


class EgressTests(unittest.TestCase):
    def test_novelupdates_and_its_subdomains_never_reach_dns(self):
        with patch("socket.getaddrinfo") as dns:
            for host in ("novelupdates.com", "www.novelupdates.com", "cdn.novelupdates.com", "NovelUpdates.com."):
                with self.assertRaises(ValueError):
                    public_addresses(host, 443)
            dns.assert_not_called()

    def test_private_loopback_reserved_and_mapped_addresses_are_blocked(self):
        for address in ("127.0.0.1", "10.0.0.1", "172.16.0.1", "192.168.1.1", "169.254.169.254", "::1", "fc00::1", "::ffff:127.0.0.1"):
            with self.subTest(address=address), patch("socket.getaddrinfo", return_value=[(socket.AF_INET, socket.SOCK_STREAM, 6, "", (address, 443))]):
                with self.assertRaises(ValueError):
                    public_addresses("untrusted.example", 443)

    def test_mixed_public_private_answers_are_blocked(self):
        records = [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (ip, 443)) for ip in ("1.1.1.1", "127.0.0.1")]
        with patch("socket.getaddrinfo", return_value=records), self.assertRaises(ValueError):
            public_addresses("rebinding.example", 443)

    def test_public_destination_is_allowed_and_non_web_ports_are_blocked(self):
        records = [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("1.1.1.1", 443))]
        with patch("socket.getaddrinfo", return_value=records):
            self.assertEqual(records, public_addresses("public.example", 443))
            with self.assertRaises(ValueError):
                public_addresses("public.example", 5432)


class PersistenceTests(unittest.TestCase):
    def test_tracked_scan_precedes_bulk_initial_discovery_but_not_manual_work(self):
        with tempfile.TemporaryDirectory() as root:
            store = Store(Path(root) / "jobs.db")
            store.submit("discovery", {"kind": "search", "background": True, "initialDiscovery": True})
            store.submit("tracked", {"kind": "inspect"})
            store.submit("manual", {"kind": "search"})
            self.assertEqual("manual", store.claim()["id"])
            self.assertEqual("tracked", store.claim()["id"])
            self.assertEqual("discovery", store.claim()["id"])

    def test_idempotency_and_restart_preserve_completed_files(self):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / "jobs.db"
            store = Store(path)
            store.submit("one", {"kind": "download"})
            row = store.claim()
            result = json.loads(row["result"])
            result.update(status="building", files=[{"status": "ready"}])
            store.save("one", result)
            store = Store(path)
            recovered = store.claim()
            self.assertEqual("one", recovered["id"])
            self.assertEqual("ready", json.loads(recovered["result"])["files"][0]["status"])
            self.assertEqual(result, store.submit("one", {"kind": "download"}))
            with self.assertRaises(ValueError):
                store.submit("one", {"kind": "inspect"})

    def test_download_has_priority_over_scan_and_cancel_is_durable(self):
        with tempfile.TemporaryDirectory() as root:
            store = Store(Path(root) / "jobs.db")
            store.submit("scan", {"kind": "inspect"})
            store.submit("download", {"kind": "download"})
            self.assertEqual("download", store.claim()["id"])
            store.cancel("download")
            self.assertEqual(1, store.get("download")["cancelled"])

    def test_queued_cancellation_finishes_without_waiting_for_an_engine_worker(self):
        with tempfile.TemporaryDirectory() as root:
            store = Store(Path(root) / "jobs.db")
            store.submit("queued", {"kind": "download"})
            store.cancel("queued")
            self.assertEqual("cancelled", json.loads(store.get("queued")["result"])["status"])
            self.assertIsNone(store.claim())


class MetadataSearchTests(unittest.TestCase):
    def test_saved_doby_link_works_independently_of_query_and_publishes_before_search(self):
        from integration_store import empty_result
        result = empty_result()
        url = "https://dobytranslations.com/series/my-struggle-for-survival-after-becoming-the-true-ancestors-blood-servant/"
        observed = []
        calls = []
        novel = dict(url=url, title="My Struggle for Survival After Becoming the True Ancestor’s Blood Servant", language="en", chapters=[])
        def inspect(key, target, signal):
            calls.append(target)
            return None, novel
        def search(*args):
            self.assertEqual([url], calls)
            self.assertTrue(any(item['novels'] for item in observed))
            return []
        search_metadata("test", dict(query="completely different title", scope="english", urls=[url]), result,
                        threading.Event(), sources=[SimpleNamespace(domain="dobytranslations.com")], inspect=inspect,
                        search=search, save=lambda key, value: observed.append(json.loads(json.dumps(value))), check=lambda *_: None,
                        supports_url=lambda url: supported_url(url, {"dobytranslations.com"}))
        self.assertEqual([novel], result['novels'])
        self.assertEqual(1, result['checkedLinkCount'])
        self.assertEqual("Checking saved link: dobytranslations.com", observed[0]['currentSource'])

    def test_saved_link_failure_is_visible_instead_of_silently_dropped(self):
        from integration_store import empty_result
        result = empty_result()
        def inspect(*_):
            raise ValueError('parse failed')
        search_metadata("test", dict(query="Test", scope="english", urls=["https://dobytranslations.com/series/test/"]), result,
                        threading.Event(), sources=[], inspect=inspect, search=lambda *_: [], save=lambda *_: None, check=lambda *_: None,
                        supports_url=lambda url: supported_url(url, {"dobytranslations.com"}))
        self.assertIn("Saved link dobytranslations.com", result['warnings'][0])
        self.assertEqual(1, result['checkedLinkCount'])

    def test_long_title_has_short_normalized_fallback(self):
        variants = query_variants("My Struggle for Survival After Becoming the True Ancestor’s Blood Servant")
        self.assertEqual("My Struggle for Survival After Becoming", variants[1])
        self.assertIn("Ancestor's", variants[0])

    def test_only_supported_saved_links_are_inspected_even_without_title_search_support(self):
        from integration_store import empty_result
        from unittest.mock import Mock
        doby = "https://www.dobytranslations.com/series/test/"
        links = ["https://www.novelupdates.com/series/test/", "https://cdn.novelupdates.com/image.jpg",
                 "https://unsupported.example/book", doby]
        inspect = Mock(return_value=(None, dict(url=doby, title="Test", language="en", chapters=[])))
        result = empty_result()
        search_metadata("test", dict(query="Test", urls=links), result, threading.Event(), sources=[],
                        inspect=inspect, search=lambda *_: [], save=lambda *_: None, check=lambda *_: None,
                        supports_url=lambda url: supported_url(url, {"dobytranslations.com", "novelupdates.com"}))
        self.assertEqual([doby], [call.args[1] for call in inspect.call_args_list])
        self.assertEqual(1, result["checkedLinkCount"])
        self.assertEqual(1, result["totalLinkCount"])
        self.assertEqual([], result["warnings"])

    def test_recovered_retries_do_not_inspect_previously_saved_unsupported_links(self):
        from integration_store import empty_result
        from unittest.mock import Mock
        url = "https://www.novelupdates.com/series/test/"
        result = empty_result()
        result.update(_retryUrls=[url], _retryDomains=[], _doneUrls=[url], totalLinkCount=1)
        inspect = Mock()
        search_metadata("test", dict(query="Test", urls=[url]), result, threading.Event(), sources=[],
                        inspect=inspect, search=lambda *_: [], save=lambda *_: None, check=lambda *_: None,
                        supports_url=lambda target: supported_url(target, {"dobytranslations.com"}))
        inspect.assert_not_called()
        self.assertEqual(0, result["checkedLinkCount"])
        self.assertEqual(0, result["totalLinkCount"])


if __name__ == "__main__":
    unittest.main()
