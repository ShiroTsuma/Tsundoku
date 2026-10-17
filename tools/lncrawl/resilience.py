"""Bounded source retries. No credentials, challenge solving or IP rotation."""
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
import socket
import os


class TemporarySourceError(Exception):
    def __init__(self, host, retry_at, reason="Source temporarily unavailable", *, attempted=True, outcome="timeout"):
        super().__init__(reason)
        self.host = host
        self.retry_at = retry_at
        self.attempted = attempted
        self.outcome = outcome


class SourcePausedError(ValueError):
    def __init__(self, message, attempted=False):
        super().__init__(message)
        self.attempted = attempted


class SourceBusyError(ValueError):
    pass


def needs_browser_verification(exc):
    current, visited = exc, set()
    while current is not None and id(current) not in visited:
        visited.add(id(current))
        detail = f"{getattr(current, 'detail', '')} {current}".lower()
        if any(marker in detail for marker in ("managed javascript challenge", "turnstile", "captcha", "browser verification")):
            return True
        current = current.__cause__ or current.__context__
    return False


def check_source_pause(store, host, now, attempted=False):
    pause = store.source_pause(host)
    if pause and pause["until"] > now:
        raise SourcePausedError(f"{host}: {pause['reason']} Further requests are paused until {iso_time(pause['until'])}.", attempted)


def call_with_source_pause(store, host, action, now):
    check_source_pause(store, host, now)
    try:
        return action()
    except Exception as exc:
        if needs_browser_verification(exc):
            delay = max(1, float(os.environ.get("CRAWLER_VERIFICATION_PAUSE_SECONDS", "900")))
            current, visited = exc, set()
            while current is not None and id(current) not in visited:
                visited.add(id(current))
                response = getattr(current, "response", None)
                if response is not None:
                    delay = max(delay, retry_after(response.headers.get("Retry-After"), now))
                current = current.__cause__ or current.__context__
            store.source_pause(host, now + delay, "Source requires browser verification.")
            check_source_pause(store, host, now, attempted=True)
        raise


def iso_time(epoch):
    return datetime.fromtimestamp(epoch, timezone.utc).isoformat()


def retry_after(value, now):
    try:
        return max(0, float(value))
    except (TypeError, ValueError):
        try:
            return max(0, parsedate_to_datetime(value).timestamp() - now)
        except (TypeError, ValueError, OverflowError):
            return 0


def transient_failure(exc, now):
    """Return (minimum delay, safe reason), or None for permanent/unknown errors."""
    current, visited = exc, set()
    while current is not None and id(current) not in visited:
        visited.add(id(current))
        # The scraper has explicit errors for authentication/signatures/challenges.
        name = type(current).__name__
        layer = getattr(getattr(current, "layer", None), "name", None)
        if name in ("Impassable", "ConfigError", "MissingDependency", "Poisoned", "Aborted"):
            return None
        response = getattr(current, "response", None)
        if layer == "BEHAVIOURAL" and "rate limited" in getattr(current, "detail", "").lower():
            return (retry_after(response.headers.get("Retry-After"), now) if response is not None else 0), "Source rate limit"
        if layer and layer not in ("IP_REPUTATION", "UNDER_ATTACK", "BEHAVIOURAL"):
            return None
        if response is not None:
            status = response.status_code
            if status in (408, 425, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524):
                return retry_after(response.headers.get("Retry-After"), now), (
                    "Source rate limit" if status == 429 else "Source temporarily unavailable")
            if status == 403 and layer == "IP_REPUTATION":
                return max(300, retry_after(response.headers.get("Retry-After"), now)), "Source temporarily refusing requests"
            if status >= 400:
                return None
        if isinstance(current, (TimeoutError, socket.timeout, ConnectionError)) or name in (
                "Timeout", "ConnectTimeout", "ReadTimeout", "ConnectionError", "ProxyError"):
            return 0, "Source connection interrupted"
        if name in ("Blocked", "Exhausted") and (layer in ("IP_REPUTATION", "UNDER_ATTACK") or
                any(reason in getattr(current, "detail", "").lower() for reason in
                    ("origin unavailable", "exit unusable", "transport failure"))):
            return 300, "Source temporarily refusing requests"
        current = current.__cause__ or current.__context__
    return None


def observed_call(crawler, action):
    """Retain the response the pinned scraper otherwise discards on exhaustion.

    _overrule is called for every HTTP response, before the retry planner acts.
    Preserve its source-specific checks and retain HTTP Retry-After/status only.
    """
    scraper = crawler.scraper
    original = scraper._overrule
    last_response = None

    def observe(response, body, diagnosis):
        nonlocal last_response
        last_response = response
        return original(response, body, diagnosis)

    scraper._overrule = observe
    try:
        return action()
    except Exception as exc:
        if last_response is not None and not hasattr(exc, "response"):
            exc.response = last_response
        raise
    finally:
        scraper._overrule = original
