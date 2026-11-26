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


def test_update_check_interval(client):
    assert client.get("/api/update").json()["interval_hours"] == 6
    assert client.put("/api/update/settings", json={"interval_hours": 24}).json()["interval_hours"] == 24
    assert client.get("/api/update").json()["interval_hours"] == 24
    assert client.put("/api/update/settings", json={"interval_hours": 0}).json()["interval_hours"] == 0
    for bad in (5, "x", None, -1):
        assert client.put("/api/update/settings", json={"interval_hours": bad}).status_code == 400


def test_update_auto_install_and_os_interval(client):
    assert client.get("/api/update").json()["auto_install"] is False
    assert client.put("/api/update/settings", json={"auto_install": True}).json()["auto_install"] is True
    assert client.get("/api/update").json()["interval_hours"] in (0, 1, 6, 12, 24, 168)   # untouched
    os_ = client.get("/api/os-update").json()
    assert os_["auto"]["interval_hours"] == 24
    assert client.put("/api/os-update/auto", json={"interval_hours": 168}).json()["auto"]["interval_hours"] == 168
    assert client.put("/api/os-update/auto", json={"interval_hours": 5}).status_code == 400


def test_parse_changelog():
    text = "# notes\n\n## 1.0.3\n- Three\n- Three b\n\n## 1.0.2\n\n## v1.0.1\n- One\nnot a change\n"
    assert update.parse_changelog(text) == [{"version": "1.0.3", "items": ["Three", "Three b"]},
                                            {"version": "1.0.1", "items": ["One"]}]


def test_changelog_from_github_with_dates(tmp_path, monkeypatch):
    from talon.config import Config
    from talon.state import State
    cfg = Config(state_file=str(tmp_path / "s.json"), update_status_file=str(tmp_path / "u.json"))
    u = update.Updater(cfg, State(cfg.state_file))

    def fake_get(url, timeout=15):
        if url.endswith("CHANGELOG.md"):
            return b"## 9.0.1\n- Newer\n\n## 9.0.0\n- Older\n"
        return json.dumps([{"tag_name": "v9.0.1", "published_at": "2026-11-26T15:04:36Z"},
                           {"tag_name": "v9.0.0", "published_at": "2026-11-23T12:00:00Z"}]).encode()
    monkeypatch.setattr(update, "_get", fake_get)
    cl = u.changelog()
    assert cl["error"] is None and cl["current"] == u.current
    assert [v["version"] for v in cl["versions"]] == ["9.0.1", "9.0.0"]
    assert cl["versions"][0]["date"] == 1795705476.0                       # 2026-11-26 15:04:36 UTC

    # offline: the copy installed with Talon, without dates, and the reason
    u._changelog = {}
    monkeypatch.setattr(update, "fetch_changelog", lambda repo: (_ for _ in ()).throw(update.UserError("Could not reach GitHub: down")))
    cl = u.changelog()
    assert cl["error"].startswith("Could not reach GitHub") and cl["versions"]
    assert cl["versions"][0]["date"] is None and cl["versions"][0]["items"]


def test_changelog_api(client):
    cl = client.get("/api/update/changelog").json()
    assert cl["versions"] and all(v["items"] for v in cl["versions"])
    assert any(v["version"] == cl["current"] for v in cl["versions"])            # the installed one is listed
    assert all(v["date"] for v in cl["versions"])                                # the demo makes up dates
