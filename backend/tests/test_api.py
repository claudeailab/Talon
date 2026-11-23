import json
from conftest import wait_job


def test_auth_required_and_csrf(client):
    from fastapi.testclient import TestClient
    anon = TestClient(client.app)
    assert anon.get("/api/disks").status_code == 401
    assert anon.post("/api/auth/login", json={"username": "a", "password": "b"}).status_code == 403
    bad = client.post("/api/auth/login", json={"username": "admin", "password": "nope"})
    assert bad.status_code == 401
    # non-admin users cannot log in
    r = client.post("/api/auth/login", json={"username": "alice", "password": "talon"})
    assert r.status_code == 401


def test_disk_status(client):
    disks = {d["name"]: d for d in client.get("/api/disks").json()}
    assert disks["nvme0n1"]["status"] == "system" and not disks["nvme0n1"]["selectable"]
    assert disks["sda"]["status"] == "raid" and disks["sda"]["array"] == "tank"
    assert disks["sda"]["volume"] == "tank"
    assert disks["sde"]["status"] == "volume"
    assert disks["sdd"]["status"] == "available" and disks["sdd"]["selectable"]
    assert disks["sdg"]["status"] == "has_data" and disks["sdg"]["selectable"]


def test_existing_raid_volume_is_migrated(client):
    arrays = {a["name"]: a for a in client.get("/api/raid").json()}
    assert arrays["tank"]["level"] == "raid5" and arrays["tank"]["volume"] == "tank"
    vols = {v["name"]: v for v in client.get("/api/volumes").json()}
    assert vols["tank"]["array"] == "tank" and vols["tank"]["level"] == "raid5"
    assert vols["backup"]["array"] is None and vols["backup"]["disk"] == "sde"


def test_raid_options_endpoint(client):
    opts = client.post("/api/raid/options", json={"disks": ["sdd", "sdf"], "spares": 0}).json()
    assert "single" not in {o["id"] for o in opts}
    assert {o["id"] for o in opts if o["available"]} == {"raid0", "raid1"}


def test_raid_then_volume_lifecycle(client):
    r = client.post("/api/raid", json={"name": "fast", "level": "raid1", "disks": ["sdd", "sdf"]})
    assert r.status_code == 200, r.text
    assert wait_job(client, r.json())["status"] == "success"
    arrays = {a["name"]: a for a in client.get("/api/raid").json()}
    assert arrays["fast"]["volume"] is None and len(arrays["fast"]["members"]) == 2
    # in-use disks cannot be reused
    assert client.post("/api/raid", json={"name": "x", "level": "raid1",
                                          "disks": ["sdd", "sdg"]}).status_code == 400
    # the new array is offered as a volume source
    src = client.get("/api/volumes/sources").json()
    assert "fast" in {a["name"] for a in src["arrays"]}
    assert "tank" not in {a["name"] for a in src["arrays"]}   # already has a volume
    r = client.post("/api/volumes", json={"name": "fastvol", "fs": "xfs", "array": "fast"})
    assert r.status_code == 200, r.text
    assert wait_job(client, r.json())["status"] == "success"
    vols = {v["name"]: v for v in client.get("/api/volumes").json()}
    assert vols["fastvol"]["level"] == "raid1" and vols["fastvol"]["mounted"]
    # the array cannot be deleted while a volume uses it
    assert client.delete("/api/raid/fast").status_code == 400
    # share blocks volume deletion
    s = client.post("/api/shares", json={"name": "Fast", "volume": "fastvol",
                                         "users": {"alice": "rw"}, "smb": {"enabled": True}})
    assert s.status_code == 200, s.text
    assert client.delete("/api/volumes/fastvol").status_code == 400
    assert client.delete("/api/shares/Fast").status_code == 200
    r = client.delete("/api/volumes/fastvol")
    assert wait_job(client, r.json())["status"] == "success"
    # deleting the volume keeps the array
    assert "fast" in {a["name"] for a in client.get("/api/raid").json()}
    r = client.delete("/api/raid/fast")
    assert wait_job(client, r.json())["status"] == "success"
    disks = {d["name"]: d for d in client.get("/api/disks").json()}
    assert disks["sdd"]["status"] == "available"


def test_single_disk_volume(client):
    r = client.post("/api/volumes", json={"name": "scratch", "fs": "ext4", "disk": "sdd"})
    assert wait_job(client, r.json())["status"] == "success"
    vols = {v["name"]: v for v in client.get("/api/volumes").json()}
    assert vols["scratch"]["level"] == "single" and vols["scratch"]["disk"] == "sdd"
    r = client.delete("/api/volumes/scratch")
    assert wait_job(client, r.json())["status"] == "success"


def test_invalid_raid_and_volume_requests(client):
    for body in [
        {"name": "Bad Name", "level": "raid1", "disks": ["sdd", "sdf"]},
        {"name": "v", "level": "raid5", "disks": ["sdd", "sdf"]},
        {"name": "v", "level": "raid1", "disks": ["nvme0n1", "sdd"]},
        {"name": "v", "level": "single", "disks": ["sdd"]},
        {"name": "tank", "level": "raid1", "disks": ["sdd", "sdf"]},
    ]:
        assert client.post("/api/raid", json=body).status_code == 400, body
    for body in [
        {"name": "v", "fs": "btrfs", "disk": "sdd"},
        {"name": "v", "fs": "ext4"},
        {"name": "v", "fs": "ext4", "array": "tank"},
        {"name": "v", "fs": "ext4", "disk": "nvme0n1"},
        {"name": "tank", "fs": "ext4", "disk": "sdd"},
    ]:
        assert client.post("/api/volumes", json=body).status_code == 400, body


def test_shares_and_config(client):
    r = client.post("/api/shares", json={
        "name": "Projects", "volume": "tank", "description": "Work",
        "users": {"alice": "rw", "bob": "ro"}, "groups": {"family": "ro"},
        "smb": {"enabled": True, "recycle_bin": True},
        "nfs": {"enabled": True, "clients": [{"host": "192.168.1.0/24", "access": "rw"}]}})
    assert r.status_code == 200, r.text
    p = client.app.state.nas.p
    assert "[Projects]" in p.smb_conf
    assert "write list = alice" in p.smb_conf
    assert "valid users = bob alice @family" in p.smb_conf or "valid users = " in p.smb_conf
    assert "/srv/nas/tank/Projects 192.168.1.0/24(rw,sync" in p.nfs_conf
    bad = client.post("/api/shares", json={"name": "x;y", "volume": "tank"})
    assert bad.status_code == 400
    bad = client.post("/api/shares", json={"name": "z", "volume": "tank",
                                           "nfs": {"enabled": True, "clients": [{"host": "a b"}]}})
    assert bad.status_code == 400
    dup = client.post("/api/shares", json={"name": "projects", "volume": "tank"})
    assert dup.status_code == 400


def test_users_groups(client):
    assert client.post("/api/users", json={"name": "zoe", "password": "short"}).status_code == 400
    assert client.post("/api/users", json={"name": "zoe", "password": "longenough1",
                                           "full_name": "Zoe"}).status_code == 200
    assert client.post("/api/groups", json={"name": "kids", "members": ["zoe"]}).status_code == 200
    users = {u["name"]: u for u in client.get("/api/users").json()}
    assert users["zoe"]["groups"] == ["kids"]
    # cannot delete yourself or the last admin
    assert client.delete("/api/users/admin").status_code == 400
    assert client.put("/api/users/admin", json={"admin": False}).status_code == 400
    assert client.delete("/api/users/zoe").status_code == 200
    assert client.delete("/api/groups/kids").status_code == 200


def test_group_names_taken_by_the_system_or_talon(client):
    r = client.post("/api/groups", json={"name": "users", "members": []})
    assert r.status_code == 400 and "operating system" in r.json()["detail"]
    r = client.post("/api/groups", json={"name": "nasusers", "members": []})
    assert r.status_code == 400 and "Talon itself" in r.json()["detail"]
    assert client.post("/api/groups", json={"name": "team", "members": []}).status_code == 200
    r = client.post("/api/groups", json={"name": "team", "members": []})
    assert r.status_code == 400 and "already exists" in r.json()["detail"]


def test_group_description(client):
    assert client.post("/api/groups", json={"name": "sales", "members": [], "description": "Sales team"}).status_code == 200
    g = next(g for g in client.get("/api/groups").json() if g["name"] == "sales")
    assert g["description"] == "Sales team"
    assert client.put("/api/groups/sales", json={"members": ["admin"]}).status_code == 200   # description kept
    g = next(g for g in client.get("/api/groups").json() if g["name"] == "sales")
    assert (g["description"], g["members"]) == ("Sales team", ["admin"])
    assert client.put("/api/groups/sales", json={"members": [], "description": ""}).status_code == 200
    assert next(g for g in client.get("/api/groups").json() if g["name"] == "sales")["description"] == ""
    assert client.delete("/api/groups/sales").status_code == 200
    assert "sales" not in (client.app.state.nas.state.get("group_info") or {})


def test_expand_and_replace(client):
    r = client.post("/api/raid/tank/disks", json={"disk": "sdd", "mode": "spare"})
    assert wait_job(client, r.json())["status"] == "success"
    tank = next(a for a in client.get("/api/raid").json() if a["name"] == "tank")
    assert any(m["state"] == "spare" for m in tank["members"])
    part = next(m["part"] for m in tank["members"] if m["state"] == "spare")
    r = client.delete(f"/api/raid/tank/members/{part}")
    assert wait_job(client, r.json())["status"] == "success"
    # removing an active member of a RAID5 is allowed once (fault tolerance 1)
    r = client.delete("/api/raid/tank/members/sda1")
    assert wait_job(client, r.json())["status"] == "success"
    tank = next(a for a in client.get("/api/raid").json() if a["name"] == "tank")
    assert tank["status"] == "degraded"
    assert client.delete("/api/raid/tank/members/sdb1").status_code == 400
    r = client.post("/api/raid/tank/disks", json={"disk": "sdd", "mode": "replace"})
    assert wait_job(client, r.json())["status"] == "success"
    tank = next(a for a in client.get("/api/raid").json() if a["name"] == "tank")
    assert tank["status"] == "rebuilding"


def test_dashboard_and_settings(client):
    d = client.get("/api/dashboard").json()
    assert d["info"]["hostname"] and "volumes" in d
    assert isinstance(d["arrays"], list) and isinstance(d["share_list"], list)
    assert d["onedrive"] is None                      # service off by default
    r = client.put("/api/settings", json={"workgroup": "home", "hostname": "mynas"})
    assert r.status_code == 200 and r.json()["workgroup"] == "HOME"
    assert client.put("/api/settings", json={"hostname": "-bad-"}).status_code == 400
    assert client.get("/api/activity").json()


def test_activity_paging(client):
    for i in range(25):
        client.app.state.nas.state.log_activity("admin", f"event {i}")
    first = client.get("/api/activity").json()
    assert first["limit"] == 10 and len(first["items"]) == 10 and first["total"] >= 25
    assert first["items"][0]["message"] == "event 24"            # newest first
    second = client.get("/api/activity?offset=10&limit=10").json()
    assert second["items"][0]["message"] == "event 14"
    assert len(client.get("/api/activity?limit=1000").json()["items"]) <= 100


def test_disks_from_another_raid_can_be_reused(client):
    disks = {d["name"]: d for d in client.get("/api/disks").json()}
    old = disks["sdh"]
    assert old["status"] == "raid_member" and old["selectable"]
    assert "erased when you use the disk" in old["status_detail"]
    assert disks["sdi"]["md"] == old["md"]
    # wiping one disk stops the old array; its other disk then just has data
    j = wait_job(client, client.post("/api/disks/sdh/wipe").json())
    assert j["status"] == "success", j
    disks = {d["name"]: d for d in client.get("/api/disks").json()}
    assert disks["sdh"]["status"] == "available"
    assert disks["sdi"]["status"] == "has_data" and disks["sdi"]["selectable"]
    # and both can go straight into a new RAID
    r = client.post("/api/raid", json={"name": "mirror", "level": "raid1", "disks": ["sdh", "sdi"]})
    assert wait_job(client, r.json())["status"] == "success"
    assert any(a["name"] == "mirror" for a in client.get("/api/raid").json())


def test_old_raid_disks_go_straight_into_a_new_raid(client):
    r = client.post("/api/raid", json={"name": "reuse", "level": "raid1", "disks": ["sdh", "sdi"]})
    assert r.status_code == 200, r.text
    assert wait_job(client, r.json())["status"] == "success"
    disks = {d["name"]: d for d in client.get("/api/disks").json()}
    assert disks["sdh"]["array"] == "reuse" and disks["sdi"]["array"] == "reuse"


def test_new_raid5_shows_building_not_rebuilding(client):
    r = client.post("/api/raid", json={"name": "fresh", "level": "raid5", "disks": ["sdd", "sdh", "sdi"]})
    assert wait_job(client, r.json())["status"] == "success"
    a = next(x for x in client.get("/api/raid").json() if x["name"] == "fresh")
    assert a["status"] == "building" and a["sync"]["label"] == "Building"
    assert [m["state"] for m in a["members"]] == ["active", "active", "syncing"]
    # once built it is an ordinary array: a later recover is a real rebuild
    nas = client.app.state.nas
    for arr in nas.p.arrays.values():
        if arr["name"] == "fresh":
            arr["sync_start"] = 1
    a = next(x for x in client.get("/api/raid").json() if x["name"] == "fresh")
    assert a["status"] == "healthy"
    assert nas.state.get("arrays")["fresh"]["synced"] is True


def test_http_session_uses_its_own_cookie(client, monkeypatch):
    """Over plain HTTP the session cookie has another name, so a Secure cookie left
    from HTTPS (which an http:// page may not replace) cannot block signing in."""
    cfg = client.app.state.nas.cfg
    monkeypatch.setattr(cfg, "demo", False)
    from fastapi.testclient import TestClient
    http = TestClient(client.app, base_url="http://nas")
    http.cookies.set("talon_session", "stale-token-from-https")
    r = http.post("/api/auth/login", json={"username": "admin", "password": "talon"},
                  headers={"X-Requested-With": "talon"})
    assert r.status_code == 200
    assert "talon_session_http=" in r.headers["set-cookie"] and "Secure" not in r.headers["set-cookie"]
    assert http.get("/api/auth/me").status_code == 200
    https = TestClient(client.app, base_url="https://nas")
    r = https.post("/api/auth/login", json={"username": "admin", "password": "talon"},
                   headers={"X-Requested-With": "talon"})
    assert r.headers["set-cookie"].startswith("talon_session=") and "Secure" in r.headers["set-cookie"]


def test_alert_thresholds(client):
    nas = client.app.state.nas
    info = client.get("/api/thresholds").json()
    assert info["values"] == {"temp_hdd": 55, "temp_ssd": 65, "temp_nvme": 75,
                              "volume_full": 90, "ssd_wear": 90, "bad_sectors": True}
    assert info["now"]["hdd"] and info["now"]["nvme"]          # demo disks report temperatures
    # an HDD at 40 °C: no alert at 55, an alert once the limit is 35
    sda = next(d for d in nas.disks() if d["name"] == "sda")
    assert not any(a["title"] == "Disk sda is hot" for a in nas.alerts())
    r = client.put("/api/thresholds", json={**info["values"], "temp_hdd": 30})
    assert r.status_code == 200 and r.json()["values"]["temp_hdd"] == 30
    if sda["temperature"] and sda["temperature"] >= 30:
        assert any(a["title"] == "Disk sda is hot" for a in nas.alerts())
    # volume almost full follows its threshold too (demo tank is about 40% used)
    client.put("/api/thresholds", json={**info["values"], "volume_full": 50})
    assert not any("tank is almost full" in a["title"] for a in nas.alerts())
    for bad in ({"temp_hdd": 10}, {"volume_full": 100}, {"ssd_wear": "x"}):
        assert client.put("/api/thresholds", json={**info["values"], **bad}).status_code == 400


def test_sd_card_protection_is_a_service(client):
    svc = next(s for s in client.get("/api/services").json() if s["id"] == "sdcard")
    assert not svc["enabled"] and "SD card" in svc["writes"]["recommended"]   # off by default, recommended
    assert client.post("/api/services/sdcard/enable").status_code == 200
    svc = next(s for s in client.get("/api/services").json() if s["id"] == "sdcard")
    assert svc["enabled"]
    acts = client.get("/api/activity", params={"q": "system disk"}).json()["items"]
    assert acts and "Turned on" in acts[0]["message"]


def test_ramlog_script_never_blocks_the_boot():
    from talon.ramlog import SCRIPT_TEXT, UNIT_TEXT, flash_kind
    assert SCRIPT_TEXT.rstrip().endswith("exit 0") and "|| exit 0" in SCRIPT_TEXT
    assert "DefaultDependencies=no" in UNIT_TEXT and "ExecStop=" in UNIT_TEXT
    assert (flash_kind("mmcblk0"), flash_kind("sda", "usb", False), flash_kind("sda", "usb", True), flash_kind("nvme0n1")) == ("sd", "usb", "", "")


def test_os_updates(client):
    import time
    client.post("/api/os-update/check")
    for _ in range(100):
        info = client.get("/api/os-update").json()
        if info["checking"]["state"] != "running":
            break
        time.sleep(0.1)
    assert info["checking"]["state"] == "success" and info["checking"]["percent"] == 100
    assert info["packages"] and info["security"] == 3 and info["packages"][0]["security"]
    assert any(p["restart"] for p in info["packages"])
    assert client.post("/api/os-update/install").status_code == 200
    assert client.post("/api/os-update/install").status_code == 400       # already running
    for _ in range(100):
        info = client.get("/api/os-update").json()
        if info["progress"]["state"] != "running":
            break
        time.sleep(0.1)
    assert info["progress"]["state"] == "success" and not info["packages"] and info["restart_needed"]
    auto = client.put("/api/os-update/auto", json={"mode": "all", "restart": True, "restart_time": "04:00"}).json()["auto"]
    assert auto == {"mode": "all", "restart": True, "restart_time": "04:00", "interval_hours": 24}
    assert client.put("/api/os-update/auto", json={"mode": "everything"}).status_code == 400
    assert client.put("/api/os-update/auto", json={"restart_time": "25:00"}).status_code == 400
    msgs = [a["message"] for a in client.get("/api/activity", params={"category": "updates"}).json()["items"]]
    assert any("Installed 8 operating system update(s)" in m for m in msgs)
    assert any("Automatic updates: all updates" in m for m in msgs)


def test_apt_parsing():
    from talon.osupdate import parse_simulation, parse_status
    pk = parse_simulation("Inst apt [2.8.3] (2.8.4ubuntu0.1 Ubuntu:24.04/noble-updates, Ubuntu:24.04/noble-security [amd64])\n"
                          "Inst newpkg (1.0 Debian:13/stable [all])\nConf apt (2.8.4)")
    assert [(p["name"], p["old"], p["new"], p["security"]) for p in pk] == [("apt", "2.8.3", "2.8.4ubuntu0.1", True), ("newpkg", "", "1.0", False)]
    assert parse_status("pmstatus:libc6:amd64:40.0:Installing libc6:amd64") == {
        "phase": "install", "package": "libc6", "percent": 40.0, "text": "Installing libc6:amd64"}
    assert parse_status("random text") is None


def test_date_and_time_format(client):
    s = client.get("/api/settings").json()
    assert (s["date_format"], s["time_format"]) == ("dd-mm-yyyy", "24h")
    s = client.put("/api/settings", json={"date_format": "mm/dd/yyyy", "time_format": "12h"}).json()
    assert (s["date_format"], s["time_format"]) == ("mm/dd/yyyy", "12h")
    assert client.put("/api/settings", json={"date_format": "yyyy/dd/mm"}).status_code == 400
    from talon.util import date_pattern
    assert date_pattern(s, True) == "%m/%d/%Y %I:%M %p" and date_pattern({}) == "%d-%m-%Y"


def test_disk_write_measuring(tmp_path):
    import types
    from talon.ramlog import RamLog, logger_bytes
    proc = tmp_path / "proc"
    for pid, comm, wb in ((10, "systemd-journal", 4096), (11, "rsyslogd", 1024), (12, "bash", 999999)):
        (proc / str(pid)).mkdir(parents=True)
        (proc / str(pid) / "comm").write_text(comm + "\n")
        (proc / str(pid) / "io").write_text(f"rchar: 1\nwrite_bytes: {wb}\n")
    assert logger_bytes(str(proc)) == {10: 4096, 11: 1024}

    class St:
        d = {}
        def get(self, k): return self.d.get(k)
        def update(self, f): f(self.d)
    r = RamLog(St())
    import time
    hour = int(time.time() // 3600 * 3600)
    r._hours = {hour - i * 3600: [100 * 2 ** 20, 1000, 40 * 2 ** 20] for i in range(24)}
    m = r.measured()
    assert m["disk_bytes"] == 2400 * 2 ** 20 and m["log_bytes"] == 960 * 2 ** 20 and m["log_ops"] == 9600


def test_alerts_have_action_and_since(client):
    nas = client.app.state.nas
    info = client.get("/api/thresholds").json()
    client.put("/api/thresholds", json={**info["values"], "temp_hdd": 30, "temp_ssd": 30, "temp_nvme": 30})
    first = nas.alerts()
    if first:
        assert all(a["action"] and a["since"] for a in first)
        assert [a["since"] for a in nas.alerts()] == [a["since"] for a in first]   # kept while it lasts


def test_jobs_report_their_steps(client):
    """Storage jobs declare their steps, so the web interface shows a progress bar instead of a terminal."""
    j = wait_job(client, client.post("/api/disks/sdd/wipe").json())
    assert j["status"] == "success"
    steps = [l for l in j["log"] if l.startswith("STEPS ")]
    assert len(steps) == 1 and json.loads(steps[0][6:])[0] == "Stopping anything that uses the disk"
    assert [l for l in j["log"] if l.startswith("STEP ")][-1].startswith("STEP 3")
