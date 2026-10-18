"""Tiny Translation's custom WordPress series/catalog layout."""
import json
import re
import unicodedata
from html import escape
from urllib.parse import urlsplit, urlunsplit

from lncrawl.core import Chapter, Crawler, Novel, PageSoup, SearchResult, Volume
from lncrawl.exceptions import LNException


def normalized_title(value):
    value = unicodedata.normalize("NFKD", value).casefold()
    return " ".join(re.findall(r"[^\W_]+", "".join(c for c in value if not unicodedata.combining(c))))


class TinyTranslation(Crawler):
    language = "en"
    base_url = ["https://www.tinytranslation.xyz/", "https://tinytranslation.xyz/"]
    can_search = True
    has_mtl = True
    has_manga = False

    def local_url(self, value):
        url = urlsplit(self.absolute_url(value))
        if url.scheme not in ("http", "https") or (url.hostname or "").lower() not in (
                "tinytranslation.xyz", "www.tinytranslation.xyz") or url.username or url.password or url.port not in (None, 80, 443):
            return None
        return urlunsplit(("https", "www.tinytranslation.xyz", url.path.rstrip("/") + "/", "", ""))

    def search(self, query):
        wanted = normalized_title(query)
        if not wanted:
            return []
        soup = self.scraper.get_soup(self.base_url[0] + "list-novels/")
        results, seen = [], set()
        for link in soup.select(".series-posts-list a[href]"):
            url = self.local_url(link["href"])
            title = link.get_text(" ", strip=True)
            if not url or not re.fullmatch(r"/series/[^/]+/", urlsplit(url).path) or url in seen:
                continue
            seen.add(url)
            candidate = normalized_title(title)
            if wanted in candidate or set(wanted.split()).issubset(candidate.split()):
                results.append(SearchResult(title=title, url=url))
        return results[:20]

    @staticmethod
    def book_metadata(soup):
        for script in soup.select('script[type="application/ld+json"]'):
            try:
                data = json.loads(script.get_text())
            except (ValueError, TypeError):
                continue
            entries = data if isinstance(data, list) else data.get("@graph", [data]) if isinstance(data, dict) else []
            for entry in entries:
                if not isinstance(entry, dict):
                    continue
                kinds = entry.get("@type") or []
                kinds = [kinds] if isinstance(kinds, str) else kinds
                if isinstance(kinds, list) and "Book" in kinds:
                    return entry
        return {}

    def read_novel(self, novel: Novel):
        url = self.local_url(novel.url)
        if not url or not re.fullmatch(r"/series/[^/]+/", urlsplit(url).path):
            raise LNException("Choose a Tiny Translation series page (/series/...).")
        soup = self.scraper.get_soup(url)
        content = soup.select_one(".entry-content")
        title = soup.select_one(".entry-content .title-content, h1.wp-block-post-title")
        if content is None or title is None:
            raise LNException("Tiny Translation series metadata was not found.")
        novel.title = title.get_text(" ", strip=True)
        novel.language = "en"
        metadata = self.book_metadata(soup)
        author = metadata.get("author", [])
        authors = author if isinstance(author, list) else [author]
        novel.author = ", ".join(str(a.get("name", "")) if isinstance(a, dict) else str(a) for a in authors)
        info = content.select_one("#info")
        details = info.get_text("\n", strip=True) if info else ""
        if not novel.author and (match := re.search(r"(?im)^\s*Author\s*:\s*([^\n]+)", details)):
            novel.author = match.group(1).strip()
        genres = metadata.get("genre", [])
        genres = genres if isinstance(genres, list) else str(genres).split(",")
        tags = genres + str(metadata.get("keywords", "")).split(",")
        for label in ("Genre", "Tags"):
            if match := re.search(rf"(?im)^\s*{label}\s*:\s*([^\n]+)", details):
                tags.extend(match.group(1).split(","))
        novel.tags = list(dict.fromkeys(str(tag).strip() for tag in tags if str(tag).strip()))
        cover = content.select_one(".separator img")
        if cover:
            cover_url = self.absolute_url(cover.get("data-src") or cover.get("src") or "")
            host = (urlsplit(cover_url).hostname or "").lower()
            if "noimagefound" not in cover_url.lower() and host != "novelupdates.com" and not host.endswith(".novelupdates.com"):
                novel.cover_url = cover_url
        description = metadata.get("description")
        if description:
            novel.synopsis = f"<p>{escape(str(description))}</p>"
        elif info:
            heading = next((h for h in info.select("h5") if "Synopsis" in h.get_text()), None)
            parts = []
            if heading:
                for node in heading.next_siblings:
                    if getattr(node, "name", None) == "h5":
                        break
                    if getattr(node, "name", None) not in ("script", "u"):
                        parts.append(str(node))
            holder = PageSoup.create("<div>" + "".join(parts) + "</div>").select_one("div")
            novel.synopsis = self.cleaner.extract_contents(holder)
        slug = urlsplit(url).path.strip("/").split("/")[1]
        seen, volumes = set(), {}
        novel.chapters, novel.volumes = [], []
        for link in content.select("ul li a[href]"):
            chapter_url = self.local_url(link["href"])
            if not chapter_url or not urlsplit(chapter_url).path.startswith(f"/{slug}/") or chapter_url in seen:
                continue
            label = link.get_text(" ", strip=True)
            if not label:
                continue
            seen.add(chapter_url)
            match = re.search(r"\bVolume\s+(\d+)\b", label, re.I)
            volume = int(match.group(1)) if match else 1
            if volume not in volumes:
                volumes[volume] = Volume(id=volume, title=f"Volume {volume}")
            novel.chapters.append(Chapter(id=len(novel.chapters) + 1, volume=volume, title=label, url=chapter_url))
        novel.volumes = list(volumes.values())
        if not novel.chapters:
            raise LNException("No public chapters were found on this Tiny Translation series page.")

    def download_chapter(self, chapter: Chapter):
        url = self.local_url(chapter.url)
        if not url:
            raise LNException("Unsupported Tiny Translation chapter URL.")
        soup = self.scraper.get_soup(url)
        body = soup.select_one(".entry-content > .content")
        if body is None:
            raise LNException("Tiny Translation chapter text was not found.")
        for tag in body.select("script, style, noscript, form, nav, .navigate, .title-content, #google_translate_element, .tooltip, .post-views"):
            tag.decompose()
        for paragraph in body.select("p"):
            text = paragraph.get_text(" ", strip=True)
            if (paragraph.select_one('a[href*="novelupdates.com"]') or text.startswith("Edited by ")
                    or "font-size: 12px" in (paragraph.get("style") or "")):
                paragraph.decompose()
        if not body.select("p") or not body.get_text(" ", strip=True):
            raise LNException("Tiny Translation returned an empty chapter.")
        chapter.body = self.cleaner.extract_contents(body)
