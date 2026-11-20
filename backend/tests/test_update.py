import io
import json
import tarfile
import time

import pytest

from talon import update, updater


def test_version_compare():
    assert update.is_newer("1.0.1", "1.0.0")
    assert update.is_newer("v2.0.0", "1.9.9")
    assert not update.is_newer("1.0.0", "1.0.0")
    assert not update.is_newer("0.9.0", "1.0.0")
    assert not update.is_newer("garbage", "1.0.0")


def test_check_keeps_last_good_result(tmp_path, monkeypatch):
    from talon.config import Config
    from talon.state import State
    cfg = Config(state_file=str(tmp_path / "s.json"), update_status_file=str(tmp_path / "u.json"))
    st = State(cfg.state_file)
    u = update.Updater(cfg, st)
    monkeypatch.setattr(update, "fetch_latest_release",
                        lambda repo: {"tag": "v9.0.0", "name": "v9", "notes": "n", "url": "u",
                                      "published_at": "x"})
    assert u.check(force=True)["latest"] == "9.0.0"
    assert u.info()["available"]

    def boom(repo):
        raise update.UserError("offline")
    monkeypatch.setattr(update, "fetch_latest_release", boom)
    r = u.check(force=True)
    assert r["latest"] == "9.0.0" and r["error"] == "offline"


def test_stale_running_status_reports_failed(tmp_path):
    from talon.config import Config
    from talon.state import State
    p = tmp_path / "u.json"
    p.write_text(json.dumps({"state": "running", "heartbeat": time.time() - 1000}))
    cfg = Config(state_file=str(tmp_path / "s.json"), update_status_file=str(p))
    assert update.Updater(cfg, State(cfg.state_file)).status()["state"] == "failed"


def test_extract_rejects_path_traversal(tmp_path):
    arc = tmp_path / "bad.tgz"
    with tarfile.open(arc, "w:gz") as tf:
        data = b"x"
        ti = tarfile.TarInfo("../evil")
        ti.size = len(data)
        tf.addfile(ti, io.BytesIO(data))
    with pytest.raises(Exception):
        updater.extract(str(arc), str(tmp_path / "out"))
    assert not (tmp_path / "evil").exists()


def test_demo_update_flow(client):
    info = client.get("/api/update").json()
    assert info["available"] and info["latest"] == "1.1.0"
    r = client.post("/api/update/install")
    assert r.status_code == 200 and r.json()["state"] == "running"
    assert client.post("/api/update/install").status_code == 400   # already running
    saw_restart = False
    for _ in range(300):
        h = client.get("/api/health")
        if h.status_code == 503:
            saw_restart = True
        elif h.json()["version"] == "1.1.0" and not h.json()["updating"]:
            break
        time.sleep(0.1)
    assert saw_restart
    assert client.get("/api/update/status").json()["state"] == "success"
    assert client.get("/api/auth/me").json()["version"] == "1.1.0"   # session survived
