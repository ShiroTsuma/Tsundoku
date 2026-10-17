import logging
from typing import Iterable, Optional

from lncrawl.core import Chapter, Novel, PageSoup, Volume
from lncrawl.templates.mangastream import MangaStreamTemplate

logger = logging.getLogger(__name__)


class Dobytranslations(MangaStreamTemplate):
    has_mtl = False
    has_manga = False
    can_search = True
    base_url = ["https://dobytranslations.com/"]

    def select_chapter_tags(
        self,
        tag: PageSoup,
        novel: Novel,
        volume: Optional[Volume] = None,
    ) -> Iterable[PageSoup]:
        """Return free chapters in reading order, without summary duplicates."""
        for chapter_list in tag.select(".eplister ul.ep-chapter-list.scrollable-list"):
            heading = chapter_list.find_previous_sibling(
                "div", class_="section-title-container"
            )
            if heading and "Free Chapters" in heading.get_text(" ", strip=True):
                return reversed(list(chapter_list.select("li a[href]")))
        return []

    def parse_chapter_body(self, soup: PageSoup, chapter: Chapter) -> None:
        super().parse_chapter_body(soup, chapter)
        if "login to buy access to this content" in (chapter.body or "").lower():
            logger.info("Skipping locked chapter: %s", chapter.url)
            chapter.body = None
