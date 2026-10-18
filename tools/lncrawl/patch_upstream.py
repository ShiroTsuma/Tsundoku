"""Small, assertion-checked extension against the pinned 4.14.0 EPUB builder."""
from pathlib import Path

replacements = {
    'book.set_identifier(novel.id)': 'book.set_identifier(f"{novel.id}:{artifact.file_name}")',
    'book.set_title(novel.title)': 'book.set_title(kwargs.get("title") or novel.title)',
    'book.add_item(epub.EpubNav())': 'book.add_item(epub.EpubNav(title="Table of contents"))',
    '    # add intro page':
        '    if not novel.cover_available:\n'
        '        from html import escape\n'
        '        front = epub.EpubHtml(file_name="front.xhtml", title="Front Page",\n'
        '            content=f"<h1>{escape(novel.title)}</h1><h2>{escape(kwargs.get(\'title\') or novel.title)}</h2>")\n'
        '        book.add_item(front)\n'
        '        spine.append(front)\n'
        '        toc.append(front)\n\n'
        '    # add intro page',
    'for chapter in ctx.chapters.list(volume_id=volume.id, language=language):':
        'for chapter in ctx.chapters.list(volume_id=volume.id, language=language):\n'
        '            if chapter.id not in kwargs["chapter_ids"]:\n'
        '                continue',
    'for image in ctx.images.list(novel_id=artifact.novel_id):':
        'for image in ctx.images.list(novel_id=artifact.novel_id):\n'
        '        if image.chapter_id not in kwargs["chapter_ids"]:\n'
        '            continue',
}
def patch_text(text):
    for old, new in replacements.items():
        assert text.count(old) == 1, f"Upstream EPUB builder changed: {old}"
        text = text.replace(old, new)
    return text


if __name__ == "__main__":
    path = Path("lncrawl/services/binder/epub.py")
    path.write_text(patch_text(path.read_text()))
