import tempfile
from pathlib import Path
import unittest
from integration_store import Store


class SourceHealthTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / 'jobs.db'
        self.store = Store(self.path)

    def tearDown(self):
        self.temp.cleanup()

    def record(self, job, outcome, at, kind='search'):
        self.store.submit(job, {'kind': kind})
        self.store.health.observe(job, 'www.example.com', outcome, at)

    def bad_history(self):
        for i, at in enumerate([1000, 1001, 2800, 2801, 4600, 4601]):
            self.record(str(i), 'timeout', at)

    def test_downloads_and_standalone_scans_never_affect_search_rates(self):
        self.record('download', 'timeout', 1000, 'download')
        self.record('scan', 'warning', 1000, 'inspect')
        self.assertEqual(0, self.store.health.state('example.com', 1000)['sampleCount'])

    def test_large_burst_does_not_disable_a_source(self):
        for i in range(100):
            self.record(str(i), 'timeout', 1000 + i)
        state = self.store.health.state('example.com', 1200)
        self.assertEqual(1, state['timeoutRate'])
        self.assertFalse(state['autoSkipped'])

    def test_persistent_failures_skip_but_preferred_and_pinned_sources_are_admitted(self):
        self.bad_history()
        self.assertTrue(self.store.health.state('example.com', 4700)['autoSkipped'])
        self.assertTrue(self.store.health.admit('example.com', now=4700))  # one recovery probe
        self.assertFalse(self.store.health.admit('example.com', now=4701))
        self.assertTrue(self.store.health.admit('example.com', preferred=True, now=4701))
        self.store.health.update('example.com', True, True)
        self.assertTrue(self.store.health.admit('example.com', now=4701))
        self.store.health.update('example.com', False, True)
        self.assertFalse(self.store.health.admit('example.com', preferred=True, now=4701))

    def test_recovery_and_settings_survive_restart(self):
        self.bad_history()
        self.record('recovered', 'success', 5000)
        self.assertFalse(self.store.health.state('example.com', 5000)['autoSkipped'])
        self.store.health.update('dobytranslations.com', True, False)
        other = Store(self.path)
        self.assertFalse(other.health.state('dobytranslations.com')['alwaysInclude'])
        self.assertFalse(other.health.state('webnovelover.com')['enabled'])

    def test_rate_limits_and_repeated_polling_do_not_create_bad_quality_evidence(self):
        for i, at in enumerate([1000,1001,2800,2801,4600,4601]):
            self.record(str(i), 'rate_limited', at)
        self.assertFalse(self.store.health.state('example.com', 4700)['autoSkipped'])
        for _ in range(10):
            self.record('same', 'timeout', 4700)
        self.assertEqual(7, self.store.health.state('example.com', 4700)['sampleCount'])


if __name__ == '__main__':
    unittest.main()
