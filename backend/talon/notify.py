"""SMTP email and notification rules."""
from __future__ import annotations

import re
import smtplib
import socket
import ssl
import threading
import time
from email.message import EmailMessage
from typing import Callable, Dict, List, Optional

from .util import UserError

EMAIL_RE = re.compile(r"^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$")
SECURITY = ("starttls", "ssl", "none")

# id -> (label, default on)
EVENTS: Dict[str, tuple] = {
    "raid": ("RAID degraded or failed", True),
    "disk": ("Disk health warning or failure", True),
    "disk_temp": ("Disk too hot", True),
    "volume_full": ("Volume almost full", True),
    "task_failed": ("Background task failed", True),
    "cloud_failed": ("OneDrive task failed", True),
    "update": ("Software update available", True),
    "os_updates": ("Operating system security updates", True),
    "virus": ("Virus found", True),
    "usb_backup": ("Backup completed or failed", True),
    "login_failed": ("Failed sign-in attempt", True),
}


def smtp_validate(data: dict, old: dict) -> dict:
    host = str(data.get("host", "")).strip()
    try:
        port = int(data.get("port") or 587)
    except (TypeError, ValueError):
        raise UserError("Port must be a number") from None
    if not 1 <= port <= 65535:
        raise UserError("Port must be between 1 and 65535")
    security = data.get("security", "starttls")
    if security not in SECURITY:
        raise UserError("Invalid connection security")
    sender = str(data.get("sender", "")).strip()
    # each field saves by itself, so the server may come before the sender; email is
    # "configured" (and used) only once both are there
    if sender and not EMAIL_RE.match(sender):
        raise UserError("Enter a valid sender address")
    if host and not re.match(r"^[A-Za-z0-9.\-]+$", host):
        raise UserError("Invalid SMTP server name")
    password = data.get("password")
    return {"host": host, "port": port, "security": security,
            "username": str(data.get("username", "")).strip(), "sender": sender,
            # an empty password field keeps the saved password
            "password": old.get("password", "") if password in (None, "") else str(password)}


def smtp_public(cfg: dict) -> dict:
    return {"host": cfg.get("host", ""), "port": cfg.get("port", 587),
            "security": cfg.get("security", "starttls"), "username": cfg.get("username", ""),
            "sender": cfg.get("sender", ""), "password_set": bool(cfg.get("password")),
            "configured": bool(cfg.get("host") and cfg.get("sender"))}


def _deliver(cfg: dict, action: Callable[[smtplib.SMTP], None]) -> None:
    """Connect, secure and sign in as configured, then run ``action``."""
    try:
        ctx = ssl.create_default_context()
        if cfg.get("security") == "ssl":
            smtp = smtplib.SMTP_SSL(cfg["host"], cfg["port"], timeout=20, context=ctx)
        else:
            smtp = smtplib.SMTP(cfg["host"], cfg["port"], timeout=20)
        with smtp:
            smtp.ehlo()
            if cfg.get("security") == "starttls":
                smtp.starttls(context=ctx)
                smtp.ehlo()
            if cfg.get("username"):
                smtp.login(cfg["username"], cfg.get("password", ""))
            action(smtp)
    except smtplib.SMTPAuthenticationError:
        raise UserError("The SMTP server rejected the user name or password") from None
    except smtplib.SMTPNotSupportedError:
        raise UserError("The server does not support this connection security") from None
    except (smtplib.SMTPException, ssl.SSLError) as e:
        raise UserError(f"SMTP error: {e}") from None
    except (socket.timeout, OSError) as e:
        raise UserError(f"Cannot connect to {cfg['host']}:{cfg['port']}: {e}") from None


def smtp_check(cfg: dict, demo: bool = False) -> List[dict]:
    """Test the server step by step without sending mail. Returns the same
    check list as the Entra ID test: connection, encryption, sign-in, sender."""
    if not (cfg.get("host") and cfg.get("sender")):
        raise UserError("Enter the SMTP server and the sender address")
    sec = {"starttls": "STARTTLS", "ssl": "SSL/TLS", "none": "None (not encrypted)"}[cfg.get("security", "starttls")]
    names = ["Connection", "Encryption", "Sign-in", "Sender address"]
    if demo:
        details = [f"{cfg['host']}:{cfg['port']} (demo)", sec,
                   f"Signed in as {cfg['username']}" if cfg.get("username") else "Not required",
                   f"{cfg['sender']} accepted"]
        return [{"name": n, "ok": True, "detail": d} for n, d in zip(names, details)]
    checks: List[dict] = []

    def ok(detail: str) -> None:
        checks.append({"name": names[len(checks)], "ok": True, "detail": detail})

    def fail(detail: str) -> List[dict]:
        checks.append({"name": names[len(checks)], "ok": False, "detail": detail})
        return checks

    ctx = ssl.create_default_context()
    try:
        if cfg.get("security") == "ssl":
            smtp = smtplib.SMTP_SSL(cfg["host"], cfg["port"], timeout=20, context=ctx)
        else:
            smtp = smtplib.SMTP(cfg["host"], cfg["port"], timeout=20)
    except ssl.SSLError as e:
        ok(f"{cfg['host']}:{cfg['port']}")
        return fail(f"SSL/TLS failed: {e.reason or e}")
    except (socket.timeout, OSError, smtplib.SMTPException) as e:
        return fail(f"Cannot connect to {cfg['host']}:{cfg['port']}: {e}")
    with smtp:
        try:
            smtp.ehlo()
            ok(f"{cfg['host']}:{cfg['port']}")
            if cfg.get("security") == "starttls":
                try:
                    smtp.starttls(context=ctx)
                    smtp.ehlo()
                except smtplib.SMTPNotSupportedError:
                    return fail("The server does not offer STARTTLS")
                except ssl.SSLError as e:
                    return fail(f"STARTTLS failed: {e.reason or e}")
            ok(sec)
            if cfg.get("username"):
                try:
                    smtp.login(cfg["username"], cfg.get("password", ""))
                except smtplib.SMTPAuthenticationError:
                    return fail("The server rejected the user name or password")
                except smtplib.SMTPNotSupportedError:
                    return fail("The server does not support sign-in on this connection")
                ok(f"Signed in as {cfg['username']}")
            else:
                ok("Not required")
            code, msg = smtp.mail(cfg["sender"])
            if code != 250:
                return fail(f"Refused: {msg.decode(errors='replace')}")
            smtp.rset()
            ok(f"{cfg['sender']} accepted")
        except (smtplib.SMTPException, socket.timeout, OSError) as e:
            return fail(f"SMTP error: {e}")
    return checks


def send_mail(cfg: dict, to: List[str], subject: str, body: str, demo: bool = False) -> None:
    if not (cfg.get("host") and cfg.get("sender")):
        raise UserError("SMTP is not configured")
    if not to:
        raise UserError("No recipient")
    for addr in to:
        if not EMAIL_RE.match(addr):
            raise UserError(f"Invalid email address: {addr}")
    if demo:
        return                                   # the demo never sends real mail
    msg = EmailMessage()
    msg["From"], msg["To"], msg["Subject"] = cfg["sender"], ", ".join(to), subject
    msg.set_content(body)
    _deliver(cfg, lambda smtp: smtp.send_message(msg))


def parse_recipients(value) -> List[str]:
    items = value if isinstance(value, list) else re.split(r"[,;\s]+", str(value or ""))
    out = [i.strip() for i in items if i and i.strip()]
    for addr in out:
        if not EMAIL_RE.match(addr):
            raise UserError(f"Invalid email address: {addr}")
    return list(dict.fromkeys(out))


class Notifier:
    """Sends emails for enabled events; each alert is sent once until it clears."""

    def __init__(self, state, hostname: Callable[[], str], demo: bool = False):
        self.state = state
        self.hostname = hostname
        self.demo = demo
        self._lock = threading.Lock()
        self._login_sent: Dict[str, float] = {}

    def settings(self) -> dict:
        n = self.state.get("notifications") or {}
        events = n.get("events") or {}
        return {"recipients": n.get("recipients", []),
                "events": {k: bool(events.get(k, d)) for k, (_l, d) in EVENTS.items()},
                "labels": {k: lbl for k, (lbl, _d) in EVENTS.items()}}

    def save(self, data: dict) -> dict:
        recipients = parse_recipients(data.get("recipients", []))
        events = {k: bool((data.get("events") or {}).get(k, d)) for k, (_l, d) in EVENTS.items()}
        self.state.update(lambda d: d.__setitem__(
            "notifications", {**(d.get("notifications") or {}), "recipients": recipients,
                              "events": events}))
        return self.settings()

    def send(self, event: str, subject: str, body: str, sync: bool = False,
             force: bool = False, to: Optional[List[str]] = None) -> None:
        """`force`: send even if the event is turned off (the caller has its own
        switch). `to`: send to these addresses instead of the usual recipients."""
        s = self.settings()
        smtp = self.state.get("smtp") or {}
        recipients = to or s["recipients"]
        if not (force or to or s["events"].get(event)) or not recipients or not smtp.get("host"):
            return
        subject = f"[Talon {self.hostname()}] {subject}"
        body = body + f"\n\n-- \nTalon on {self.hostname()}. Change notifications in Talon > Notifications."

        def go():
            try:
                send_mail(smtp, recipients, subject, body, self.demo)
                self.state.log_activity("talon", f"Notification sent: {subject}")
            except UserError as e:
                self.state.log_activity("talon", f"Notification failed: {e}", "warning")
        if sync:
            go()
        else:
            threading.Thread(target=go, daemon=True, name="notify").start()

    def test(self) -> None:
        s = self.settings()
        smtp = self.state.get("smtp") or {}
        if not s["recipients"]:
            raise UserError("Add at least one recipient")
        send_mail(smtp, s["recipients"], f"[Talon {self.hostname()}] Test notification",
                  "Notifications from your Talon NAS are working.", self.demo)

    # ------------------------------------------------------------ alerts
    @staticmethod
    def classify(alert: dict) -> Optional[str]:
        t = alert.get("title", "")
        if t.startswith("RAID "):
            return "raid"
        if " is hot" in t:
            return "disk_temp"
        if t.startswith("Disk "):
            return "disk"
        if "almost full" in t:
            return "volume_full"
        if t.startswith("Volume "):
            return "raid"
        return None

    def check_alerts(self, alerts: List[dict]) -> None:
        """Mail new alerts; forget cleared ones so a recurrence is mailed again."""
        with self._lock:
            sent = set(self.state.get("notify_sent") or [])
            current = {a["title"]: a for a in alerts}
            for title in set(current) - sent:
                lvl = "error" if current[title].get("level") in ("error", "danger", "critical") else "warning"
                self.state.log_activity("talon", f"Alert: {title}", lvl, "alerts")
            for title in sent - set(current):
                self.state.log_activity("talon", f"Resolved: {title}", "info", "alerts")
            for title, a in current.items():
                if title not in sent:
                    ev = self.classify(a)
                    if ev:
                        self.send(ev, title, f"{title}\n{a.get('detail', '')}")
            if set(current) != sent:
                self.state.update(lambda d: d.__setitem__("notify_sent", sorted(current)))

    def login_failed(self, user: str, ip: str) -> None:
        now = time.time()
        if now - self._login_sent.get(ip, 0) < 3600:    # at most one mail per address per hour
            return
        self._login_sent[ip] = now
        self.send("login_failed", f"Failed sign-in from {ip}",
                  f"Someone failed to sign in to the web interface as '{user}' from {ip}.")
