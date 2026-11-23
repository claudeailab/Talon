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
    body = {"name": "Weekly copy", "disk_uuid": disks["sdj1"]["uuid"], "shares": ["Documents"], "when": "plug",
            "time": "02:00", "eject": True, "keep_days": 30, "run_now": True}
    assert client.post("/api/backup", json={**body, "keep_days": 3}).status_code == 400
    t = client.post("/api/backup", json=body).json()
    done = _wait(client, t["id"])
    assert done["progress"]["state"] == "success" and done["last"]["ok"] and len(done["snapshots"]) == 6
    assert client.put(f"/api/backup/{t['id']}", json={"when": "daily", "time": "03:30"}).json()["when"] == "daily"
    acts = [a["message"] for a in client.get("/api/activity", params={"category": "backup"}).json()["items"]]
    assert any("completed" in m for m in acts)
    assert client.delete(f"/api/backup/{t['id']}").status_code == 200
    assert client.get("/api/backup").json()["tasks"] == []


def test_versions_to_prune():
    from talon.backup import to_prune, snapshot_name
    now = time.time()
    names = [snapshot_name(now - d * 86400) for d in (0, 5, 40, 100)] + ["Current", "x.partial"]
    old = to_prune(names, 30, now)
    assert sorted(old) == sorted([snapshot_name(now - 40 * 86400), snapshot_name(now - 100 * 86400)])
    assert to_prune([snapshot_name(now - 400 * 86400)], 30, now) == []          # the newest stays


def test_backup_prepares_an_empty_disk(client):
    """New backup offers empty disks too; choosing one formats it as ext4, then the first backup runs."""
    info = client.get("/api/backup").json()
    prep = {b["disk"]: b for b in info["prepare"]}
    assert prep["sdd"]["state"] == "Empty" and "sda" not in prep and "nvme0n1" not in prep   # RAID and system disks are not offered
    assert client.post("/api/backup", json={"name": "x", "prepare_disk": "sda", "when": "plug", "time": "02:00", "keep_days": 30}).status_code == 400
    t = client.post("/api/backup", json={"name": "SSD copy", "prepare_disk": "sdd", "shares": ["Documents"], "when": "plug",
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
