"""Exercise our patch against the installed engine without modifying it."""
import inspect
from pathlib import Path
import tempfile
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import patch
from xml.etree import ElementTree as ET
from zipfile import ZipFile

from lncrawl.services.binder import epub as upstream
from patch_upstream import patch_text


class EpubBuilderTests(unittest.TestCase):
    def test_front_cover_and_both_tables_of_contents_link_only_selected_chapters(self):
        builder = ModuleType("lncrawl.services.binder.tsundoku_test_builder")
        builder.__package__ = "lncrawl.services.binder"
        exec(compile(patch_text(inspect.getsource(upstream)), "patched_epub.py", "exec"), builder.__dict__)
        for with_cover in (False, True):
            with self.subTest(with_cover=with_cover), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                (root / "work").mkdir()
                # The builder embeds bytes as-is; decoding images isn't involved.
                (root / "cover.jpg").write_bytes(b"test-cover-image")
                novel = SimpleNamespace(id="novel", title="Original novel", authors="Author", synopsis="Synopsis",
                    url="https://example.com/novel", language="en", tags=[], rtl=False,
                    cover_available=with_cover, cover_file="cover.jpg", created_at=0, updated_at=1000)
                chapters = [SimpleNamespace(id=str(i), serial=i, title=f"Chapter {i}", is_available=True,
                    content_file=f"body-{i}") for i in range(1, 5)]
                fake = SimpleNamespace(novels=SimpleNamespace(get=lambda *_: novel),
                    volumes=SimpleNamespace(list=lambda *_: [SimpleNamespace(id="volume", serial=1, title="Volume")]),
                    chapters=SimpleNamespace(list=lambda **_: chapters), images=SimpleNamespace(list=lambda **_: []),
                    files=SimpleNamespace(resolve=lambda name: root / name, load_text=lambda name: f"<p>{name}</p>"))
                artifact = SimpleNamespace(output_file="output/part.epub", file_name="part.epub", novel_id="novel", volume=None, language=None)
                with patch.object(builder, "ctx", fake):
                    builder.make_epub(root / "work", artifact, chapter_ids={"2", "3"}, title="Volume 6")
                with ZipFile(root / "output/part.epub") as archive:
                    names = archive.namelist()
                    for name in ("front.xhtml", "intro.xhtml", "nav.xhtml", "toc.ncx", "chapter_00002.xhtml", "chapter_00003.xhtml"):
                        self.assertIn(f"EPUB/{name}", names)
                    self.assertNotIn("EPUB/chapter_00001.xhtml", names)
                    self.assertNotIn("EPUB/chapter_00004.xhtml", names)
                    self.assertEqual(with_cover, "EPUB/cover.jpg" in names)
                    for toc in ("nav.xhtml", "toc.ncx"):
                        text = archive.read(f"EPUB/{toc}").decode()
                        self.assertIn("front.xhtml", text)
                        self.assertIn("chapter_00002.xhtml", text)
                        self.assertNotIn("chapter_00001.xhtml", text)
                    opf = ET.fromstring(archive.read("EPUB/content.opf"))
                    ns = {"o": "http://www.idpf.org/2007/opf"}
                    manifest = {item.attrib["id"]: item.attrib["href"] for item in opf.find("o:manifest", ns)}
                    spine = [manifest[item.attrib["idref"]] for item in opf.find("o:spine", ns)]
                    self.assertLess(spine.index("front.xhtml"), spine.index("nav.xhtml"))
                    self.assertLess(spine.index("nav.xhtml"), spine.index("chapter_00002.xhtml"))
                    self.assertIn("Table of contents", archive.read("EPUB/nav.xhtml").decode())
