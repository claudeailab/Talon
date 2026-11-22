"""Sign in to Talon with a Microsoft account, through the EntraID app.

An administrator links their Microsoft account while signed in to Talon; that
Microsoft account (identified by its tenant and object id, never by its email
address) can then sign in as that administrator. Password sign-in can be turned
off once a Microsoft account is linked. If that ever locks everyone out,
``sudo talon enable-local-login`` on the NAS turns it back on.

Microsoft sends the browser back to the same address as the OneDrive sign-in
(/api/onedrive/callback), so the app needs no extra redirect URI."""
from __future__ import annotations

import secrets
import threading
import time
from typing import Optional

from . import entra
from .util import UserError

PENDING_SECONDS = 900


class MicrosoftLogin:
    def __init__(self, state, demo: bool = False):
        self.state = state
        self.demo = demo
        self._pending: dict = {}
        self._lock = threading.Lock()

    # ------------------------------------------------------------ settings
    def _cfg(self) -> dict:
        return self.state.get("mslogin") or {}

    def _entra(self) -> dict:
        return self.state.get("entra") or {}

    def available(self) -> bool:
        """Microsoft sign-in is turned on, the EntraID app is set up and an account is linked."""
        c = self._cfg()
        return bool(c.get("enabled") and entra.configured(self._entra()) and c.get("links"))

    def methods(self) -> dict:
        """What the sign-in page offers. Password sign-in is only ever off while
        Microsoft sign-in works, so nobody is locked out by a broken setting."""
        ms = self.available()
        return {"microsoft": ms, "local": (self._cfg().get("local", True) or not ms)}

    def settings(self) -> dict:
        c = self._cfg()
        return {"enabled": bool(c.get("enabled")), "local": c.get("local", True),
                "entra_configured": entra.configured(self._entra()),
                "links": [{k: l[k] for k in ("user", "email", "name", "oid", "linked")}
                          for l in c.get("links", [])]}

    def save(self, data: dict, user: str) -> dict:
        enabled = bool(data.get("enabled"))
        local = bool(data.get("local", True))
        c = self._cfg()
        if enabled and not entra.configured(self._entra()):
            raise UserError("Set up the EntraID app first")
        if not local and not (enabled and c.get("links")):
            raise UserError("Turn on Microsoft sign-in and link a Microsoft account first")
        self.state.update(lambda d: d.__setitem__("mslogin", {**c, "enabled": enabled, "local": local}))
        if enabled != bool(c.get("enabled")):
            self.state.log_activity(user, f"Microsoft sign-in turned {'on' if enabled else 'off'}", "info", "signin")
        if local != c.get("local", True):
            self.state.log_activity(user, f"Sign-in with a user name and password turned {'on' if local else 'off'}",
                                    "warning" if not local else "info", "signin")
        return self.settings()

    def unlink(self, oid: str, user: str) -> dict:
        c = self._cfg()
        links = [l for l in c.get("links", []) if l["oid"] != oid]
        gone = [l for l in c.get("links", []) if l["oid"] == oid]
        new = {**c, "links": links}
        if not links:
            new["local"] = True                 # never leave Talon without a way in
        self.state.update(lambda d: d.__setitem__("mslogin", new))
        for l in gone:
            self.state.log_activity(user, f"Unlinked Microsoft account {l['email']} from {l['user']}", "info", "signin")
        return self.settings()

    # ------------------------------------------------------------ sign-in flow
    def start(self, origin: str, mode: str, user: Optional[str] = None) -> str:
        """The Microsoft sign-in address. mode "login" signs in; "link" links the
        Microsoft account to the signed-in administrator ``user``."""
        e = self._entra()
        if not entra.configured(e):
            raise UserError("The EntraID app is not set up")
        if mode == "login" and not self.available():
            raise UserError("Microsoft sign-in is turned off")
        redirect = entra.redirect_uri(origin)
        state = secrets.token_urlsafe(24)
        verifier, challenge = entra.new_pkce()
        nonce = secrets.token_urlsafe(16)
        now = time.time()
        with self._lock:
            for k in [k for k, v in self._pending.items() if now - v["created"] > PENDING_SECONDS]:
                self._pending.pop(k, None)
            self._pending[state] = {"mode": mode, "user": user, "verifier": verifier, "nonce": nonce,
                                    "redirect": redirect, "created": now}
        if self.demo:
            return f"{redirect}?code=demo&state={state}"
        return entra.login_url(e, redirect, state, challenge, nonce)

    def mode_of(self, state: str) -> Optional[str]:
        """"login" or "link" when this sign-in was started here, else None."""
        with self._lock:
            p = self._pending.get(state or "")
            return p["mode"] if p else None

    def finish(self, code: str, state: str, error: str = "", detail: str = "") -> dict:
        """Complete a sign-in. Returns {"mode", "user"}: the Talon user to sign in
        as, or the administrator whose account was linked."""
        with self._lock:
            p = self._pending.pop(state or "", None)
        if not p or time.time() - p["created"] > PENDING_SECONDS:
            raise UserError("This sign-in link has expired. Try again.")
        if error:
            raise UserError(detail.split("\r\n")[0] or error)
        if self.demo:
            ident = {"tid": "demo-tenant", "oid": "demo-user", "email": "alex@outlook.com", "name": "Alex Demo"}
        else:
            ident = entra.login_identity(self._entra(), code, p["redirect"], p["verifier"], p["nonce"])
        c = self._cfg()
        links = c.get("links", [])
        if p["mode"] == "link":
            links = [l for l in links if not (l["tid"] == ident["tid"] and l["oid"] == ident["oid"])]
            links.append({**ident, "user": p["user"], "linked": time.time()})
            self.state.update(lambda d: d.__setitem__("mslogin", {**c, "links": links}))
            self.state.log_activity(p["user"], f"Linked Microsoft account {ident['email']}", "info", "signin")
            return {"mode": "link", "user": p["user"], "email": ident["email"]}
        match = next((l for l in links if l["tid"] == ident["tid"] and l["oid"] == ident["oid"]), None)
        if not match:
            self.state.log_activity(ident["email"] or "?", "Failed Microsoft sign-in: account not linked",
                                    "warning", "signin")
            raise UserError(f"{ident['email'] or 'This Microsoft account'} is not linked to a Talon "
                            "administrator. Sign in and link it under Settings → EntraID.")
        return {"mode": "login", "user": match["user"], "email": ident["email"]}


def enable_local_login(state) -> None:
    """Recovery: turn sign-in with a user name and password back on."""
    state.update(lambda d: d.__setitem__("mslogin", {**(d.get("mslogin") or {}), "local": True}))
    state.log_activity("talon", "Sign-in with a user name and password turned on from the command line",
                       "warning", "signin")
