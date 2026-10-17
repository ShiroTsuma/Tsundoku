"""Persistent processing switch, shared read-only with the egress proxy."""
import json
import os
from pathlib import Path
from uuid import uuid4


class ProcessingPaused(InterruptedError):
    pass


def state_path():
    return Path(os.environ.get('LNCRAWL_DATA_PATH', '/data')) / 'processing-state.json'


def processing_enabled():
    try:
        return json.loads(state_path().read_text())['enabled'] is True
    except FileNotFoundError:
        return os.environ.get('CRAWLER_RUN_JOBS', 'true').lower() == 'true'
    except (OSError, ValueError, KeyError, TypeError):
        return False


def set_processing(enabled):
    if type(enabled) is not bool:
        raise ValueError('Choose whether processing is enabled')
    path = state_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f'.processing-{uuid4()}.tmp')
    try:
        temporary.write_text(json.dumps({'enabled': enabled}))
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)
    return {'processingEnabled': processing_enabled()}
