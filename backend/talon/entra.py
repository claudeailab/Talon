"""Microsoft Entra ID (Azure AD) app used for OneDrive.

Sign-in uses the OAuth 2.0 authorization code flow with PKCE: the browser
opens Microsoft's consent page in a popup, Microsoft redirects back to
``https://<nas>/api/onedrive/callback`` and Talon exchanges the code for
tokens with the app's client secret. Only the standard library is used.
"""
from __future__ import annotations

import base64
import hashlib
import json
import re
import secrets
import ssl
import urllib.error
import urllib.parse
import urllib.request
from typing import Optional, Tuple

from .util import UserError

LOGIN = "https://login.microsoftonline.com"
GRAPH = "https://graph.microsoft.com/v1.0"
SCOPES = "offline_access User.Read Files.ReadWrite"
GUID_RE = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
ACCOUNT_TYPES = {"common": "Personal and work or school accounts",
                 "organizations": "Work or school accounts",
                 "consumers": "Personal Microsoft accounts"}
ORIGIN_RE = re.compile(r"^https?://[A-Za-z0-9.\-\[\]:]+$")


def tenant_of(cfg: dict) -> str:
    """Authority segment: common / organizations / consumers / <tenant id>."""
    t = (cfg.get("tenant") or "common").strip()
    return t if t in ACCOUNT_TYPES or GUID_RE.match(t) else "common"


def redirect_uri(origin: str) -> str:
    origin = (origin or "").rstrip("/")
    if not ORIGIN_RE.match(origin):
        raise UserError("Invalid web interface address")
    return origin + "/api/onedrive/callback"


def configured(cfg: dict) -> bool:
    return bool(cfg.get("client_id") and cfg.get("client_secret"))


def validate(cfg: dict) -> dict:
    out = {"tenant": tenant_of(cfg), "client_id": (cfg.get("client_id") or "").strip(),
           "client_secret": cfg.get("client_secret") or ""}
    if out["client_id"] and not GUID_RE.match(out["client_id"]):
        raise UserError("Application (client) ID must look like 00000000-0000-0000-0000-000000000000")
    t = (cfg.get("tenant") or "common").strip()
    if t not in ACCOUNT_TYPES and not GUID_RE.match(t):
        raise UserError("Directory (tenant) ID must look like 00000000-0000-0000-0000-000000000000")
    return out


# ---------------------------------------------------------------- HTTP helpers
def _request(url: str, data: Optional[dict] = None, token: Optional[str] = None,
             timeout: float = 20) -> Tuple[int, str]:
    body = urllib.parse.urlencode(data).encode() if data is not None else None
    headers = {"User-Agent": "Talon-NAS"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=body, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=ssl.create_default_context()) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")
    except (urllib.error.URLError, OSError) as e:
        raise UserError(f"Cannot reach Microsoft: {getattr(e, 'reason', e)}") from e


def _json(text: str) -> dict:
    try:
        return json.loads(text)
    except ValueError:
        return {}


def _error_codes(payload: dict, text: str = "") -> set:
    codes = set(payload.get("error_codes") or [])
    codes |= {int(c) for c in re.findall(r"AADSTS(\d+)", text or payload.get("error_description", ""))}
    return codes


def explain(codes: set, fallback: str) -> str:
    known = {
        700016: "The Application (client) ID was not found. Check the ID and the account type.",
        7000215: "The client secret is wrong. Copy the secret *Value*, not its ID.",
        7000222: "The client secret has expired. Create a new one in the Entra portal.",
        90002: "The directory (tenant) was not found.",
        50011: "The redirect URI is not registered on the app. Add the address shown in Talon.",
        500113: "The app has no redirect URI. Add the address shown in Talon.",
        50194: "The app only allows accounts of its own organization. Choose 'Work or school "
               "accounts' with your tenant ID, or change Supported account types in the portal.",
        700054: "The app does not allow the requested sign-in. Check the platform is 'Web'.",
        65001: "Permission was not granted. Allow the requested access when signing in.",
        7000218: "A client secret is required. Enter it in Talon.",
    }
    for c in codes:
        if c in known:
            return known[c]
    return fallback


# ---------------------------------------------------------------- connection test
def test(cfg: dict, origin: str) -> list:
    """Check app ID, secret and redirect URI against Microsoft. Returns check results."""
    cfg = validate(cfg)
    checks = []
    if not cfg["client_id"] or not cfg["client_secret"]:
        raise UserError("Enter the Application (client) ID and the client secret first")
    tenant = cfg["tenant"]
    redirect = redirect_uri(origin)

    # 1. App and secret: redeem a deliberately invalid code. "Invalid code" means
    #    Microsoft accepted the client ID and secret.
    status, text = _request(f"{LOGIN}/{tenant}/oauth2/v2.0/token", {
        "client_id": cfg["client_id"], "client_secret": cfg["client_secret"],
        "grant_type": "authorization_code", "code": "talon-connection-test",
        "redirect_uri": redirect, "scope": SCOPES})
    payload = _json(text)
    codes = _error_codes(payload, text)
    app_ok = bool(codes & {70000, 9002313, 54005, 70008, 900144}) or status == 200
    checks.append({"name": "Application ID and client secret", "ok": app_ok,
                   "detail": "Accepted by Microsoft" if app_ok else
                   explain(codes, payload.get("error_description", text[:200]).split("\r\n")[0])})
    if not app_ok:
        return checks

    # 2. Redirect URI and account type: Microsoft's sign-in page shows AADSTS
    #    errors for an unregistered redirect URI or a wrong audience.
    q = urllib.parse.urlencode({"client_id": cfg["client_id"], "response_type": "code",
                                "redirect_uri": redirect, "scope": SCOPES,
                                "response_mode": "query", "state": "talon-test"})
    status, text = _request(f"{LOGIN}/{tenant}/oauth2/v2.0/authorize?{q}")
    codes = _error_codes({}, text)
    ok = status == 200 and not codes
    checks.append({"name": "Redirect URI", "ok": ok,
                   "detail": redirect if ok else explain(codes, f"Microsoft returned HTTP {status}")})
    checks.append({"name": "Account types", "ok": True, "detail": ACCOUNT_TYPES.get(
        tenant, "Accounts of one organization")})
    return checks


# ---------------------------------------------------------------- sign-in
def new_pkce() -> Tuple[str, str]:
    verifier = secrets.token_urlsafe(64)[:96]
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=")
    return verifier, challenge.decode()


def authorize_url(cfg: dict, redirect: str, state: str, challenge: str) -> str:
    q = urllib.parse.urlencode({
        "client_id": cfg["client_id"], "response_type": "code", "redirect_uri": redirect,
        "response_mode": "query", "scope": SCOPES, "state": state, "prompt": "select_account",
        "code_challenge": challenge, "code_challenge_method": "S256"})
    return f"{LOGIN}/{tenant_of(cfg)}/oauth2/v2.0/authorize?{q}"


def _token(cfg: dict, data: dict) -> dict:
    data = {"client_id": cfg["client_id"], "client_secret": cfg["client_secret"],
            "scope": SCOPES, **data}
    status, text = _request(f"{LOGIN}/{tenant_of(cfg)}/oauth2/v2.0/token", data)
    payload = _json(text)
    if status != 200 or "access_token" not in payload:
        raise UserError(explain(_error_codes(payload, text),
                                payload.get("error_description", "Sign-in failed").split("\r\n")[0]))
    return payload


def redeem_code(cfg: dict, code: str, redirect: str, verifier: str) -> dict:
    return _token(cfg, {"grant_type": "authorization_code", "code": code,
                        "redirect_uri": redirect, "code_verifier": verifier})


def refresh(cfg: dict, refresh_token: str) -> dict:
    return _token(cfg, {"grant_type": "refresh_token", "refresh_token": refresh_token})


# ---------------------------------------------------------------- Microsoft Graph
def graph(token: str, path: str) -> dict:
    status, text = _request(GRAPH + path, token=token)
    payload = _json(text)
    if status != 200:
        msg = (payload.get("error") or {}).get("message") or f"HTTP {status}"
        raise UserError(f"OneDrive: {msg}")
    return payload


def account_info(token: str) -> dict:
    me = graph(token, "/me?$select=displayName,userPrincipalName,mail")
    drive = graph(token, "/me/drive?$select=id,driveType,quota")
    quota = drive.get("quota") or {}
    return {"name": me.get("displayName") or "", "email": me.get("mail") or me.get("userPrincipalName") or "",
            "drive_id": drive.get("id"), "drive_type": drive.get("driveType") or "personal",
            "used": quota.get("used") or 0, "total": quota.get("total") or 0}


def list_items(token: str, path: str) -> list:
    """Folders first, then files: [{name, folder, size}]."""
    path = path.strip("/")
    url = "/me/drive/root/children" if not path else \
        f"/me/drive/root:/{urllib.parse.quote(path)}:/children"
    data = graph(token, url + "?$select=name,folder,file,size&$top=999")
    items = [{"name": i["name"], "folder": "folder" in i, "size": i.get("size") or 0}
             for i in data.get("value", []) if "folder" in i or "file" in i]
    return sorted(items, key=lambda i: (not i["folder"], i["name"].lower()))
