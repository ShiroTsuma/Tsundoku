"""Small, assertion-checked extension against the pinned 4.14.0 EPUB builder."""
from pathlib import Path

path = Path("lncrawl/services/binder/epub.py")
text = path.read_text()
replacements = {
    'book.set_identifier(novel.id)': 'book.set_identifier(f"{novel.id}:{artifact.file_name}")',
    'book.set_title(novel.title)': 'book.set_title(kwargs.get("title") or novel.title)',
    'for chapter in ctx.chapters.list(volume_id=volume.id, language=language):':
        'for chapter in ctx.chapters.list(volume_id=volume.id, language=language):\n'
        '            if chapter.id not in kwargs["chapter_ids"]:\n'
        '                continue',
    'for image in ctx.images.list(novel_id=artifact.novel_id):':
        'for image in ctx.images.list(novel_id=artifact.novel_id):\n'
        '        if image.chapter_id not in kwargs["chapter_ids"]:\n'
        '            continue',
}
for old, new in replacements.items():
    assert text.count(old) == 1, f"Upstream EPUB builder changed: {old}"
    text = text.replace(old, new)
path.write_text(text)
