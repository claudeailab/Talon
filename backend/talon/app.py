"""FastAPI application: REST API + static web UI."""
from __future__ import annotations

import contextlib
import tempfile
import urllib.parse
import html as htmllib
import json
import os
import threading
import time
from typing import List, Optional

from fastapi import Body, Depends, FastAPI, HTTPException, Query, Request, Response
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse, StreamingResponse
from starlette.concurrency import run_in_threadpool
from starlette.routing import Match
from pydantic import BaseModel

from . import activity, webconfig, __version__, notify
from .syslog import SystemLog
from .webdav import PREFIX as DAV_PREFIX, WebDav
from .auth import COOKIE, Sessions
from .nas import Nas
from .update import DemoUpdater, Updater, health as health_info
from .util import CommandError, UserError

WEB_DIR = os.path.join(os.path.dirname(__file__), "web")


def callback_page(ok: bool, text: str) -> str:
    """Page shown in the Microsoft sign-in popup after it returns to Talon."""
    msg = json.dumps({"talon": "onedrive", "ok": ok, "message": text})
    color = "#047857" if ok else "#be123c"
    return f"""<!doctype html><html><head><meta charset="utf-8"><title>Talon</title>
<meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;
height:100vh;margin:0;background:#fafafa"><div style="text-align:center;padding:24px">
<p style="font-size:18px;font-weight:600;color:{color}">{htmllib.escape(text)}</p>
<p style="color:#71717a">You can close this window.</p></div>
<script>try{{window.opener&&window.opener.postMessage({msg},location.origin)}}catch(e){{}}
setTimeout(function(){{window.close()}},{1200 if ok else 6000});</script></body></html>"""


def go_page(path: str) -> str:
    """Continue to a page of Talon. A script navigation (not a redirect) so the
    browser counts it as same-site and sends the SameSite=Strict session cookie."""
    target = json.dumps(path)
    return f"""<!doctype html><html><head><meta charset="utf-8"><title>Talon</title>
<meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="font-family:system-ui,sans-serif;background:#09090b;color:#a1a1aa">
<script>location.replace({target})</script>
<noscript><a href="{htmllib.escape(path)}">Continue</a></noscript></body></html>"""


class LoginIn(BaseModel):
    username: str
    password: str


class RaidIn(BaseModel):
    name: str
    level: str
    disks: List[str]
    spares: List[str] = []


class VolumeIn(BaseModel):
    name: str
    fs: str = "ext4"
    array: Optional[str] = None
    disk: Optional[str] = None
    size: Optional[int] = None          # bytes, on a RAID array; empty: all the free space


class OptionsIn(BaseModel):
    disks: List[str]
    spares: int = 0


class AddDiskIn(BaseModel):
    disk: str
    mode: str


class GroupIn(BaseModel):
    name: str = ""
    members: List[str] = []
    description: Optional[str] = None


# Every request that changes something is in the activity log: the category of
# each endpoint, and the entry written when the endpoint logged nothing itself.
# None: not logged (it changes nothing, or logs in its own words).
ACTIONS = {
    "POST /api/auth/login": ("signin", None),
    "POST /api/auth/logout": ("signin", "Signed out"),
    "POST /api/entra/users": ("users", None),
    "PUT /api/entra/users/{oid}": ("users", None),
    "DELETE /api/entra/users/{oid}": ("users", None),
    "POST /api/update/check": ("updates", "Checked for updates"),
    "PUT /api/update/settings": ("updates", None),
    "POST /api/os-update/check": ("updates", None),
    "PUT /api/folder-perms": ("sharing", None),
    "POST /api/backup": ("backup", None),
    "PUT /api/backup/{tid}": ("backup", None),
    "DELETE /api/backup/{tid}": ("backup", None),
    "POST /api/backup/{tid}/run": ("backup", None),
    "POST /api/backup/{tid}/stop": ("backup", "Stopped a backup"),
    "POST /api/antivirus/install": ("antivirus", None),
    "POST /api/antivirus/remove": ("antivirus", None),
    "PUT /api/antivirus/settings": ("antivirus", None),
    "POST /api/antivirus/scan": ("antivirus", None),
    "POST /api/antivirus/stop": ("antivirus", "Stopped the virus scan"),
    "POST /api/antivirus/quarantine/{qid}/restore": ("antivirus", None),
    "DELETE /api/antivirus/quarantine/{qid}": ("antivirus", None),
    "POST /api/os-update/install": ("updates", None),
    "PUT /api/os-update/auto": ("updates", None),
    "POST /api/update/install": ("updates", "Started installing an update"),
    "POST /api/disks/{name}/smart-test": ("storage", "Started a S.M.A.R.T. self-test on {name}"),
    "POST /api/disks/{name}/wipe": ("storage", "Wiped disk {name}"),
    "POST /api/raid/options": ("storage", None),
    "POST /api/raid": ("storage", "Created a RAID array"),
    "DELETE /api/raid/{name}": ("storage", "Deleted RAID array {name}"),
    "POST /api/raid/{name}/disks": ("storage", "Added a disk to RAID array {name}"),
    "DELETE /api/raid/{name}/members/{part}": ("storage", "Removed {part} from RAID array {name}"),
    "POST /api/raid/{name}/scrub": ("storage", "Data scrub on RAID array {name}"),
    "POST /api/volumes": ("storage", "Created a volume"),
    "DELETE /api/volumes/{name}": ("storage", "Deleted volume {name}"),
    "POST /api/volumes/{name}/expand": ("storage", "Expanded volume {name}"),
    "POST /api/volumes/{name}/resize": ("storage", "Changed the size of volume {name}"),
    "POST /api/shares": ("sharing", "Created a shared folder"),
    "PUT /api/shares/{name}": ("sharing", "Updated shared folder {name}"),
    "DELETE /api/shares/{name}": ("sharing", "Deleted shared folder {name}"),
    "POST /api/users": ("users", "Created a user"),
    "PUT /api/users/{name}": ("users", "Updated user {name}"),
    "DELETE /api/users/{name}": ("users", "Deleted user {name}"),
    "POST /api/groups": ("users", "Created a group"),
    "PUT /api/groups/{name}": ("users", "Updated group {name}"),
    "DELETE /api/groups/{name}": ("users", "Deleted group {name}"),
    "POST /api/services/{sid}/{action}": ("services", "Service {sid}: {action}"),
    "PUT /api/settings/entra": ("onedrive", "Updated the EntraID app settings"),
    "POST /api/settings/entra/test": ("onedrive", "Tested the EntraID app"),
    "PUT /api/settings/smtp": ("settings", "Updated the SMTP settings"),
    "POST /api/settings/smtp/test": ("alerts", "Sent a test email"),
    "PUT /api/thresholds": ("settings", "Updated the alert thresholds"),
    "PUT /api/notifications": ("settings", "Updated the notification settings"),
    "POST /api/notifications/test": ("alerts", "Sent a test notification"),
    "POST /api/files/eject": ("files", None),
    "POST /api/files/folder": ("files", None),
    "POST /api/files/rename": ("files", None),
    "POST /api/files/move": ("files", None),
    "POST /api/files/delete": ("files", None),
    "PUT /api/files/upload": ("files", "Uploaded a file"),
    "POST /api/files/versions/restore": ("files", None),
    "POST /api/files/bin/restore": ("files", None),
    "POST /api/files/bin/delete": ("files", None),
    "POST /api/onedrive/connect": ("onedrive", "Started signing in to OneDrive"),
    "POST /api/onedrive/disconnect": ("onedrive", None),
    "POST /api/onedrive/refresh": ("onedrive", None),
    "POST /api/onedrive/local-folders": ("onedrive", "Created a NAS folder for a OneDrive task"),
    "POST /api/onedrive/tasks": ("onedrive", None),
    "PUT /api/onedrive/tasks/{tid}": ("onedrive", None),
    "DELETE /api/onedrive/tasks/{tid}": ("onedrive", None),
    "POST /api/onedrive/tasks/{tid}/run": ("onedrive", "Started a OneDrive task"),
    "POST /api/onedrive/tasks/{tid}/verify": ("onedrive", "Started checking a OneDrive task"),
    "POST /api/onedrive/tasks/{tid}/stop": ("onedrive", "Stopped a OneDrive task"),
    "PUT /api/settings/web": ("settings", "Updated the web interface settings"),
    "PUT /api/network": ("settings", "Updated the network settings"),
    "POST /api/scheduled": ("scheduled", None),
    "POST /api/scheduled/test": ("scheduled", None),
    "PUT /api/scheduled/{tid}": ("scheduled", None),
    "DELETE /api/scheduled/{tid}": ("scheduled", None),
    "POST /api/scheduled/{tid}/run": ("scheduled", None),
    "POST /api/scheduled/{tid}/stop": ("scheduled", "Stopped a scheduled task"),
    "POST /api/scheduled/{tid}/{action}": ("scheduled", None),
    "PUT /api/settings": ("settings", "Updated the general settings"),
    "POST /api/system/power": ("system", None),
}


def create_app(cfg, platform) -> FastAPI:
    nas = Nas(cfg, platform)
    sessions = Sessions(cfg.session_hours, cfg.sessions_file)

    syslog_reader = SystemLog(cfg.demo)
    server = {"started": time.time()}
    webdav = WebDav(nas, platform, cfg.demo)
    updater = (DemoUpdater if cfg.demo else Updater)(cfg, nas.state)

    @contextlib.asynccontextmanager
    async def lifespan(_app):
        nas.state.log_activity("talon", f"Talon {__version__} started", "info", "system")
        nas.start()
        threading.Thread(target=updater.background_loop, args=(nas._stop,), daemon=True,
                         name="update-check").start()
        yield
        nas.state.log_activity("talon", "Talon stopped", "info", "system")
        nas.stop()

    app = FastAPI(title="Talon", version=__version__, docs_url=None, redoc_url=None,
                  openapi_url=None, lifespan=lifespan)
    app.state.nas = nas

    @app.exception_handler(UserError)
    async def _user_error(_req, exc: UserError):
        return JSONResponse({"detail": str(exc)}, status_code=400)

    @app.exception_handler(CommandError)
    async def _cmd_error(_req, exc: CommandError):
        return JSONResponse({"detail": str(exc)}, status_code=500)

    @app.middleware("http")
    async def _security(request: Request, call_next):
        if cfg.demo and getattr(updater, "restarting_until", 0) > time.time() \
                and request.url.path.startswith("/api/"):
            return JSONResponse({"detail": "restarting"}, status_code=503)  # simulated restart
        # CSRF: state-changing API calls must carry a custom header, which a
        # cross-site form or simple request cannot add.
        if request.url.path.startswith("/api/") and request.method not in ("GET", "HEAD") \
                and request.headers.get("x-requested-with") != "talon":
            return JSONResponse({"detail": "Missing CSRF header"}, status_code=403)
        nas.network.seen_request(request.client.host if request.client else None)
        # the activity log: the category of this endpoint, and what it logged
        action = None
        if request.url.path.startswith("/api/") and request.method in ("POST", "PUT", "DELETE"):
            for route in app.routes:
                match, child = route.matches(request.scope)
                if match == Match.FULL and getattr(route, "path", "").startswith("/api/"):
                    action = ACTIONS.get(f"{request.method} {route.path}")
                    params = child.get("path_params", {})
                    break
        cat_token = activity.request_category.set(action[0] if action else None)
        logged: list = []
        log_token = activity.request_logged.set(logged)
        try:
            resp = await call_next(request)
        finally:
            activity.request_category.reset(cat_token)
            activity.request_logged.reset(log_token)
        if action and action[1] and not logged and 200 <= resp.status_code < 300:
            user = sessions.get(request.cookies.get(COOKIE)) or sessions.get(request.cookies.get(COOKIE_HTTP)) or "?"
            try:
                text = action[1].format(**params)
            except (KeyError, IndexError):
                text = action[1]
            nas.state.log_activity(user, text, "info", action[0])
        resp.headers["X-Content-Type-Options"] = "nosniff"
        resp.headers["X-Frame-Options"] = "DENY"
        resp.headers["Referrer-Policy"] = "same-origin"
        if request.url.path.startswith("/api/"):
            resp.headers["Cache-Control"] = "no-store"
        return resp

    # Over plain HTTP the session uses another cookie name: a browser does not let
    # an http:// page replace a Secure cookie of the same name left from HTTPS, so
    # reusing the name would silently drop the new session.
    COOKIE_HTTP = COOKIE + "_http"

    def current_user(request: Request) -> str:
        user = sessions.get(request.cookies.get(COOKIE)) or sessions.get(request.cookies.get(COOKIE_HTTP))
        if not user:
            raise HTTPException(401, "Not logged in")
        return user

    def client_ip(request: Request) -> str:
        return request.client.host if request.client else "?"

    # ------------------------------------------------------------ auth
    def start_session(request: Request, response: Response, user: str, how: str) -> None:
        token = sessions.create(user)
        # Secure cookies only travel over HTTPS: the browser's view counts, so a
        # proxy such as Cloudflare that serves HTTPS in front of plain HTTP keeps them.
        https = request.url.scheme == "https" or request.headers.get("x-forwarded-proto") == "https"
        secure = https and not cfg.demo
        response.set_cookie(COOKIE if secure else COOKIE_HTTP, token, httponly=True, samesite="strict",
                            secure=secure, max_age=cfg.session_hours * 3600, path="/")
        nas.state.log_activity(user, f"Signed in{how} from {client_ip(request)}", "info", "signin")

    def origin_of(request: Request) -> str:
        proto = request.headers.get("x-forwarded-proto") or request.url.scheme
        return f"{proto}://{request.headers.get('host') or request.url.netloc}"

    @app.get("/api/auth/methods")
    def auth_methods():
        """Public: which sign-in options the sign-in page shows."""
        return nas.entra_users.methods()

    @app.get("/api/auth/microsoft")
    def auth_microsoft(request: Request):
        try:
            return RedirectResponse(nas.entra_users.start(origin_of(request)), status_code=302)
        except UserError as e:
            return RedirectResponse("/?login_error=" + urllib.parse.quote(str(e)), status_code=302)

    # EntraID users (entrausers.py)
    @app.get("/api/entra/users")
    def entra_users(_u: str = Depends(current_user)):
        return {"ready": nas.entra_users.ready(), "configured": nas.entra_users.configured(),
                "users": nas.entra_users.list()}

    @app.get("/api/entra/directory")
    def entra_directory(q: str = "", _u: str = Depends(current_user)):
        return nas.entra_users.directory(q)

    @app.post("/api/entra/users")
    def entra_users_add(body: dict = Body(...), user: str = Depends(current_user)):
        return {"added": nas.entra_users.add(list(body.get("ids") or []), user)}

    @app.put("/api/entra/users/{oid}")
    def entra_user_update(oid: str, body: dict = Body(...), user: str = Depends(current_user)):
        u = nas.entra_users.set_web(oid, bool(body.get("web")), user)
        if not u["web"]:
            sessions.drop_user(u["upn"])
        return u

    @app.delete("/api/entra/users/{oid}")
    def entra_user_remove(oid: str, user: str = Depends(current_user)):
        u = nas.entra_users.remove(oid, user)
        sessions.drop_user(u["upn"])
        return {"ok": True}

    @app.post("/api/auth/login")
    def login(body: LoginIn, request: Request, response: Response):
        ip = client_ip(request)
        if sessions.blocked(ip):
            raise HTTPException(429, "Too many failed attempts. Try again in 5 minutes.")
        user = body.username.strip()
        ok = platform.authenticate(user, body.password)
        if ok and user not in platform.group_members(cfg.admin_group):
            ok = False
        if not ok:
            sessions.failed(ip)
            nas.state.log_activity(user or "?", f"Failed login from {ip}", "warning")
            nas.notifier.login_failed(user or "?", ip)
            raise HTTPException(401, "Invalid user name or password, or not an administrator")
        sessions.succeeded(ip)
        start_session(request, response, user, "")
        return {"user": user}

    @app.post("/api/auth/logout")
    def logout(request: Request, response: Response):
        user = sessions.get(request.cookies.get(COOKIE)) or sessions.get(request.cookies.get(COOKIE_HTTP))
        if user:
            nas.state.log_activity(user, "Signed out", "info", "signin")
        for name in (COOKIE, COOKIE_HTTP):
            sessions.drop(request.cookies.get(name))
            response.delete_cookie(name, path="/")
        return {"ok": True}

    @app.get("/api/auth/me")
    def me(user: str = Depends(current_user)):
        return {"user": user, "version": updater.current, "demo": cfg.demo}

    # ------------------------------------------------------------ updates
    @app.get("/api/health")
    def health():
        # "started" changes when Talon (or the NAS) restarts: the restart screen waits for it
        return {**health_info(updater), "started": server["started"]}

    @app.get("/api/update")
    def update_info(_u: str = Depends(current_user)):
        return updater.info()

    @app.post("/api/update/check")
    def update_check(_u: str = Depends(current_user)):
        updater.check(force=True)
        return updater.info()

    @app.get("/api/backup")
    def backup(_u: str = Depends(current_user)):
        return nas.backup.info()

    @app.post("/api/backup")
    def backup_create(body: dict = Body(...), user: str = Depends(current_user)):
        t = nas.backup.create(body, user)
        if body.get("run_now") and not body.get("prepare_disk"):     # a prepared disk runs once it is ready
            nas.backup.run_now(t["id"], user)
        return t

    @app.get("/api/backup/{tid}/log")
    def backup_log(tid: str, _u: str = Depends(current_user)):
        return nas.backup.task_log(tid)

    @app.put("/api/backup/{tid}")
    def backup_update(tid: str, body: dict = Body(...), user: str = Depends(current_user)):
        return nas.backup.update(tid, body, user)

    @app.delete("/api/backup/{tid}")
    def backup_delete(tid: str, user: str = Depends(current_user)):
        nas.backup.delete(tid, user)
        return {"ok": True}

    @app.post("/api/backup/{tid}/run")
    def backup_run(tid: str, user: str = Depends(current_user)):
        return nas.backup.run_now(tid, user)

    @app.post("/api/backup/{tid}/stop")
    def backup_stop(tid: str, _u: str = Depends(current_user)):
        nas.backup.stop(tid)
        return {"ok": True}

    @app.get("/api/folder-perms")
    def folder_perms(volume: str, path: str = "", _u: str = Depends(current_user)):
        return nas.folder_perms.get(volume, path)

    @app.put("/api/folder-perms")
    def folder_perms_set(body: dict = Body(...), user: str = Depends(current_user)):
        return nas.folder_perms.set(str(body.get("volume", "")), str(body.get("path", "")), body, user).to_dict()

    @app.get("/api/antivirus")
    def antivirus(_u: str = Depends(current_user)):
        return nas.antivirus.info()

    @app.post("/api/antivirus/install")
    def antivirus_install(user: str = Depends(current_user)):
        return nas.antivirus.install(user)

    @app.post("/api/antivirus/remove")
    def antivirus_remove(user: str = Depends(current_user)):
        return nas.antivirus.remove(user)

    @app.put("/api/antivirus/settings")
    def antivirus_settings(body: dict = Body(...), user: str = Depends(current_user)):
        return nas.antivirus.save_settings(body, user)

    @app.post("/api/antivirus/scan")
    def antivirus_scan(body: dict = Body(default={}), user: str = Depends(current_user)):
        return nas.antivirus.scan(user, body.get("volumes"))

    @app.post("/api/antivirus/stop")
    def antivirus_stop(_u: str = Depends(current_user)):
        nas.antivirus.stop()
        return {"ok": True}

    @app.post("/api/antivirus/quarantine/{qid}/restore")
    def antivirus_restore(qid: str, user: str = Depends(current_user)):
        nas.antivirus.restore(qid, user)
        return nas.antivirus.info()

    @app.delete("/api/antivirus/quarantine/{qid}")
    def antivirus_delete(qid: str, user: str = Depends(current_user)):
        nas.antivirus.delete(qid, user)
        return nas.antivirus.info()

    @app.get("/api/os-update")
    def os_update(_u: str = Depends(current_user)):
        return nas.osupdate.info()

    @app.post("/api/os-update/check")
    def os_update_check(_u: str = Depends(current_user)):
        return nas.osupdate.start_check()

    @app.post("/api/os-update/install")
    def os_update_install(user: str = Depends(current_user)):
        return nas.osupdate.install(user)

    @app.put("/api/os-update/auto")
    def os_update_auto(body: dict = Body(...), user: str = Depends(current_user)):
        return nas.osupdate.set_auto(body, user)

    @app.put("/api/update/settings")
    def update_settings(body: dict = Body(...), user: str = Depends(current_user)):
        if "interval_hours" in body:
            h = updater.set_interval(body.get("interval_hours"))
            nas.state.log_activity(user, "Talon update checks: " + ("only when checked manually" if not h else f"every {h} hour(s)"), "info", "updates")
        if "auto_install" in body:
            on = updater.set_auto_install(body.get("auto_install"))
            nas.state.log_activity(user, "Install Talon updates automatically: " + ("on, at night" if on else "off"), "info", "updates")
        return updater.info()

    @app.get("/api/update/status")
    def update_status(_u: str = Depends(current_user)):
        return updater.status()

    @app.post("/api/update/install")
    def update_install(user: str = Depends(current_user)):
        return updater.start(user)

    # ------------------------------------------------------------ dashboard
    @app.get("/api/dashboard")
    def dashboard(_u: str = Depends(current_user)):
        return nas.dashboard()

    @app.get("/api/history")
    def usage_history(range: str = "24h", _u: str = Depends(current_user)):
        return nas.usage_history(range)

    @app.get("/api/stats")
    def stats(_u: str = Depends(current_user)):
        return {"history": list(nas.history)}

    # ------------------------------------------------------------ disks
    @app.get("/api/disks")
    def disks(_u: str = Depends(current_user)):
        return nas.disks()

    @app.get("/api/disks/{name}/smart")
    def disk_smart(name: str, _u: str = Depends(current_user)):
        return nas.disk_smart(name)

    @app.post("/api/disks/{name}/smart-test")
    def disk_smart_test(name: str, kind: str = Body(..., embed=True),
                        user: str = Depends(current_user)):
        nas.disk_smart_test(name, kind, user)
        return {"ok": True}

    @app.post("/api/disks/{name}/wipe")
    def disk_wipe(name: str, user: str = Depends(current_user)):
        return nas.wipe_disk(name, user).to_dict()

    # ------------------------------------------------------------ RAID
    @app.get("/api/raid")
    def raid_list(_u: str = Depends(current_user)):
        return nas.raid_arrays()

    @app.post("/api/raid/options")
    def raid_options(body: OptionsIn, _u: str = Depends(current_user)):
        return nas.raid_options(body.disks, body.spares)

    @app.post("/api/raid")
    def raid_create(body: RaidIn, user: str = Depends(current_user)):
        return nas.create_array(body.name, body.level, body.disks, body.spares, user).to_dict()

    @app.delete("/api/raid/{name}")
    def raid_delete(name: str, user: str = Depends(current_user)):
        return nas.delete_array(name, user).to_dict()

    @app.post("/api/raid/{name}/disks")
    def raid_add_disk(name: str, body: AddDiskIn, user: str = Depends(current_user)):
        return nas.add_disk(name, body.disk, body.mode, user).to_dict()

    @app.delete("/api/raid/{name}/members/{part}")
    def raid_remove_member(name: str, part: str, user: str = Depends(current_user)):
        return nas.remove_member(name, part, user).to_dict()

    @app.post("/api/raid/{name}/scrub")
    def raid_scrub(name: str, action: str = Body("check", embed=True),
                   user: str = Depends(current_user)):
        nas.scrub(name, action, user)
        return {"ok": True}

    # ------------------------------------------------------------ volumes
    @app.get("/api/volumes")
    def volumes(_u: str = Depends(current_user)):
        return nas.volumes()

    @app.get("/api/volumes/sources")
    def volume_sources(_u: str = Depends(current_user)):
        return nas.volume_sources()

    @app.post("/api/volumes")
    def volume_create(body: VolumeIn, user: str = Depends(current_user)):
        return nas.create_volume(body.name, body.fs, body.array, body.disk, user, body.size).to_dict()

    @app.delete("/api/volumes/{name}")
    def volume_delete(name: str, user: str = Depends(current_user)):
        return nas.delete_volume(name, user).to_dict()

    @app.post("/api/volumes/{name}/resize")
    def volume_resize(name: str, body: dict = Body(...), user: str = Depends(current_user)):
        return nas.resize_volume(name, body.get("size"), user).to_dict()

    @app.post("/api/volumes/{name}/expand")
    def volume_expand(name: str, user: str = Depends(current_user)):
        return nas.expand_fs(name, user).to_dict()

    # ------------------------------------------------------------ jobs
    @app.get("/api/jobs")
    def jobs(_u: str = Depends(current_user)):
        return nas.jobs.list()

    @app.get("/api/jobs/{job_id}")
    def job(job_id: str, _u: str = Depends(current_user)):
        j = nas.job_details(job_id)
        if not j:
            raise HTTPException(404, "Job not found")
        return j

    # ------------------------------------------------------------ shares
    @app.get("/api/shares")
    def shares(_u: str = Depends(current_user)):
        return nas.shares()

    @app.post("/api/shares")
    def share_create(body: dict = Body(...), user: str = Depends(current_user)):
        return nas.save_share(body, user)

    @app.put("/api/shares/{name}")
    def share_update(name: str, body: dict = Body(...), user: str = Depends(current_user)):
        return nas.save_share(body, user, original=name)

    @app.delete("/api/shares/{name}")
    def share_delete(name: str, user: str = Depends(current_user)):
        nas.delete_share(name, user)
        return {"ok": True}

    # ------------------------------------------------------------ users & groups
    @app.get("/api/users")
    def users(_u: str = Depends(current_user)):
        return nas.users()

    @app.post("/api/users")
    def user_create(body: dict = Body(...), user: str = Depends(current_user)):
        nas.create_user(body, user)
        return {"ok": True}

    @app.put("/api/users/{name}")
    def user_update(name: str, body: dict = Body(...), user: str = Depends(current_user)):
        nas.update_user(name, body, user)
        if body.get("disabled") or body.get("admin") is False:
            sessions.drop_user(name)
        return {"ok": True}

    @app.delete("/api/users/{name}")
    def user_delete(name: str, user: str = Depends(current_user)):
        nas.delete_user(name, user)
        sessions.drop_user(name)
        return {"ok": True}

    @app.get("/api/groups")
    def groups(_u: str = Depends(current_user)):
        return nas.groups()

    @app.post("/api/groups")
    def group_create(body: GroupIn, user: str = Depends(current_user)):
        nas.create_group(body.name, body.members, user, body.description or "")
        return {"ok": True}

    @app.put("/api/groups/{name}")
    def group_update(name: str, body: GroupIn, user: str = Depends(current_user)):
        nas.set_group_members(name, body.members, user)
        if body.description is not None:
            nas.set_group_description(name, body.description)
        return {"ok": True}

    @app.delete("/api/groups/{name}")
    def group_delete(name: str, user: str = Depends(current_user)):
        nas.delete_group(name, user)
        return {"ok": True}

    # ------------------------------------------------------------ services & system
    @app.get("/api/services")
    def services(_u: str = Depends(current_user)):
        return platform.services() + [nas.cloud.service_info(), webdav.service_info(), nas.antivirus.service_info(),
                                      nas.ramlog.service_info()]

    @app.post("/api/services/{sid}/{action}")
    def service_action(sid: str, action: str, user: str = Depends(current_user)):
        if sid == "sdcard":
            if action not in ("enable", "disable"):
                raise HTTPException(400, "SD-card protection can only be enabled or disabled")
            nas.ramlog.set_enabled(action == "enable", user)
            return {"ok": True}
        if sid == "antivirus":
            if action not in ("enable", "disable"):
                raise HTTPException(400, "The antivirus can only be enabled or disabled")
            nas.antivirus.set_enabled(action == "enable", user)
            return {"ok": True}
        if sid == "webdav":
            if action not in ("enable", "disable"):
                raise HTTPException(400, "WebDAV can only be enabled or disabled")
            webdav.set_enabled(action == "enable", user)
            return {"ok": True}
        if sid == "onedrive":
            if action not in ("enable", "disable"):
                raise HTTPException(400, "OneDrive can only be enabled or disabled")
            job = nas.cloud.set_enabled(action == "enable", user)
            return {"ok": True, "job": job.to_dict() if job else None}
        platform.service_action(sid, action)
        nas.state.log_activity(user, f"Service {sid}: {action}")
        return {"ok": True}

    # ------------------------------------------------------------ Entra ID, SMTP, notifications
    @app.get("/api/settings/entra")
    def entra_get(_u: str = Depends(current_user)):
        return nas.cloud.entra_public()

    @app.put("/api/settings/entra")
    def entra_put(body: dict = Body(...), user: str = Depends(current_user)):
        return nas.cloud.entra_save(body, user)

    @app.post("/api/settings/entra/test")
    def entra_test(body: dict = Body(...), _u: str = Depends(current_user)):
        return {"checks": nas.cloud.entra_test(body.get("config") or {}, body.get("origin", ""))}

    @app.get("/api/settings/smtp")
    def smtp_get(_u: str = Depends(current_user)):
        return notify.smtp_public(nas.state.get("smtp") or {})

    @app.put("/api/settings/smtp")
    def smtp_put(body: dict = Body(...), user: str = Depends(current_user)):
        clean = notify.smtp_validate(body, nas.state.get("smtp") or {})
        nas.state.update(lambda d: d.__setitem__("smtp", clean))
        nas.state.log_activity(user, "Updated the SMTP settings")
        return notify.smtp_public(clean)

    @app.post("/api/settings/smtp/test")
    def smtp_test(body: dict = Body(...), _u: str = Depends(current_user)):
        cfg_ = notify.smtp_validate(body.get("config") or {}, nas.state.get("smtp") or {})
        return {"checks": notify.smtp_check(cfg_, cfg.demo)}

    @app.get("/api/thresholds")
    def thresholds_get(_u: str = Depends(current_user)):
        return nas.thresholds_info()

    @app.put("/api/thresholds")
    def thresholds_put(body: dict = Body(...), user: str = Depends(current_user)):
        return nas.save_thresholds(body, user)

    @app.get("/api/notifications")
    def notifications_get(_u: str = Depends(current_user)):
        return {**nas.notifier.settings(),
                "smtp": notify.smtp_public(nas.state.get("smtp") or {})["configured"]}

    @app.put("/api/notifications")
    def notifications_put(body: dict = Body(...), user: str = Depends(current_user)):
        out = nas.notifier.save(body)
        nas.state.log_activity(user, "Updated the notification settings")
        return {**out, "smtp": notify.smtp_public(nas.state.get("smtp") or {})["configured"]}

    @app.post("/api/notifications/test")
    def notifications_test(_u: str = Depends(current_user)):
        nas.notifier.test()
        return {"ok": True}

    # ------------------------------------------------------------ files
    @app.get("/api/files/locations")
    def files_locations(_u: str = Depends(current_user)):
        return nas.files.locations()

    @app.post("/api/files/eject")
    def files_eject(body: dict = Body(...), user: str = Depends(current_user)):
        nas.files.eject(body.get("volume", ""))
        nas.state.log_activity(user, f"Ejected {body.get('volume', '').removeprefix('ext:')}")
        return {"ok": True}

    @app.get("/api/files")
    def files_list(volume: str, path: str = "", _u: str = Depends(current_user)):
        return nas.files.list(volume, path)

    @app.post("/api/files/folder")
    def files_mkdir(body: dict = Body(...), user: str = Depends(current_user)):
        rel = nas.files.mkdir(body.get("volume", ""), body.get("path", ""), body.get("name", ""))
        nas.state.log_activity(user, f"Created folder {body.get('volume')}/{rel}")
        return {"path": rel}

    @app.post("/api/files/rename")
    def files_rename(body: dict = Body(...), user: str = Depends(current_user)):
        rel = nas.files.rename(body.get("volume", ""), body.get("path", ""), body.get("name", ""))
        nas.state.log_activity(user, f"Renamed {body.get('volume')}/{body.get('path')} to {rel}")
        return {"path": rel}

    @app.post("/api/files/move")
    def files_move(body: dict = Body(...), user: str = Depends(current_user)):
        n = nas.files.move(body.get("volume", ""), list(body.get("items") or []),
                           body.get("dest_volume") or body.get("volume", ""), body.get("dest", ""))
        nas.state.log_activity(user, f"Moved {n} item(s) to {body.get('dest_volume') or body.get('volume')}/"
                                     f"{body.get('dest', '')}")
        return {"moved": n}

    @app.post("/api/files/delete")
    def files_delete(body: dict = Body(...), user: str = Depends(current_user)):
        items = list(body.get("items") or [])
        n = nas.files.delete(body.get("volume", ""), items, user)
        nas.state.log_activity(user, f"Deleted {n} item(s) in {body.get('volume')}: "
                                     + ", ".join(items[:5]) + (" …" if len(items) > 5 else ""),
                               "warning")
        return {"deleted": n}

    @app.put("/api/files/upload")
    async def files_upload(request: Request, volume: str, name: str, path: str = "",
                           overwrite: bool = False, user: str = Depends(current_user)):
        if nas.files.is_remote(volume):
            # OneDrive: receive into a temporary file, then send it on
            fd, tmp = tempfile.mkstemp(prefix=".upload-", dir=os.path.dirname(os.path.abspath(cfg.state_file)))
            try:
                with os.fdopen(fd, "wb") as f:
                    async for chunk in request.stream():
                        f.write(chunk)
                await run_in_threadpool(nas.files.upload_remote, path, name, tmp, overwrite)
            finally:
                with contextlib.suppress(OSError):
                    os.unlink(tmp)
            nas.state.log_activity(user, f"Uploaded {name} to OneDrive/{path}".rstrip("/"))
            return {"ok": True}
        target = nas.files.upload_target(volume, path, name, overwrite)
        fd, tmp = tempfile.mkstemp(prefix=".upload-", dir=os.path.dirname(target))
        size = 0
        try:
            with os.fdopen(fd, "wb") as f:
                async for chunk in request.stream():
                    f.write(chunk)
                    size += len(chunk)
            os.replace(tmp, target)
        except BaseException:
            with contextlib.suppress(OSError):
                os.unlink(tmp)
            raise
        nas.files._inherit(target)
        nas.state.log_activity(user, f"Uploaded {volume}/{os.path.join(path, name)}")
        return {"size": size}

    # previous versions and the recycle bin
    @app.get("/api/files/versions")
    def files_versions(volume: str, path: str, _u: str = Depends(current_user)):
        return nas.restore.versions(volume, path)

    @app.post("/api/files/versions/restore")
    def files_version_restore(body: dict = Body(...), user: str = Depends(current_user)):
        nas.restore.restore_version(body.get("volume", ""), body.get("path", ""), body.get("id", ""))
        nas.state.log_activity(user, f"Restored a previous version of {body.get('volume')}/{body.get('path')}")
        return {"ok": True}

    @app.get("/api/files/versions/download")
    def files_version_download(volume: str, id: str, _u: str = Depends(current_user)):
        path = nas.restore.version_file(volume, id)
        return FileResponse(path, media_type="application/octet-stream", headers={
            "Content-Disposition": "attachment; filename*=UTF-8''" + urllib.parse.quote(
                os.path.basename(path))})

    @app.get("/api/files/bin")
    def files_bin(volume: str, _u: str = Depends(current_user)):
        return nas.restore.bin(volume)

    @app.post("/api/files/bin/restore")
    def files_bin_restore(body: dict = Body(...), user: str = Depends(current_user)):
        n = nas.restore.restore_items(body.get("volume", ""), list(body.get("ids") or []))
        nas.state.log_activity(user, f"Restored {n} item(s) from the recycle bin of {body.get('volume')}")
        return {"restored": n}

    @app.post("/api/files/bin/delete")
    def files_bin_delete(body: dict = Body(...), user: str = Depends(current_user)):
        ids = body.get("ids")
        n = nas.restore.delete_items(body.get("volume", ""), None if ids is None else list(ids))
        nas.state.log_activity(user, f"Deleted {n} item(s) for good from the recycle bin of {body.get('volume')}")
        return {"deleted": n}

    @app.get("/api/files/download")
    def files_download(volume: str, item: List[str] = Query(...), _u: str = Depends(current_user)):
        if nas.files.is_remote(volume):
            name, url, stream = nas.files.download_remote(item)
            if url:                                  # a single file: OneDrive serves it directly
                return RedirectResponse(url, status_code=302)
            return StreamingResponse(stream, media_type="application/zip", headers={
                "Content-Disposition": "attachment; filename*=UTF-8''" + urllib.parse.quote(name)})
        name, path, stream = nas.files.download(volume, item)
        disposition = "attachment; filename*=UTF-8''" + urllib.parse.quote(name)
        if path:
            return FileResponse(path, headers={"Content-Disposition": disposition},
                                media_type="application/octet-stream")
        return StreamingResponse(stream, media_type="application/zip",
                                 headers={"Content-Disposition": disposition})

    # ------------------------------------------------------------ OneDrive
    @app.get("/api/onedrive")
    def onedrive(_u: str = Depends(current_user)):
        return nas.cloud.status()

    @app.post("/api/onedrive/connect")
    def onedrive_connect(body: dict = Body(...), _u: str = Depends(current_user)):
        return {"url": nas.cloud.connect_start(body.get("origin", ""))}

    @app.get("/api/onedrive/callback", response_class=HTMLResponse)
    def onedrive_callback(request: Request, code: str = "", state: str = "", error: str = "",
                          error_description: str = ""):
        # Microsoft redirects here after Sign in with Microsoft (entrausers.py) ...
        if nas.entra_users.owns(state):
            try:
                user = nas.entra_users.finish(code, state, error, error_description)
                page = HTMLResponse(go_page("/"))
                start_session(request, page, user, " with Microsoft")
                return page
            except UserError as e:
                return HTMLResponse(go_page("/?login_error=" + urllib.parse.quote(str(e))))
        # ... and after connecting OneDrive (in a popup). The unguessable, single-use
        # state value (created by a signed-in administrator) authorises the call.
        try:
            acct = nas.cloud.callback(code, state, error, error_description)
            ok, text = True, f"OneDrive connected: {acct['email']}"
        except UserError as e:
            ok, text = False, str(e)
        return HTMLResponse(callback_page(ok, text))

    @app.post("/api/onedrive/disconnect")
    def onedrive_disconnect(user: str = Depends(current_user)):
        nas.cloud.disconnect(user)
        return {"ok": True}

    @app.post("/api/onedrive/refresh")
    def onedrive_refresh(_u: str = Depends(current_user)):
        return {"account": nas.cloud.refresh_account()}

    @app.get("/api/onedrive/folders")
    def onedrive_folders(path: str = "", _u: str = Depends(current_user)):
        return nas.cloud.items(path)

    @app.get("/api/onedrive/local-folders")
    def onedrive_local_folders(volume: str, path: str = "", _u: str = Depends(current_user)):
        return nas.cloud.local_folders(volume, path)

    @app.post("/api/onedrive/local-folders")
    def onedrive_local_folder_create(body: dict = Body(...), user: str = Depends(current_user)):
        rel = nas.cloud.make_local_folder(body.get("volume", ""), body.get("path", ""),
                                          body.get("name", ""))
        nas.state.log_activity(user, f"Created folder {body.get('volume')}/{rel}")
        return {"path": rel}

    @app.post("/api/onedrive/tasks")
    def onedrive_task_create(body: dict = Body(...), user: str = Depends(current_user)):
        return nas.cloud.create_task(body, user)

    @app.put("/api/onedrive/tasks/{tid}")
    def onedrive_task_update(tid: str, body: dict = Body(...), user: str = Depends(current_user)):
        return nas.cloud.update_task(tid, body, user)

    @app.delete("/api/onedrive/tasks/{tid}")
    def onedrive_task_delete(tid: str, user: str = Depends(current_user)):
        nas.cloud.delete_task(tid, user)
        return {"ok": True}

    @app.post("/api/onedrive/tasks/{tid}/run")
    def onedrive_task_run(tid: str, user: str = Depends(current_user)):
        nas.cloud.run_task(tid, user)
        return {"ok": True}

    @app.post("/api/onedrive/tasks/{tid}/verify")
    def onedrive_task_verify(tid: str, body: dict = Body(...), user: str = Depends(current_user)):
        mode = body.get("mode")
        if mode not in ("quick", "full"):
            raise UserError("Choose a quick or full check")
        nas.cloud.run_task(tid, user, mode=mode)
        return {"ok": True}

    @app.post("/api/onedrive/tasks/{tid}/stop")
    def onedrive_task_stop(tid: str, _u: str = Depends(current_user)):
        nas.cloud.stop_task(tid)
        return {"ok": True}

    @app.get("/api/onedrive/tasks/{tid}/log")
    def onedrive_task_log(tid: str, _u: str = Depends(current_user)):
        return nas.cloud.task_log(tid)

    # ------------------------------------------------------------ web interface (HTTPS)
    @app.get("/api/settings/web")
    def web_get(request: Request, _u: str = Depends(current_user)):
        serving = getattr(app.state, "serving", {"https": request.url.scheme == "https", "port": cfg.port})
        return {"https": cfg.https, "port": cfg.port, "https_port": cfg.https_port,
                "serving_https": serving["https"]}

    @app.put("/api/settings/web")
    def web_put(body: dict = Body(...), user: str = Depends(current_user)):
        return webconfig.set_https(cfg, bool(body.get("https", True)), user, nas.state)

    # ------------------------------------------------------------ networking
    @app.get("/api/network")
    def network_info(_u: str = Depends(current_user)):
        return nas.network.info()

    @app.put("/api/network")
    def network_apply(body: dict = Body(...), user: str = Depends(current_user)):
        return nas.network.apply(body, user)

    # ------------------------------------------------------------ scheduled tasks
    @app.get("/api/scheduled")
    def scheduled_list(_u: str = Depends(current_user)):
        return {"tasks": nas.scheduler.list(), "run_as": nas.scheduler.run_as_options()}

    @app.post("/api/scheduled")
    def scheduled_create(body: dict = Body(...), user: str = Depends(current_user)):
        return nas.scheduler.create(body, user)

    @app.post("/api/scheduled/test")
    def scheduled_test(body: dict = Body(...), user: str = Depends(current_user)):
        return nas.scheduler.test_run(body, user)

    @app.put("/api/scheduled/{tid}")
    def scheduled_update(tid: str, body: dict = Body(...), user: str = Depends(current_user)):
        return nas.scheduler.update(tid, body, user)

    @app.delete("/api/scheduled/{tid}")
    def scheduled_delete(tid: str, user: str = Depends(current_user)):
        nas.scheduler.delete(tid, user)
        return {"ok": True}

    @app.post("/api/scheduled/{tid}/run")
    def scheduled_run(tid: str, user: str = Depends(current_user)):
        nas.scheduler.run_now(tid, user)
        return {"ok": True}

    @app.post("/api/scheduled/{tid}/stop")
    def scheduled_stop(tid: str, user: str = Depends(current_user)):
        nas.scheduler.stop_task(tid)
        return {"ok": True}

    @app.post("/api/scheduled/{tid}/{action}")
    def scheduled_pause(tid: str, action: str, user: str = Depends(current_user)):
        if action not in ("pause", "resume"):
            raise HTTPException(404, "Not found")
        return nas.scheduler.set_enabled(tid, action == "resume", user)

    @app.get("/api/scheduled/{tid}/runs")
    def scheduled_runs(tid: str, _u: str = Depends(current_user)):
        return nas.scheduler.runs(tid)

    @app.get("/api/settings")
    def settings(_u: str = Depends(current_user)):
        return nas.settings()

    @app.put("/api/settings")
    def settings_update(body: dict = Body(...), user: str = Depends(current_user)):
        nas.update_settings(body, user)
        return nas.settings()

    @app.get("/api/settings/timezones")
    def timezones(_u: str = Depends(current_user)):
        return platform.timezones()

    @app.get("/api/system")
    def system(_u: str = Depends(current_user)):
        return {**platform.system_info(), "version": updater.current}

    @app.post("/api/system/power")
    def power(action: str = Body(..., embed=True), user: str = Depends(current_user)):
        nas.state.log_activity(user, f"System {action} requested", "warning")
        platform.power(action)
        if cfg.demo and action == "reboot":            # a simulated restart of about 8 seconds
            updater.restarting_until = time.time() + 8
            server["started"] = time.time() + 8
            nas.state.update(lambda d: d.setdefault("os_updates", {}).__setitem__("demo_restart", False))
        return {"ok": True}

    @app.get("/api/activity")
    def activity_log(offset: int = 0, limit: int = 10, category: str = "", level: str = "",
                     q: str = "", source: str = "talon", system: str = "", _u: str = Depends(current_user)):
        """source: talon (Talon's activity log), system (the system journal) or all (both, newest first)."""
        sources = syslog_reader.sources()
        if source == "system":
            r = syslog_reader.query(offset, limit, system, level, q)
            items = [{**e, "kind": "system"} for e in r["items"]]
            return {"items": items, "total": None, "more": r["more"], "offset": offset, "limit": limit,
                    "categories": activity.categories(), "sources": sources}
        if source == "all":
            n = max(0, offset) + max(1, min(limit, 100)) + 1
            a = nas.state.activity.query(0, n, "", level, q, cap=n)["items"]
            s = syslog_reader.query(0, n, "", level, q, cap=n)["items"]
            merged = sorted([{**e, "kind": "talon"} for e in a] + [{**e, "kind": "system"} for e in s],
                            key=lambda e: e.get("ts", 0), reverse=True)
            page = merged[offset:offset + limit]
            return {"items": page, "total": None, "more": len(merged) > offset + limit, "offset": offset,
                    "limit": limit, "categories": activity.categories(), "sources": sources}
        r = nas.state.activity.query(offset, limit, category, level, q)
        r["items"] = [{**e, "kind": "talon"} for e in r["items"]]
        return {**r, "more": r["offset"] + len(r["items"]) < r["total"], "sources": sources}

    @app.api_route("/api/{rest:path}", methods=["GET", "POST", "PUT", "DELETE"])
    def api_404(rest: str):
        raise HTTPException(404, "Not found")

    # ------------------------------------------------------------ WebDAV (/dav)
    app.mount(DAV_PREFIX, webdav)

    # ------------------------------------------------------------ web UI
    @app.get("/{path:path}")
    def spa(path: str):
        if not os.path.isdir(WEB_DIR):
            return JSONResponse({"detail": "Web UI not built"}, status_code=500)
        full = os.path.realpath(os.path.join(WEB_DIR, path))
        if path and full.startswith(os.path.realpath(WEB_DIR) + os.sep) and os.path.isfile(full):
            headers = {"Cache-Control": "public, max-age=31536000, immutable"} \
                if "/assets/" in full else {}
            return FileResponse(full, headers=headers)
        return FileResponse(os.path.join(WEB_DIR, "index.html"),
                            headers={"Cache-Control": "no-cache"})

    return app
