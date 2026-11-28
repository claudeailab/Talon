"""Turn HTTPS on or off for the web interface.

Off serves plain HTTP on port 80 (useful behind Cloudflare or another proxy
that provides HTTPS itself); on returns to HTTPS on its previous port. The
choice is written to /etc/talon/config.json, so the updater and the installer
see it too, and Talon restarts to apply it.
"""
from __future__ import annotations

import json
import os
import socket
import subprocess
import threading
import time

from . import config
from .util import UserError, write_atomic

HTTP_PORT = 80


def _port_free(port: int) -> bool:
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        s.bind(("0.0.0.0", port))
        return True
    except OSError:
        return False
    finally:
        s.close()


def fingerprint(path: str) -> str:
    """SHA-256 of Talon's HTTPS certificate, as "AB:CD:…" (what the iPhone app shows to check it)."""
    import hashlib
    import ssl
    try:
        with open(path) as f:
            der = ssl.PEM_cert_to_DER_cert(f.read())
    except (OSError, ValueError):
        return ""
    return ":".join(f"{b:02X}" for b in hashlib.sha256(der).digest())


def set_https(cfg, on: bool, user: str, state) -> dict:
    if on == cfg.https:
        return {"https": cfg.https, "port": cfg.port, "restarting": False}
    if on:
        port = cfg.https_port or 443
        if not cfg.demo and not os.path.exists(cfg.tls_cert):
            raise UserError("The HTTPS certificate is missing; run the installer again to create it")
    else:
        port = HTTP_PORT
        from . import redirect
        ours = redirect.server is not None and port == redirect.HTTP_PORT   # our own http:// redirect
        if not cfg.demo and port != cfg.port and not ours and not _port_free(port):
            raise UserError(f"Port {port} is used by another program")
    if not cfg.demo:
        try:
            with open(config.CONFIG_PATH) as f:
                data = json.load(f)
        except (OSError, ValueError):
            data = {}
        if on:
            data.update(https=True, port=port)
        else:
            data.update(https=False, port=port, https_port=cfg.port)
        write_atomic(config.CONFIG_PATH, json.dumps(data, indent=2) + "\n")
    cfg.https_port = cfg.port if not on else cfg.https_port
    cfg.https, cfg.port = on, port
    state.log_activity(user, f"Turned HTTPS {'on' if on else 'off'} (port {port}); restarting")
    if not cfg.demo:
        def restart():
            time.sleep(1.5)                     # let the response reach the browser
            subprocess.run(["systemctl", "restart", "talon"], check=False)
        threading.Thread(target=restart, daemon=True, name="restart").start()
    return {"https": on, "port": port, "restarting": not cfg.demo}
