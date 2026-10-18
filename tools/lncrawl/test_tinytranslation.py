import json
from pathlib import Path
import unittest
from types import SimpleNamespace
from unittest.mock import Mock

from lncrawl.core import Chapter, Novel, PageSoup
from lncrawl.core.cleaner import TextCleaner
from lncrawl.exceptions import LNException
from lncrawl.services.sources.helper import batch_import, create_crawler_info
from overrides.tinytranslation import TinyTranslation


def crawler(html):
    instance = object.__new__(TinyTranslation)
    instance.scraper = SimpleNamespace(last_url="https://www.tinytranslation.xyz/", get_soup=Mock(
        side_effect=lambda _: PageSoup.create(html)))
    instance.cleaner = TextCleaner()
    return instance


class TinyTranslationTests(unittest.TestCase):
    def test_engine_loader_registers_both_hosts_as_searchable_english_source(self):
        loaded = list(batch_import(Path(__file__).parent / "overrides/tinytranslation.py"))
        self.assertEqual(1, len(loaded))
        info = create_crawler_info(loaded[0])
        self.assertEqual("en", info.language)
        self.assertTrue(info.can_search)
        self.assertTrue(info.has_mtl)
        self.assertIn("https://www.tinytranslation.xyz/", info.base_urls)
        self.assertIn("https://tinytranslation.xyz/", info.base_urls)

    def test_catalog_search_normalizes_punctuation_and_deduplicates_series(self):
        instance = crawler('''<ul class="series-posts-list">
          <li><a href="/series/quiet-life/">A Quiet Life — A Hero’s Return!</a></li>
          <li><a href="https://tinytranslation.xyz/series/quiet-life/#top">Duplicate title</a></li>
          <li><a href="/series/other/">Another Story</a></li>
          <li><a href="https://outside.example/series/quiet-life/">Quiet Life</a></li>
          <li><a href="/quiet-life/chapter-1/">Quiet Life Chapter</a></li></ul>''')
        result = instance.search("quiet life a hero's return")
        self.assertEqual(1, len(result))
        self.assertEqual("https://www.tinytranslation.xyz/series/quiet-life/", str(result[0].url))
        self.assertEqual([], instance.search("missing title"))

    def test_series_metadata_and_multiple_volume_lists_preserve_reading_order(self):
        metadata = json.dumps(dict(**{"@type": "Book"}, author={"name": "Test Author"},
            genre=["Fantasy"], keywords="Adventure, Fantasy", description="A synthetic test synopsis."))
        instance = crawler('''<div class="entry-content"><h2 class="title-content">Quiet Life</h2>
          <div class="separator"><img src="/wp-content/uploads/cover.jpg"></div>
          <script type="application/ld+json">''' + metadata + '''</script>
          <div id="info"><ul><li><a href="https://raw.example/book">Raw source</a></li></ul></div>
          <ul><li><a href="/quiet-life/v1c1/">Volume 1 Chapter 1</a></li>
          <li><a href="/quiet-life/v1c2/">Volume 1 Chapter 2</a></li></ul>
          <ul><li><a href="/quiet-life/v2c1/">Volume 2 Chapter 1</a></li>
          <li><a href="https://tinytranslation.xyz/quiet-life/v1c1/#top">Duplicate</a></li>
          <li><a href="/another-series/chapter/">Unrelated</a></li></ul></div>''')
        novel = Novel(url="https://tinytranslation.xyz/series/quiet-life/")
        instance.read_novel(novel)
        self.assertEqual("Quiet Life", novel.title)
        self.assertEqual("Test Author", novel.author)
        self.assertEqual("en", novel.language)
        self.assertEqual(["Fantasy", "Adventure"], novel.tags)
        self.assertIn("synthetic test synopsis", novel.synopsis)
        self.assertEqual("https://www.tinytranslation.xyz/wp-content/uploads/cover.jpg", novel.cover_url)
        self.assertEqual([1, 2, 3], [c.id for c in novel.chapters])
        self.assertEqual([1, 1, 2], [c.volume for c in novel.chapters])
        self.assertEqual(["Volume 1", "Volume 2"], [v.title for v in novel.volumes])

    def test_legacy_info_fallback_and_no_silent_empty_series(self):
        instance = crawler('''<div class="entry-content"><h2 class="title-content">Legacy</h2>
          <script type="application/ld+json">broken json</script>
          <div id="info">Author: Example Author<br>Genre: Fantasy, Adventure<br>Tags: Test<br>
          <h5>Synopsis:</h5><u>Raw Source</u><br>Test summary.<h5>Links:</h5>Not synopsis</div>
          <ul><li><a href="/legacy/chapter-1/">Chapter 1</a></li></ul></div>''')
        novel = Novel(url="https://www.tinytranslation.xyz/series/legacy/")
        instance.read_novel(novel)
        self.assertEqual("Example Author", novel.author)
        self.assertIn("Test summary.", novel.synopsis)
        self.assertNotIn("Raw Source", novel.synopsis)
        self.assertNotIn("Not synopsis", novel.synopsis)
        with self.assertRaises(LNException):
            crawler('<div class="entry-content"><h2 class="title-content">Empty</h2></div>').read_novel(novel)

    def test_body_keeps_story_images_and_notes_without_navigation_or_site_chrome(self):
        instance = crawler('''<div class="entry-content"><div class="content">
          <h2 class="title-content">Chapter 1</h2><div id="google_translate_element">Translate</div>
          <p style="font-size: 12px">2026-10-18</p>
          <p class="novel-paragraph">A synthetic chapter paragraph.</p><p><img src="/illustration.jpg"></p>
          <p class="novel-p">Notes: synthetic footnote.</p><div class="navigate"><a href="/next">Next</a></div>
          <p><a href="https://www.novelupdates.com/series/example/">Please rate</a></p>
          <p>Edited by Test Editor. Thanks for reading.</p><script>tracking()</script>
          </div><div class="post-views">Post Views</div></div>''')
        chapter = Chapter(id=1, url="https://www.tinytranslation.xyz/quiet-life/chapter-1/")
        instance.download_chapter(chapter)
        self.assertIn("synthetic chapter paragraph", chapter.body)
        self.assertIn("synthetic footnote", chapter.body)
        self.assertIn("illustration.jpg", chapter.body)
        for unwanted in ("Next", "Translate", "Please rate", "Edited by", "tracking", "2026-10-18", "Post Views"):
            self.assertNotIn(unwanted, chapter.body)

    def test_missing_chapter_body_and_external_series_are_errors(self):
        with self.assertRaises(LNException):
            crawler('<div class="entry-content">Unavailable</div>').download_chapter(
                Chapter(id=1, url="https://www.tinytranslation.xyz/book/chapter-1/"))
        with self.assertRaises(LNException):
            crawler("").read_novel(Novel(url="https://outside.example/series/book/"))

    def test_missing_cover_placeholder_does_not_download_from_excluded_reference_site(self):
        instance = crawler('''<div class="entry-content"><h2 class="title-content">Test</h2>
          <div class="separator"><img src="https://www.novelupdates.com/img/noimagefound.jpg"></div>
          <ul><li><a href="/test/chapter-1/">Chapter 1</a></li></ul></div>''')
        novel = Novel(url="https://www.tinytranslation.xyz/series/test/")
        instance.read_novel(novel)
        self.assertFalse(novel.cover_url)
