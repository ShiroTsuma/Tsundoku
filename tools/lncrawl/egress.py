"""HTTP(S) forward proxy which connects only to validated public IP addresses.

Resolve once, validate every answer, connect to the numeric address. Redirects and
CONNECT requests pass through the same check, including IPv4-mapped IPv6.
"""
import ipaddress
import select
import socket
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit
from source_policy import allowed_host
from processing_control import processing_enabled


def public_addresses(host, port):
    if not processing_enabled():
        raise ValueError("Crawler processing is paused")
    if not allowed_host(host):
        raise ValueError("Reference site excluded from crawler traffic")
    if port not in (80, 443):
        raise ValueError("Port is blocked")
    addresses = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    if not addresses or any(not ipaddress.ip_address(item[4][0]).is_global for item in addresses):
        raise ValueError("Destination is not public")
    return addresses


def connect_public(host, port):
    addresses = public_addresses(host, port)
    for family, kind, protocol, _, address in addresses:
        target = socket.socket(family, kind, protocol)
        target.settimeout(30)
        try:
            target.connect(address)
            return target
        except OSError:
            target.close()
    raise OSError("Public destination unavailable")


class Proxy(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *_args):
        pass  # URLs can include private source parameters.

    def relay(self, upstream):
        self.connection.settimeout(60)
        upstream.settimeout(60)
        while True:
            ready, _, _ = select.select([self.connection, upstream], [], [], 60)
            if not ready:
                break
            for source in ready:
                data = source.recv(65536)
                if not data:
                    return
                (upstream if source is self.connection else self.connection).sendall(data)

    def do_CONNECT(self):
        try:
            address = urlsplit("//" + self.path)
            if address.username or address.password:
                raise ValueError("Credentials are not allowed")
            with connect_public(address.hostname, address.port or 443) as upstream:
                self.send_response(200, "Connection Established")
                self.end_headers()
                self.relay(upstream)
        except (OSError, ValueError):
            self.send_error(403, "Destination blocked or unavailable")
        finally:
            self.close_connection = True

    def do_GET(self):
        self.forward()

    def do_POST(self):
        self.forward()

    def do_HEAD(self):
        self.forward()

    def forward(self):
        try:
            address = urlsplit(self.path)
            if address.scheme != "http" or not address.hostname or address.username or address.password:
                raise ValueError("An absolute HTTP URL is required")
            if self.headers.get("Transfer-Encoding"):
                raise ValueError("Chunked request bodies are not supported")
            length = int(self.headers.get("Content-Length", "0"))
            if length < 0 or length > 2 * 1024 * 1024:
                raise ValueError("Request body too large")
            with connect_public(address.hostname, address.port or 80) as upstream:
                path = address.path or "/"
                if address.query:
                    path += "?" + address.query
                headers = f"{self.command} {path} HTTP/1.1\r\nHost: {address.netloc}\r\nConnection: close\r\n"
                for name, value in self.headers.items():
                    if name.lower() not in ("host", "connection", "proxy-connection", "proxy-authorization", "keep-alive"):
                        headers += f"{name}: {value}\r\n"
                upstream.sendall((headers + "\r\n").encode("latin-1"))
                while length:
                    chunk = self.rfile.read(min(length, 65536))
                    if not chunk:
                        raise OSError("Incomplete request body")
                    upstream.sendall(chunk)
                    length -= len(chunk)
                while True:
                    data = upstream.recv(65536)
                    if not data:
                        break
                    self.connection.sendall(data)
        except (OSError, ValueError):
            self.send_error(403, "Destination blocked or unavailable")
        finally:
            self.close_connection = True


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", 3128), Proxy).serve_forever()
