"""EntraID users: people from your organization's Microsoft Entra ID directory who
can use Talon.

Once the EntraID app is set up for one organization (a tenant ID), Users shows
an "EntraID Users" tab: browse the directory, add people, and choose for each
whether they may sign in to the web interface ("Sign in with Microsoft"). Their
name and password stay in EntraID.

At least one user, local or EntraID, must always be able to sign in to the web
interface. The sign-in page shows the user name and password form while an
enabled local administrator exists, and "Sign in with Microsoft" while an
EntraID user has web access.

Microsoft sends the browser back to the OneDrive sign-in address
(/api/onedrive/callback), so the app needs no extra redirect URI."""
from __future__ import annotations

import secrets
import threading
import time
from typing import Callable, List, Optional

from . import entra
from .util import UserError

PENDING_SECONDS = 900
DEMO_DIRECTORY = [
    {"id": "d1a1c0de-0000-4000-8000-000000000001", "name": "Maria Georgiou", "upn": "maria@contoso.com",
     "email": "maria@contoso.com", "enabled": True},
    {"id": "d1a1c0de-0000-4000-8000-000000000002", "name": "Nikos Pappas", "upn": "nikos@contoso.com",
     "email": "nikos@contoso.com", "enabled": True},
    {"id": "d1a1c0de-0000-4000-8000-000000000003", "name": "Elena Christou", "upn": "elena@contoso.com",
     "email": "elena@contoso.com", "enabled": True},
    {"id": "d1a1c0de-0000-4000-8000-000000000004", "name": "Andreas Ioannou", "upn": "andreas@contoso.com",
     "email": "andreas@contoso.com", "enabled": False},
]


class EntraUsers:
    def __init__(self, state, local_web_users: Callable[[], List[str]], demo: bool = False):
        self.state = state
        self.local_web_users = local_web_users      # enabled local administrators
        self.demo = demo
        self._pending: dict = {}
        self._lock = threading.Lock()
        self._token: dict = {}

    # ------------------------------------------------------------ setup
    def _entra(self) -> dict:
        return self.state.get("entra") or {}

    def ready(self) -> bool:
        """The EntraID app is set up for one organization (a tenant ID): only then
        is there a directory of users to choose from."""
        e = self._entra()
        return entra.configured(e) and bool(entra.GUID_RE.match(entra.tenant_of(e)))

    def _users(self) -> dict:
        return self.state.get("entra_users") or {}

    def web_users(self) -> List[str]:
        return [u["upn"] for u in self._users().values() if u.get("web")]

    def methods(self) -> dict:
        """Public: what the sign-in page shows."""
        return {"local": bool(self.local_web_users()), "microsoft": self.ready() and bool(self.web_users())}

    def web_access_count(self) -> int:
        return len(self.local_web_users()) + (len(self.web_users()) if self.ready() else 0)

    # ------------------------------------------------------------ directory
    def _app_token(self) -> str:
        if self._token.get("expires", 0) > time.time() + 60:
            return self._token["access_token"]
        t = entra.app_token(self._entra())
        self._token = {"access_token": t["access_token"], "expires": time.time() + int(t.get("expires_in", 3600))}
        return self._token["access_token"]

    def directory(self, q: str = "") -> List[dict]:
        if not self.ready():
            raise UserError("Set up the EntraID app for your organization first (Settings → EntraID)")
        people = list(DEMO_DIRECTORY) if self.demo else entra.directory_users(self._app_token())
        added = self._users()
        words = q.lower().split()
        out = []
        for p in people:
            if words and not all(w in f"{p['name']} {p['upn']} {p['email']}".lower() for w in words):
                continue
            out.append({**p, "added": p["id"] in added})
        out.sort(key=lambda p: p["name"].lower())
        return out

    def list(self) -> List[dict]:
        return sorted(self._users().values(), key=lambda u: u["name"].lower())

    def add(self, ids: List[str], actor: str) -> int:
        people = {p["id"]: p for p in self.directory()}
        new = [people[i] for i in ids if i in people and i not in self._users()]
        if not new:
            raise UserError("Choose people to add")

        def upd(d):
            users = d.setdefault("entra_users", {})
            for p in new:
                users[p["id"]] = {"oid": p["id"], "name": p["name"], "upn": p["upn"], "email": p["email"],
                                  "web": False, "added": time.time(), "added_by": actor}
        self.state.update(upd)
        for p in new:
            self.state.log_activity(actor, f"Added EntraID user {p['upn']}", "info", "users")
        return len(new)

    def _get(self, oid: str) -> dict:
        u = self._users().get(oid)
        if not u:
            raise UserError("EntraID user not found")
        return u

    def set_web(self, oid: str, web: bool, actor: str) -> dict:
        u = self._get(oid)
        if u.get("web") and not web and self.web_access_count() <= 1:
            raise UserError("At least one user must be able to sign in to the web interface")
        self.state.update(lambda d: d["entra_users"][oid].__setitem__("web", bool(web)))
        self.state.log_activity(actor, f"{'Gave' if web else 'Removed'} web interface access "
                                       f"{'to' if web else 'from'} EntraID user {u['upn']}", "info", "users")
        return {**u, "web": bool(web)}

    def remove(self, oid: str, actor: str) -> dict:
        u = self._get(oid)
        if u.get("web") and self.web_access_count() <= 1:
            raise UserError("At least one user must be able to sign in to the web interface")
        self.state.update(lambda d: d["entra_users"].pop(oid, None))
        self.state.log_activity(actor, f"Removed EntraID user {u['upn']}", "info", "users")
        return u

    # ------------------------------------------------------------ Sign in with Microsoft
    def start(self, origin: str) -> str:
        if not self.methods()["microsoft"]:
            raise UserError("Sign in with Microsoft is not available")
        redirect = entra.redirect_uri(origin)
        state = secrets.token_urlsafe(24)
        verifier, challenge = entra.new_pkce()
        nonce = secrets.token_urlsafe(16)
        now = time.time()
        with self._lock:
            for k in [k for k, v in self._pending.items() if now - v["created"] > PENDING_SECONDS]:
                self._pending.pop(k, None)
            self._pending[state] = {"verifier": verifier, "nonce": nonce, "redirect": redirect, "created": now}
        if self.demo:
            return f"{redirect}?code=demo&state={state}"
        return entra.login_url(self._entra(), redirect, state, challenge, nonce)

    def owns(self, state: str) -> bool:
        with self._lock:
            return (state or "") in self._pending

    def finish(self, code: str, state: str, error: str = "", detail: str = "") -> str:
        """Complete Sign in with Microsoft; returns the user name to sign in as
        (the person's EntraID user principal name)."""
        with self._lock:
            p = self._pending.pop(state or "", None)
        if not p or time.time() - p["created"] > PENDING_SECONDS:
            raise UserError("This sign-in link has expired. Try again.")
        if error:
            raise UserError(detail.split("\r\n")[0] or error)
        e = self._entra()
        if self.demo:
            u = next((u for u in self._users().values() if u.get("web")), None)
            ident = {"tid": entra.tenant_of(e), "oid": u["oid"] if u else "", "email": u["upn"] if u else ""}
        else:
            ident = entra.login_identity(e, code, p["redirect"], p["verifier"], p["nonce"])
        u = self._users().get(ident["oid"]) if ident["tid"].lower() == entra.tenant_of(e).lower() else None
        if not u or not u.get("web"):
            self.state.log_activity(ident.get("email") or "?", "Failed sign-in with Microsoft: no web interface access",
                                    "warning", "signin")
            raise UserError(f"{ident.get('email') or 'This account'} may not sign in to Talon. "
                            "An administrator can give it access under Users → EntraID Users.")
        return u["upn"]


def enable_local_admins(platform, cfg) -> List[str]:
    """Recovery: enable the disabled local administrators again."""
    out = []
    for u in platform.list_users(cfg.users_group, cfg.admin_group, []):
        if u.get("admin") and u.get("disabled"):
            platform.set_disabled(u["name"], False)
            out.append(u["name"])
    return out
