"""Standalone update runner.

Started by the web service through ``systemd-run`` in its own transient unit, so
restarting ``talon.service`` does not kill it.  Steps:

1. download the release archive from GitHub and validate it
2. back up /opt/talon/app and /opt/talon/venv
3. run the release's own install.sh in upgrade mode (installs only missing
   system packages, so Samba/NFS keep serving clients)
4. wait until the restarted service reports the new version
5. on any failure: restore the backup and restart the previous version

Progress is written to the status file that the web UI polls.  This module
must not import anything from the ``talon`` package after start-up, because
the package directory is replaced during the update."""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import ssl
import subprocess
import sys
import tarfile
import threading
import time
import urllib.request

WORK = "/var/lib/talon/update-work"


class Status:
    def __init__(self, path: str):
        self.path = path
        try:
            with open(path) as f:
                self.data = json.load(f)
        except (OSError, ValueError):
            self.data = {"log": []}
        self.data.setdefault("log", [])

    def save(self) -> None:
        self.data["heartbeat"] = time.time()
        tmp = self.path + ".tmp"
        with open(tmp, "w") as f:
            json.dump(self.data, f)
        os.chmod(tmp, 0o600)
        os.replace(tmp, self.path)

    def step(self, step: str, msg: str) -> None:
        self.data["step"] = step
        self.log(msg)

    def log(self, line: str) -> None:
        for part in str(line).rstrip().splitlines() or [""]:
            self.data["log"].append(part[:500])
        del self.data["log"][:-400]
        self.save()


def version_tuple(v: str):
    m = re.match(r"^v?(\d+)\.(\d+)\.(\d+)$", v.strip())
    return tuple(int(x) for x in m.groups()) if m else None


def download(repo: str, tag: str, dest: str) -> None:
    url = f"https://codeload.github.com/{repo}/tar.gz/refs/tags/{tag}"
    req = urllib.request.Request(url, headers={"User-Agent": "Talon-NAS-updater"})
    with urllib.request.urlopen(req, timeout=120, context=ssl.create_default_context()) as r, \
            open(dest, "wb") as f:
        shutil.copyfileobj(r, f)


def extract(archive: str, dest: str) -> str:
    with tarfile.open(archive, "r:gz") as tf:
        if hasattr(tarfile, "data_filter"):
            tf.extractall(dest, filter="data")
        else:  # pragma: no cover - very old Python patch releases
            for m in tf.getmembers():
                if m.name.startswith("/") or ".." in m.name.split("/") or m.issym() or m.islnk():
                    raise RuntimeError(f"unsafe path in archive: {m.name}")
            tf.extractall(dest)
    dirs = [d for d in os.listdir(dest) if os.path.isdir(os.path.join(dest, d))]
    if len(dirs) != 1:
        raise RuntimeError("unexpected archive layout")
    return os.path.join(dest, dirs[0])


def health(port: int) -> dict:
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE   # local self-signed certificate
    for scheme, kw in (("https", {"context": ctx}), ("http", {})):
        try:
            with urllib.request.urlopen(f"{scheme}://127.0.0.1:{port}/api/health",
                                        timeout=5, **kw) as r:
                return json.load(r)
        except Exception:
            continue
    return {}


def copy_tree(src: str, dst: str) -> None:
    if os.path.exists(dst):
        shutil.rmtree(dst)
    subprocess.run(["cp", "-a", src, dst], check=True)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--tag", required=True)
    ap.add_argument("--repo", required=True)
    ap.add_argument("--port", type=int, required=True)
    ap.add_argument("--prefix", default="/opt/talon")
    ap.add_argument("--status", required=True)
    a = ap.parse_args(argv)

    st = Status(a.status)
    st.data.update(state="running")
    target = a.tag.lstrip("v")
    app, venv = os.path.join(a.prefix, "app"), os.path.join(a.prefix, "venv")
    backed_up = False
    try:
        if not re.match(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$", a.repo) or not version_tuple(a.tag):
            raise RuntimeError("invalid repository or tag")

        st.step("download", f"Downloading {a.repo} {a.tag}")
        shutil.rmtree(WORK, ignore_errors=True)
        os.makedirs(WORK, mode=0o700)
        archive = os.path.join(WORK, "release.tar.gz")
        download(a.repo, a.tag, archive)
        st.log(f"Downloaded {os.path.getsize(archive) // 1024} KB")
        src = extract(archive, os.path.join(WORK, "src"))
        init = os.path.join(src, "backend", "talon", "__init__.py")
        for need in ("install.sh", "backend/talon/web/index.html", "backend/requirements.txt"):
            if not os.path.exists(os.path.join(src, need)):
                raise RuntimeError(f"release archive is missing {need}")
        m = re.search(r'__version__\s*=\s*"([^"]+)"', open(init).read())
        if not m or m.group(1) != target:
            raise RuntimeError(f"archive version {m.group(1) if m else '?'} does not match {a.tag}")
        st.log("Release archive verified")

        st.step("backup", "Backing up the current version")
        copy_tree(app, app + ".prev")
        copy_tree(venv, venv + ".prev")
        backed_up = True

        st.step("install", f"Installing Talon {target}")
        env = dict(os.environ, TALON_UPGRADE="1", DEBIAN_FRONTEND="noninteractive",
                   TERM="dumb")
        proc = subprocess.Popen(["bash", os.path.join(src, "install.sh")], cwd=src, env=env,
                                stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                stderr=subprocess.STDOUT, text=True)

        def pump():
            assert proc.stdout
            for line in proc.stdout:
                line = re.sub(r"\x1b\[[0-9;]*m", "", line).rstrip()
                if line:
                    st.log(line)

        # Read output in a thread: a process started by the installer could keep
        # the pipe open, so completion is decided by the installer's exit only.
        reader = threading.Thread(target=pump, daemon=True)
        reader.start()
        try:
            code = proc.wait(timeout=1800)
        except subprocess.TimeoutExpired:
            proc.kill()
            raise RuntimeError("installer timed out")
        reader.join(timeout=5)
        if code != 0:
            raise RuntimeError(f"installer exited with code {code}")

        st.step("restart", "Waiting for Talon to come back online")
        deadline = time.time() + 120
        while time.time() < deadline:
            h = health(a.port)
            if h.get("version") == target:
                break
            st.save()
            time.sleep(2)
        else:
            raise RuntimeError("the new version did not start in time")

        st.data.update(state="success", step="done", finished=time.time())
        st.log(f"Talon {target} is running")
        shutil.rmtree(WORK, ignore_errors=True)
        return 0
    except Exception as e:  # noqa: BLE001 - always try to roll back
        st.log(f"ERROR: {e}")
        if backed_up:
            st.step("rollback", "Restoring the previous version")
            try:
                copy_tree(app + ".prev", app)
                copy_tree(venv + ".prev", venv)
                subprocess.run(["systemctl", "restart", "talon"], check=False)
                st.log("Previous version restored")
            except Exception as e2:  # noqa: BLE001
                st.log(f"Rollback failed: {e2}")
        else:
            subprocess.run(["systemctl", "start", "talon"], check=False)
        st.data.update(state="failed", error=str(e), finished=time.time())
        st.save()
        return 1


if __name__ == "__main__":
    sys.exit(main())
