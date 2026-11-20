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
    assert disks["sda"]["status"] == "volume" and disks["sda"]["volume"] == "tank"
    assert disks["sde"]["status"] == "volume"
    assert disks["sdd"]["status"] == "available" and disks["sdd"]["selectable"]
    assert disks["sdg"]["status"] == "has_data" and disks["sdg"]["selectable"]


def test_raid_options_endpoint(client):
    opts = client.post("/api/volumes/options", json={"disks": ["sdd", "sdf"], "spares": 0}).json()
    avail = {o["id"] for o in opts if o["available"]}
    assert avail == {"raid0", "raid1"}


def test_volume_lifecycle(client):
    r = client.post("/api/volumes", json={"name": "fast", "level": "raid1",
                                          "disks": ["sdd", "sdf"], "fs": "xfs"})
    assert r.status_code == 200, r.text
    assert wait_job(client, r.json())["status"] == "success"
    vols = {v["name"]: v for v in client.get("/api/volumes").json()}
    assert vols["fast"]["level"] == "raid1" and vols["fast"]["mounted"]
    assert len(vols["fast"]["members"]) == 2
    # in-use disks cannot be reused
    r = client.post("/api/volumes", json={"name": "x", "level": "single", "disks": ["sdd"]})
    assert r.status_code == 400
    # share blocks deletion
    s = client.post("/api/shares", json={"name": "Fast", "volume": "fast",
                                         "users": {"alice": "rw"}, "smb": {"enabled": True}})
    assert s.status_code == 200, s.text
    assert client.delete("/api/volumes/fast").status_code == 400
    assert client.delete("/api/shares/Fast").status_code == 200
    r = client.delete("/api/volumes/fast")
    assert wait_job(client, r.json())["status"] == "success"
    disks = {d["name"]: d for d in client.get("/api/disks").json()}
    assert disks["sdd"]["status"] == "available"


def test_invalid_volume_requests(client):
    for body in [
        {"name": "Bad Name", "level": "raid1", "disks": ["sdd", "sdf"]},
        {"name": "v", "level": "raid5", "disks": ["sdd", "sdf"]},
        {"name": "v", "level": "raid1", "disks": ["nvme0n1", "sdd"]},
        {"name": "v", "level": "raid1", "disks": ["sdd", "sdf"], "fs": "btrfs"},
        {"name": "tank", "level": "raid1", "disks": ["sdd", "sdf"]},
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


def test_expand_and_replace(client):
    r = client.post("/api/volumes/tank/disks", json={"disk": "sdd", "mode": "spare"})
    assert wait_job(client, r.json())["status"] == "success"
    tank = next(v for v in client.get("/api/volumes").json() if v["name"] == "tank")
    assert any(m["state"] == "spare" for m in tank["members"])
    part = next(m["part"] for m in tank["members"] if m["state"] == "spare")
    r = client.delete(f"/api/volumes/tank/members/{part}")
    assert wait_job(client, r.json())["status"] == "success"
    # removing an active member of a RAID5 is allowed once (fault tolerance 1)
    r = client.delete("/api/volumes/tank/members/sda1")
    assert wait_job(client, r.json())["status"] == "success"
    tank = next(v for v in client.get("/api/volumes").json() if v["name"] == "tank")
    assert tank["status"] == "degraded"
    assert client.delete("/api/volumes/tank/members/sdb1").status_code == 400
    r = client.post("/api/volumes/tank/disks", json={"disk": "sdd", "mode": "replace"})
    assert wait_job(client, r.json())["status"] == "success"
    tank = next(v for v in client.get("/api/volumes").json() if v["name"] == "tank")
    assert tank["status"] == "rebuilding"


def test_dashboard_and_settings(client):
    d = client.get("/api/dashboard").json()
    assert d["info"]["hostname"] and "volumes" in d
    r = client.put("/api/settings", json={"workgroup": "home", "hostname": "mynas"})
    assert r.status_code == 200 and r.json()["workgroup"] == "HOME"
    assert client.put("/api/settings", json={"hostname": "-bad-"}).status_code == 400
    assert client.get("/api/activity").json()
