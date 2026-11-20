import time


GUID = "11111111-2222-3333-4444-555555555555"
ORIGIN = "https://nas.local"


def test_entra_settings_and_test(client):
    assert client.get("/api/settings/entra").json()["configured"] is False
    bad = client.put("/api/settings/entra", json={"client_id": "nope", "client_secret": "x"})
    assert bad.status_code == 400
    r = client.put("/api/settings/entra", json={"tenant": "common", "client_id": GUID,
                                                "client_secret": "s3cret"})
    assert r.status_code == 200 and r.json()["secret_set"] and "client_secret" not in r.json()
    # an empty secret keeps the saved one
    r = client.put("/api/settings/entra", json={"tenant": "consumers", "client_id": GUID,
                                                "client_secret": ""})
    assert r.json()["secret_set"] and r.json()["tenant"] == "consumers"
    t = client.post("/api/settings/entra/test", json={"config": {}, "origin": ORIGIN}).json()
    assert all(c["ok"] for c in t["checks"])
    assert any(c["detail"] == ORIGIN + "/api/onedrive/callback" for c in t["checks"])
    assert client.post("/api/settings/entra/test",
                       json={"config": {}, "origin": "javascript:x"}).status_code == 400


def test_smtp_and_notifications(client):
    n = client.get("/api/notifications").json()
    assert n["smtp"] is False and n["events"]["raid"] is True
    assert client.put("/api/settings/smtp", json={"host": "smtp.x.com", "port": 587,
                                                  "security": "starttls",
                                                  "sender": "bad"}).status_code == 400
    r = client.put("/api/settings/smtp", json={"host": "smtp.example.com", "port": 587,
                                               "security": "starttls", "username": "nas",
                                               "password": "pw", "sender": "nas@example.com"})
    assert r.status_code == 200 and r.json()["password_set"] and "password" not in r.json()
    assert client.post("/api/settings/smtp/test",
                       json={"config": {"host": "smtp.example.com", "port": 587,
                                        "security": "starttls", "sender": "nas@example.com"}}
                       ).json()["checks"][-1]["ok"]
    assert client.post("/api/notifications/test").status_code == 400      # no recipients yet
    r = client.put("/api/notifications", json={"recipients": "me@example.com, you@example.com",
                                               "events": {"raid": False}})
    assert r.json()["recipients"] == ["me@example.com", "you@example.com"]
    assert r.json()["events"]["raid"] is False and r.json()["smtp"] is True
    assert client.post("/api/notifications/test").status_code == 200
    assert client.put("/api/notifications", json={"recipients": "not-an-email"}).status_code == 400


def test_notifier_classifies_alerts():
    from talon.notify import Notifier
    assert Notifier.classify({"title": "RAID tank is degraded"}) == "raid"
    assert Notifier.classify({"title": "Disk sda is hot"}) == "disk_temp"
    assert Notifier.classify({"title": "Disk sda is failing"}) == "disk"
    assert Notifier.classify({"title": "Volume tank is almost full"}) == "volume_full"


def test_onedrive_flow(client):
    services = {s["id"]: s for s in client.get("/api/services").json()}
    assert services["onedrive"]["enabled"] is False
    # connecting needs the Entra app
    assert client.post("/api/onedrive/connect", json={"origin": ORIGIN}).status_code == 400
    client.put("/api/settings/entra", json={"tenant": "common", "client_id": GUID,
                                            "client_secret": "s3cret"})
    assert client.post("/api/services/onedrive/enable").status_code == 200
    assert client.get("/api/onedrive").json()["enabled"] is True

    url = client.post("/api/onedrive/connect", json={"origin": ORIGIN}).json()["url"]
    assert url.startswith(ORIGIN + "/api/onedrive/callback?")
    page = client.get("/api/onedrive/callback?" + url.split("?", 1)[1]).text
    assert "OneDrive connected" in page and "postMessage" in page
    # the state value is single-use
    assert "expired" in client.get("/api/onedrive/callback?" + url.split("?", 1)[1]).text
    st = client.get("/api/onedrive").json()
    assert st["connected"] and st["account"]["email"]

    assert "Pictures" in [i["name"] for i in client.get("/api/onedrive/folders").json()]
    assert client.get("/api/onedrive/folders?path=../etc").status_code == 400

    bad = client.post("/api/onedrive/tasks", json={"name": "x", "direction": "sideways",
                                                   "volume": "tank"})
    assert bad.status_code == 400
    r = client.post("/api/onedrive/tasks", json={
        "name": "Photos backup", "direction": "pull", "remote": "Pictures", "volume": "tank",
        "folder": "Photos", "schedule": {"kind": "daily", "time": "02:00"}, "versions": True})
    assert r.status_code == 200, r.text
    task = r.json()
    assert task["next_run"]
    assert client.post(f"/api/onedrive/tasks/{task['id']}/run").status_code == 200
    assert client.post(f"/api/onedrive/tasks/{task['id']}/run").status_code == 400  # running
    end = time.time() + 30
    while time.time() < end:
        t = next(x for x in client.get("/api/onedrive").json()["tasks"] if x["id"] == task["id"])
        if not t["running"] and t["last"]:
            break
        time.sleep(0.5)
    assert t["last"]["status"] == "success" and t["last"]["files"] > 0
    assert client.get(f"/api/onedrive/tasks/{task['id']}/log").json()

    upd = client.put(f"/api/onedrive/tasks/{task['id']}", json={
        **task, "direction": "bisync", "schedule": {"kind": "interval", "minutes": 15}})
    assert upd.json()["direction"] == "bisync" and upd.json()["delete"] is False
    assert client.delete(f"/api/onedrive/tasks/{task['id']}").status_code == 200
    assert client.post("/api/onedrive/disconnect").status_code == 200
    assert client.get("/api/onedrive").json()["connected"] is False
    assert client.post("/api/services/onedrive/disable").status_code == 200


def test_rclone_commands(tmp_path):
    from types import SimpleNamespace
    from talon.cloudsync import CloudSync
    cs = CloudSync(SimpleNamespace(state_file=str(tmp_path / "s.json")), None, None, demo=True)
    base = {"id": "t1", "remote": "Pictures", "bwlimit": "", "delete": False,
            "versions": False, "max_delete": 50}
    pull = cs.command({**base, "direction": "pull"}, "c.conf", "/srv/nas/tank/Photos", False)
    assert pull[-3:] == ["copy", "onedrive:Pictures", "/srv/nas/tank/Photos"]
    push = cs.command({**base, "direction": "push", "delete": True, "versions": True,
                       "bwlimit": "10M"}, "c.conf", "/srv/nas/tank/Docs", False)
    assert "sync" in push and push[push.index("sync") + 2] == "onedrive:Pictures"
    assert push[push.index("--backup-dir") + 1].startswith("onedrive:Pictures/.versions/")
    assert push[push.index("--bwlimit") + 1] == "10M"
    bi = cs.command({**base, "direction": "bisync"}, "c.conf", "/srv/nas/tank/Work", True)
    assert "bisync" in bi and "--resync" in bi and bi[bi.index("--max-delete") + 1] == "50"
    assert bi[bi.index("--conflict-loser") + 1] == "num"


def test_daily_schedule_due():
    from types import SimpleNamespace
    from talon.cloudsync import CloudSync
    cs = CloudSync(SimpleNamespace(state_file="/tmp/x.json"), None, None, demo=True)
    lt = time.localtime()
    today_2am = time.mktime((lt.tm_year, lt.tm_mon, lt.tm_mday, 2, 0, 0, 0, 0, -1))
    t = {"schedule": {"kind": "daily", "time": "02:00"}, "created": today_2am - 86400, "last": None}
    assert cs._due(t, today_2am + 60)
    assert not cs._due({**t, "last": {"started": today_2am + 30}}, today_2am + 60)
    assert not cs._due(t, today_2am - 60)
    iv = {"schedule": {"kind": "interval", "minutes": 15}, "created": 1000, "last": None}
    assert not cs._due(iv, 1000 + 14 * 60) and cs._due(iv, 1000 + 15 * 60)


def test_new_local_folder(client):
    r = client.post("/api/onedrive/local-folders", json={"volume": "tank", "path": "", "name": "Backups"})
    assert r.status_code == 200 and r.json()["path"] == "Backups"
    assert "Backups" in [i["name"] for i in client.get("/api/onedrive/local-folders?volume=tank").json()]
    sub = client.post("/api/onedrive/local-folders", json={"volume": "tank", "path": "Backups", "name": "Phone"})
    assert sub.json()["path"] == "Backups/Phone"
    for bad in ["", "..", ".hidden", "a/b"]:
        assert client.post("/api/onedrive/local-folders",
                           json={"volume": "tank", "path": "", "name": bad}).status_code == 400, bad
    assert client.post("/api/onedrive/local-folders",
                       json={"volume": "tank", "path": "", "name": "Backups"}).status_code == 400


def test_single_file_tasks(client, tmp_path):
    from types import SimpleNamespace
    from talon.cloudsync import CloudSync
    client.put("/api/settings/entra", json={"tenant": "common", "client_id": GUID, "client_secret": "s"})
    items = client.get("/api/onedrive/folders?path=Documents").json()
    assert {"name": "Invoices", "folder": True, "size": 0} in items
    assert any(i["name"] == "Passport scan.jpg" and not i["folder"] for i in items)
    local = client.get("/api/onedrive/local-folders?volume=tank").json()
    assert local[0]["folder"] and any(not i["folder"] for i in local)
    base = {"name": "Passport", "remote": "Documents/Passport scan.jpg", "volume": "tank",
            "folder": "Important", "schedule": {"kind": "manual"}}
    assert client.post("/api/onedrive/tasks", json={**base, "direction": "bisync",
                                                    "source_file": True}).status_code == 400
    t = client.post("/api/onedrive/tasks", json={**base, "direction": "pull", "source_file": True,
                                                 "delete": True}).json()
    assert t["source_file"] is True and t["delete"] is False
    client.delete(f"/api/onedrive/tasks/{t['id']}")
    cs = CloudSync(SimpleNamespace(state_file=str(tmp_path / "s.json")), None, None, demo=True)
    cmd = cs.command({"id": "x", "remote": "Documents/Passport scan.jpg", "bwlimit": "",
                      "delete": False, "versions": False, "max_delete": 50, "direction": "pull",
                      "source_file": True}, "c.conf", "/srv/nas/tank/Important", False)
    assert cmd[-3:] == ["copy", "onedrive:Documents/Passport scan.jpg", "/srv/nas/tank/Important"]


def test_rclone_log_lines_keep_time_level_file_and_message():
    from talon.cloudsync import CloudSync
    r = {"log": []}
    CloudSync._parse('{"level":"info","msg":"Copied (new)","object":"Pictures/a b.jpg",'
                     '"time":"2026-11-20T02:00:03.123+02:00"}', r)
    CloudSync._parse('{"level":"error","msg":"Failed to copy: quota exceeded","time":"2026-11-20T02:00:04+02:00"}', r)
    CloudSync._parse("plain text from rclone", r)
    assert r["log"] == ["02:00:03\tINFO\tPictures/a b.jpg\tCopied (new)",
                        "02:00:04\tERROR\t\tFailed to copy: quota exceeded",
                        "plain text from rclone"]


def test_rclone_error_detection():
    from talon.cloudsync import CloudSync, RCLONE_EXIT
    assert CloudSync._is_error('{"level":"critical","msg":"Failed to create file system"}')
    assert CloudSync._is_error('{"level":"error","msg":"x"}')
    assert not CloudSync._is_error('{"level":"info","msg":"Copied"}')
    assert CloudSync._is_error("Error: unknown flag: --foo")
    assert CloudSync._message('{"level":"error","object":"a/b.jpg","msg":"Failed to copy: quota"}') == "a/b.jpg: Failed to copy: quota"
    assert RCLONE_EXIT[2] == "rclone: syntax or usage error"
