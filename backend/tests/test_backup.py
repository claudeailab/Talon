import time


def _wait(client, tid):
    for _ in range(200):
        t = next(t for t in client.get("/api/backup").json()["tasks"] if t["id"] == tid)
        if t["progress"]["state"] != "running":
            return t
        time.sleep(0.1)
    raise AssertionError("timeout")


def test_usb_backup_task(client):
    info = client.get("/api/backup").json()
    disks = {d["dev"]: d for d in info["disks"]}
    assert disks["sdj1"]["versions"] and not disks["sdg1"]["versions"]       # ext4 vs exFAT
    assert (disks["sdj1"]["media"], disks["sdk1"]["media"]) == ("USB disk", "SATA hard disk")
    body = {"name": "Weekly copy", "disk_uuid": disks["sdj1"]["uuid"], "sources": [{"volume": "tank", "folders": ["Documents"]}], "when": "plug",
            "time": "02:00", "eject": True, "keep_days": 30, "run_now": True}
    assert client.post("/api/backup", json={**body, "keep_days": 3}).status_code == 400
    t = client.post("/api/backup", json=body).json()
    done = _wait(client, t["id"])
    assert done["progress"]["state"] == "success" and done["last"]["ok"] and len(done["snapshots"]) == 6
    assert 0 < done["usage"]["used"] < done["usage"]["total"]                  # how full the backup disk is
    assert client.put(f"/api/backup/{t['id']}", json={"when": "daily", "time": "03:30"}).json()["when"] == "daily"
    acts = [a["message"] for a in client.get("/api/activity", params={"category": "backup"}).json()["items"]]
    assert any("completed" in m for m in acts)
    assert client.delete(f"/api/backup/{t['id']}").status_code == 200
    assert client.get("/api/backup").json()["tasks"] == []


def test_versions_to_prune():
    from talon.backup import to_prune, snapshot_name
    now = time.time()
    vs = [{"name": snapshot_name(now - d * 86400), "at": now - d * 86400} for d in (0, 5, 40, 100)] + [{"name": "Current", "at": None}]
    old = to_prune(vs, 30, now)
    assert sorted(old) == sorted([snapshot_name(now - 40 * 86400), snapshot_name(now - 100 * 86400)])
    assert to_prune([{"name": "x", "at": now - 400 * 86400}], 30, now) == []          # the newest stays


def test_version_names_follow_the_date_format(tmp_path):
    from talon.backup import MARKER, list_versions, snapshot_name
    ts = time.mktime((2026, 6, 5, 14, 7, 0, 0, 0, -1))
    assert snapshot_name(ts) == "05-06-2026_1407"
    assert snapshot_name(ts, {"date_format": "mm/dd/yyyy"}) == "06-05-2026_1407"            # no "/" in a name
    assert snapshot_name(ts, {"date_format": "yyyy-mm-dd", "time_format": "12h"}) == "2026-06-05_0207PM"
    # the order comes from the marker, not the name; older names still count; .partial and other folders do not
    for name, at in (("05-06-2026_1407", ts), ("06-05-2026_0900", ts - 86400 * 40)):
        (tmp_path / name).mkdir()
        (tmp_path / name / MARKER).write_text(f"{at}\n")
    for name in ("2026-04-01_1000", "Current", "07-06-2026_1000.partial", "Photos"):
        (tmp_path / name).mkdir()
    assert [v["name"] for v in list_versions(str(tmp_path))] == ["05-06-2026_1407", "06-05-2026_0900", "2026-04-01_1000", "Current"]


def test_backup_log(client):
    disk = next(d for d in client.get("/api/backup").json()["disks"] if d["versions"])
    body = {"name": "Logged", "disk_uuid": disk["uuid"], "sources": [{"volume": "tank", "folders": ["Documents"]}], "when": "plug",
            "time": "02:00", "eject": False, "keep_days": 30, "run_now": True}
    t = client.post("/api/backup", json=body).json()
    _wait(client, t["id"])
    lines = client.get(f"/api/backup/{t['id']}/log").json()
    assert lines[0].split("\t")[3].startswith("Backup started")
    assert any(ln.split("\t")[1:3] == ["INFO", "tank/Documents/Example 1.txt"] for ln in lines)
    assert lines[-1].split("\t")[1] == "SUCCESS"
    assert client.get("/api/backup/nope/log").status_code == 400


def test_backup_prepares_an_empty_disk(client):
    """New backup offers empty disks too; choosing one formats it as ext4, then the first backup runs."""
    info = client.get("/api/backup").json()
    prep = {b["disk"]: b for b in info["prepare"]}
    assert prep["sdd"]["state"] == "Empty" and "sda" not in prep and "nvme0n1" not in prep   # RAID and system disks are not offered
    assert client.post("/api/backup", json={"name": "x", "prepare_disk": "sda", "when": "plug", "time": "02:00", "keep_days": 30}).status_code == 400
    t = client.post("/api/backup", json={"name": "SSD copy", "prepare_disk": "sdd", "sources": [{"volume": "tank", "folders": ["Documents"]}], "when": "plug",
                                         "time": "02:00", "eject": False, "keep_days": 30, "run_now": True}).json()
    done = None
    for _ in range(300):
        done = next(x for x in client.get("/api/backup").json()["tasks"] if x["id"] == t["id"])
        if done["last"]:
            break
        time.sleep(0.1)
    assert done["last"]["ok"] and done["connected"] and done["disk"]["fstype"] == "ext4" and done["versions"]
    info = client.get("/api/backup").json()
    assert "sdd" not in {b["disk"] for b in info["prepare"]} and any(d["dev"] == "sdd1" for d in info["disks"])


def test_backup_sources_are_volumes_and_folders(client):
    """A backup copies whole volumes or folders on them; old tasks made from shared folders still work."""
    info = client.get("/api/backup").json()
    src = {v["volume"]: v for v in info["sources"]}
    assert {"tank", "backup"} <= set(src) and "Documents" in {f["name"] for f in src["tank"]["folders"]}
    disks = {d["dev"]: d for d in info["disks"]}
    base = {"name": "Whole tank", "disk_uuid": disks["sdj1"]["uuid"], "when": "plug", "time": "02:00", "eject": False, "keep_days": 30}
    assert client.post("/api/backup", json={**base, "sources": []}).status_code == 400
    assert client.post("/api/backup", json={**base, "sources": [{"volume": "nope", "folders": []}]}).status_code == 400
    assert client.post("/api/backup", json={**base, "sources": [{"volume": "tank", "folders": ["Nope"]}]}).status_code == 400
    t = client.post("/api/backup", json={**base, "sources": [{"volume": "tank", "folders": []}], "run_now": True}).json()
    done = _wait(client, t["id"])
    assert done["progress"]["state"] == "success" and done["sources"] == [{"volume": "tank", "folders": []}]
    # a task saved before this change (shared folders) is read as the shared folders' volume and folders
    nas = client.app.state.nas
    nas.state.update(lambda d: d["usb_backup"][t["id"]].update(shares=["Documents"]) or d["usb_backup"][t["id"]].pop("sources"))
    old = next(x for x in client.get("/api/backup").json()["tasks"] if x["id"] == t["id"])
    assert old["sources"] == [{"volume": "tank", "folders": ["Documents"]}]
    assert client.post(f"/api/backup/{t['id']}/run").status_code == 200
    assert _wait(client, t["id"])["progress"]["state"] == "success"
