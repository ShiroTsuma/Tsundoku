"""Run in the crawler image, against the shipped engine and local source fix."""
import importlib.util
from pathlib import Path
import unittest
import tempfile
from types import SimpleNamespace
from unittest.mock import patch
from bs4 import BeautifulSoup
from ebooklib import epub
from lncrawl.core import Novel, PageSoup
from lncrawl.services.binder import epub as builder
from resilience import observed_call, transient_failure

spec = importlib.util.spec_from_file_location("doby_local", Path("sources/en/d/dobytranslations.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ScraperRetryRegressionTests(unittest.TestCase):
    def test_pinned_scraper_preserves_rate_limit_header_with_probe_attempt_limit(self):
        from scraper import Scraper, ScraperConfig, PacingPolicy
        from requests import Response
        response = Response()
        response.status_code = 429
        response.headers["Retry-After"] = "900"
        response._content = b"Too many requests"
        response.url = "https://example.com/novel"
        scraper = Scraper("https://example.com", config=ScraperConfig(
            max_attempts=1, browser=None, remember=False,
            pacing=PacingPolicy(interval=0, floor=0, warmup=False)))
        # Exercise the real diagnosis/planner/exception path without a network call.
        with patch("scraper.tiers.direct.DirectTier.send", return_value=response):
            with self.assertRaises(Exception) as caught:
                observed_call(SimpleNamespace(scraper=scraper), lambda: scraper.get(response.url))
        scraper.close()
        self.assertEqual(900, transient_failure(caught.exception, 1000)[0])


class DobyRegressionTests(unittest.TestCase):
    def test_only_free_chapters_in_reading_order_without_summary_duplicates(self):
        soup = BeautifulSoup('''<div class="eplister">
          <ul><li><a href="/chapter-1">Duplicate summary entry</a></li></ul>
          <div class="section-title-container">Paid Chapters</div>
          <ul class="ep-chapter-list scrollable-list"><li><a href="/paid">Locked</a></li></ul>
          <div class="section-title-container">Free Chapters</div>
          <ul class="ep-chapter-list scrollable-list">
            <li><a href="/chapter-2">Chapter 2</a></li>
            <li><a href="/chapter-1">Chapter 1</a></li>
          </ul></div>''', "html.parser")
        crawler = object.__new__(module.Dobytranslations)
        tags = crawler.select_chapter_tags(soup, Novel(url="https://dobytranslations.com/series/test/"))
        self.assertEqual(["/chapter-1", "/chapter-2"], [tag["href"] for tag in tags])
        tags = crawler.select_chapter_tags(PageSoup.create(str(soup)), Novel(url="https://dobytranslations.com/series/test/"))
        self.assertEqual(["/chapter-1", "/chapter-2"], [tag["href"] for tag in tags])

    def test_missing_free_section_does_not_return_paid_or_duplicate_chapters(self):
        crawler = object.__new__(module.Dobytranslations)
        soup = BeautifulSoup('<div class="eplister"><ul class="ep-chapter-list scrollable-list"><li><a href="/paid">Paid</a></li></ul></div>', "html.parser")
        self.assertEqual([], list(crawler.select_chapter_tags(soup, Novel(url="https://dobytranslations.com/series/test/"))))

    def test_locked_purchase_message_is_never_a_chapter_body(self):
        crawler = object.__new__(module.Dobytranslations)
        chapter = SimpleNamespace(url="https://dobytranslations.com/locked", body="Please LOGIN TO BUY ACCESS TO THIS CONTENT")
        with patch.object(module.MangaStreamTemplate, "parse_chapter_body", return_value=None):
            crawler.parse_chapter_body(None, chapter)
        self.assertIsNone(chapter.body)


class EpubSelectionTests(unittest.TestCase):
    def test_real_epub_builder_includes_only_selected_chapters_and_requested_title(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            work = root / "work"
            work.mkdir()
            novel = SimpleNamespace(id="novel", title="Original title", authors="Author", synopsis="Synopsis", url="https://example.com/novel", language="en", tags=[], rtl=False, cover_available=False, created_at=0, updated_at=1000)
            volume = SimpleNamespace(id="volume", serial=1, title="Volume")
            chapters = [SimpleNamespace(id=str(i), serial=i, title=f"Chapter {i}", is_available=True, content_file=f"body-{i}") for i in range(1, 5)]
            fake = SimpleNamespace(novels=SimpleNamespace(get=lambda *_: novel), volumes=SimpleNamespace(list=lambda *_: [volume]),
                                   chapters=SimpleNamespace(list=lambda **_: chapters), images=SimpleNamespace(list=lambda **_: []),
                                   files=SimpleNamespace(resolve=lambda name: root / name, load_text=lambda name: f"<p>{name}</p>"))
            artifact = SimpleNamespace(output_file="output/part.epub", file_name="part.epub", novel_id="novel", volume=None, language=None)
            with patch.object(builder, "ctx", fake):
                builder.make_epub(work, artifact, chapter_ids={"2", "3"}, title="Part 4")
            book = epub.read_epub(root / "output/part.epub")
            names = [item.file_name for item in book.get_items()]
            self.assertIn("chapter_00002.xhtml", names)
            self.assertIn("chapter_00003.xhtml", names)
            self.assertNotIn("chapter_00001.xhtml", names)
            self.assertNotIn("chapter_00004.xhtml", names)
            self.assertEqual("Part 4", book.get_metadata("DC", "title")[0][0])


if __name__ == "__main__":
    unittest.main()
