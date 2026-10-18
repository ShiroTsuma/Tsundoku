import unittest
from download_plan import resolve_chapter_ids


class DownloadPlanTests(unittest.TestCase):
    def setUp(self):
        self.saved = [dict(id=str(i), url=f'https://example.com/chapter/{i}') for i in range(1, 4)]
        self.plan = dict(firstChapter=1, lastChapter=3, chapterIds=['1', '2', '3'])

    def test_recreated_engine_ids_and_new_chapters_preserve_selected_range(self):
        current = [dict(c, id=f'new-{c["id"]}') for c in self.saved]
        current.append(dict(id='4', url='https://example.com/chapter/4'))
        self.assertEqual(['new-1', 'new-2', 'new-3'], resolve_chapter_ids(self.saved, current, self.plan))

    def test_removed_replaced_or_reordered_chapters_require_refresh(self):
        for current in (self.saved[:-1], list(reversed(self.saved)),
                        [dict(c, url='https://example.com/replaced') for c in self.saved]):
            with self.subTest(current=current), self.assertRaises(ValueError):
                resolve_chapter_ids(self.saved, current, self.plan)

    def test_custom_range_resolves_current_ids(self):
        current = [dict(c, id=f'new-{c["id"]}') for c in self.saved]
        self.assertEqual(['new-2', 'new-3'], resolve_chapter_ids(self.saved, current,
            dict(firstChapter=2, lastChapter=3, chapterIds=['2', '3'])))
