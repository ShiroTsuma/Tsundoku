"""Resolve saved selections against the freshly inspected chapter index."""


def resolve_chapter_ids(chapters, current, plan):
    # Engine row IDs belong to its database, not to the saved book metadata.
    # Match URLs at the selected positions so rebuilding engine rows is harmless,
    # while removed, replaced or reordered chapters still require a new search.
    first, last = plan["firstChapter"], plan["lastChapter"]
    ids = plan["chapterIds"]
    saved = chapters[first - 1:last]
    available = current[first - 1:last]
    if (first < 1 or last < first or not ids or len(ids) != len(set(ids))
            or len(saved) != last - first + 1 or len(available) != len(saved)
            or [c["id"] for c in saved] != ids
            or [c["url"] for c in saved] != [c["url"] for c in available]
            or len({c["id"] for c in available}) != len(available)):
        raise ValueError("The source chapter list changed. Refresh the selected source before downloading again.")
    return [c["id"] for c in available]
