"""http:// → https:// while HTTPS is on."""
import http.client
import socket

from talon import redirect


def test_target():
    assert redirect.target("nas.local", "/files?x=1", 443, "10.0.0.2") == "https://nas.local/files?x=1"
    assert redirect.target("192.168.1.26:80", "/", 443, "10.0.0.2") == "https://192.168.1.26/"
    assert redirect.target("192.168.1.26", "/", 8443, "10.0.0.2") == "https://192.168.1.26:8443/"
    assert redirect.target("", "/", 443, "10.0.0.2") == "https://10.0.0.2/"
    assert redirect.target("evil.com/x\r\nSet-Cookie: a", "/", 443, "10.0.0.2") == "https://10.0.0.2/"
    assert redirect.target("[fe80::1]:80", "/", 443, "x") == "https://[fe80::1]/"
    assert redirect.target("nas", "//evil.com/", 443, "x") == "https://nas/"


def test_listener_redirects(monkeypatch):
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    monkeypatch.setattr(redirect, "HTTP_PORT", port)
    assert redirect.start(443, "127.0.0.1")
    try:
        c = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
        c.request("GET", "/settings?tab=network", headers={"Host": "nas.local"})
        r = c.getresponse()
        assert r.status == 302 and r.getheader("Cache-Control") == "no-store" and r.getheader("Location") == "https://nas.local/settings?tab=network"
        assert not redirect.start(443, "127.0.0.1")          # the port is taken: not started twice
    finally:
        redirect.server.shutdown()
        redirect.server.server_close()
        redirect.server = None
