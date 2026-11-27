"""http:// → https://: while Talon serves HTTPS, a small listener on port 80 sends
anyone who typed http://<nas>/ (or forgot the "s") to the same page over HTTPS.

It runs only when HTTPS is on. With HTTPS turned off Talon itself serves plain
HTTP on port 80, so nothing is redirected. If another program already uses port 80
the listener is simply not started."""
from __future__ import annotations

import re
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Optional

HTTP_PORT = 80
_HOST_RE = re.compile(r"^(\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9.-]+)(:\d+)?$")

# the listener of this process, so turning HTTPS off does not mistake it for another program
server: Optional[ThreadingHTTPServer] = None


def target(host_header: str, path: str, https_port: int, fallback_host: str) -> str:
    """The https:// address for a request: same host name and path, Talon's HTTPS port."""
    m = _HOST_RE.match((host_header or "").strip())
    host = m.group(1) if m else fallback_host
    if ":" in host and not host.startswith("["):          # a bare IPv6 address
        host = f"[{host}]"
    port = "" if https_port == 443 else f":{https_port}"
    if not path.startswith("/") or path.startswith("//"):
        path = "/"
    return f"https://{host}{port}{path}"


def _handler(https_port: int):
    class Redirect(BaseHTTPRequestHandler):
        server_version = "Talon"
        sys_version = ""

        def _go(self) -> None:
            local = self.connection.getsockname()[0]
            url = target(self.headers.get("Host", ""), self.path, https_port, local)
            self.send_response(308 if self.command not in ("GET", "HEAD") else 301)
            self.send_header("Location", url)
            self.send_header("Content-Length", "0")
            self.send_header("Connection", "close")
            self.end_headers()

        do_GET = do_HEAD = do_POST = do_PUT = do_DELETE = do_PATCH = do_OPTIONS = _go

        def log_message(self, *_a) -> None:                # quiet
            pass

    return Redirect


def start(https_port: int, host: str = "0.0.0.0") -> bool:
    """Start the listener in the background; False when port 80 is not free."""
    global server
    if https_port == HTTP_PORT:
        return False
    try:
        srv = ThreadingHTTPServer((host, HTTP_PORT), _handler(https_port))
    except OSError:
        return False
    srv.daemon_threads = True
    server = srv
    threading.Thread(target=srv.serve_forever, name="talon-http-redirect", daemon=True).start()
    return True
