import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from processing_control import processing_enabled, set_processing
from egress import public_addresses


class ProcessingControlTests(unittest.TestCase):
    def test_runtime_switch_overrides_bootstrap_and_survives_reloads(self):
        with tempfile.TemporaryDirectory() as root, patch.dict(os.environ, LNCRAWL_DATA_PATH=root, CRAWLER_RUN_JOBS='false'):
            self.assertFalse(processing_enabled())
            self.assertTrue(set_processing(True)['processingEnabled'])
            self.assertTrue(processing_enabled())
            with patch('egress.socket.getaddrinfo', return_value=[]) as dns:
                with self.assertRaisesRegex(ValueError, 'not public'):
                    public_addresses('example.com', 443)
                dns.assert_called_once()
            self.assertFalse(set_processing(False)['processingEnabled'])
            with patch('egress.socket.getaddrinfo') as dns:
                with self.assertRaisesRegex(ValueError, 'paused'):
                    public_addresses('example.com', 443)
                dns.assert_not_called()
            self.assertEqual({'enabled': False}, json.loads((Path(root) / 'processing-state.json').read_text()))

    def test_invalid_state_fails_closed_and_invalid_updates_do_not_overwrite_it(self):
        with tempfile.TemporaryDirectory() as root, patch.dict(os.environ, LNCRAWL_DATA_PATH=root, CRAWLER_RUN_JOBS='true'):
            (Path(root) / 'processing-state.json').write_text('broken')
            self.assertFalse(processing_enabled())
            with self.assertRaises(ValueError):
                set_processing('true')
            self.assertFalse(processing_enabled())
