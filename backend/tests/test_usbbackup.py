import time


def _wait(client, tid):
    for _ in range(200):
        t = next(t for t in client.get("/api/usb-backup").json()["tasks"] if t["id"] == tid)
        if t["progress"]["state"] != "running":
            return t
        time.sleep(0.1)
    raise AssertionError("timeout")


def test_usb_backup_task(client):
    info = client.get("/api/usb-backup").json()
    disks = {d["dev"]: d for d in info["disks"]}
    assert disks["sdj1"]["versions"] and not disks["sdg1"]["versions"]       # ext4 vs exFAT
    body = {"name": "Weekly copy", "disk_uuid": disks["sdj1"]["uuid"], "shares": ["Documents"], "when": "plug",
            "time": "02:00", "eject": True, "keep_days": 30, "run_now": True}
    assert client.post("/api/usb-backup", json={**body, "keep_days": 3}).status_code == 400
    t = client.post("/api/usb-backup", json=body).json()
    done = _wait(client, t["id"])
    assert done["progress"]["state"] == "success" and done["last"]["ok"] and len(done["snapshots"]) == 6
    assert client.put(f"/api/usb-backup/{t['id']}", json={"when": "daily", "time": "03:30"}).json()["when"] == "daily"
    acts = [a["message"] for a in client.get("/api/activity", params={"category": "backup"}).json()["items"]]
    assert any("completed" in m for m in acts)
    assert client.delete(f"/api/usb-backup/{t['id']}").status_code == 200
    assert client.get("/api/usb-backup").json()["tasks"] == []


def test_versions_to_prune():
    from talon.usbbackup import to_prune, snapshot_name
    now = time.time()
    names = [snapshot_name(now - d * 86400) for d in (0, 5, 40, 100)] + ["Current", "x.partial"]
    old = to_prune(names, 30, now)
    assert sorted(old) == sorted([snapshot_name(now - 40 * 86400), snapshot_name(now - 100 * 86400)])
    assert to_prune([snapshot_name(now - 400 * 86400)], 30, now) == []          # the newest stays
