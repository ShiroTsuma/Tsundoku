"""Crawler eligibility is independent of the book's saved reference links."""
from urllib.parse import urlsplit


def allowed_host(host):
    host = (host or "").lower().rstrip(".")
    return bool(host) and host != "novelupdates.com" and not host.endswith(".novelupdates.com")


def normalized_host(host):
    host = (host or "").lower().rstrip(".")
    return host[4:] if host.startswith("www.") else host


def supported_url(url, domains):
    try:
        parsed = urlsplit(url)
        return (parsed.scheme in ("http", "https") and allowed_host(parsed.hostname)
                and not parsed.username and not parsed.password and parsed.port in (None, 80, 443)
                and bool(parsed.path.strip("/")) and normalized_host(parsed.hostname) in domains)
    except (ValueError, TypeError):
        return False
