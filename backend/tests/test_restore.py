"""Previous versions and the recycle bin (demo sandbox)."""


def test_previous_versions_restore(client):
    vers = client.get("/api/files/versions", params={"volume": "tank", "path": "Media/Photos/Album list.xlsx"}).json()
    assert len(vers) == 2 and vers[0]["time"] > vers[1]["time"] and vers[0]["size"] == 36_000
    r = client.get("/api/files/versions/download", params={"volume": "tank", "id": vers[0]["id"]})
    assert r.status_code == 200 and len(r.content) == 36_000
    assert client.post("/api/files/versions/restore", json={
        "volume": "tank", "path": "Media/Photos/Album list.xlsx", "id": vers[0]["id"]}).status_code == 200
    items = client.get("/api/files", params={"volume": "tank", "path": "Media/Photos"}).json()["items"]
    assert next(i for i in items if i["name"] == "Album list.xlsx")["size"] == 36_000
    after = client.get("/api/files/versions", params={"volume": "tank", "path": "Media/Photos/Album list.xlsx"}).json()
    assert len(after) == 2 and 38_000 in [v["size"] for v in after]      # the replaced file is kept
    # ids outside the hidden folders are refused
    assert client.post("/api/files/versions/restore", json={
        "volume": "tank", "path": "Media/Photos/Album list.xlsx", "id": "Documents/Lease agreement.pdf"}).status_code == 400
    assert client.get("/api/files/versions/download", params={"volume": "tank", "id": "../../etc/passwd"}).status_code == 400


def test_recycle_bin(client):
    b = client.get("/api/files/bin", params={"volume": "tank"}).json()
    names = {i["name"]: i for i in b["items"]}
    assert {"Invoice 2025-12.pdf", "Old budget.xlsx", "Old harbour.jpg"} <= set(names)
    assert names["Invoice 2025-12.pdf"]["by"] == "alice" and names["Invoice 2025-12.pdf"]["was_in"] == "Documents/Invoices"
    assert names["Old harbour.jpg"]["was_in"] == "Media/Photos/2024" and names["Old harbour.jpg"]["by"]
    assert "Album list.xlsx" not in names                    # still exists: a previous version
    r = client.post("/api/files/bin/restore", json={"volume": "tank", "ids": [names["Invoice 2025-12.pdf"]["id"]]})
    assert r.json()["restored"] == 1
    files = client.get("/api/files", params={"volume": "tank", "path": "Documents/Invoices"}).json()["items"]
    assert "Invoice 2025-12.pdf" in [f["name"] for f in files]
    assert client.post("/api/files/bin/delete", json={"volume": "tank", "ids": [names["Old budget.xlsx"]["id"]]}).json()["deleted"] == 1
    left = client.get("/api/files/bin", params={"volume": "tank"}).json()["items"]
    assert "Old budget.xlsx" not in [i["name"] for i in left]
    client.post("/api/files/bin/delete", json={"volume": "tank"})                    # empty
    assert client.get("/api/files/bin", params={"volume": "tank"}).json()["items"] == []


def test_files_page_delete_goes_to_the_recycle_bin(client):
    import os
    fb = client.app.state.nas.files
    path, _root = fb.resolve("tank", "Documents/Lease agreement.pdf")
    mtime = os.stat(path).st_mtime
    r = client.post("/api/files/delete", json={"volume": "tank", "items": ["Documents/Lease agreement.pdf", "Office/Projects"]})
    assert r.json()["deleted"] == 2
    names = [i["name"] for i in client.get("/api/files", params={"volume": "tank", "path": "Documents"}).json()["items"]]
    assert "Lease agreement.pdf" not in names
    items = {i["name"]: i for i in client.get("/api/files/bin", params={"volume": "tank"}).json()["items"]}
    lease, plan = items["Lease agreement.pdf"], items["Plan.docx"]               # a folder's files too
    assert lease["was_in"] == "Documents" and plan["was_in"] == "Office/Projects" and lease["by"]
    import time
    assert time.time() - plan["deleted"] < 60                                     # not purged early
    # deleted again with the same name: kept as a second copy
    open(path, "wb").write(b"x")
    client.post("/api/files/delete", json={"volume": "tank", "items": ["Documents/Lease agreement.pdf"]})
    again = [i for i in client.get("/api/files/bin", params={"volume": "tank"}).json()["items"] if i["name"] == "Lease agreement.pdf"]
    assert len(again) == 2
    client.post("/api/files/bin/restore", json={"volume": "tank", "ids": [lease["id"]]})
    assert abs(os.stat(path).st_mtime - mtime) < 1                                # original date kept


def test_usb_and_onedrive_deletes_have_no_talon_bin(client):
    fb = client.app.state.nas.files
    assert fb.has_bin("tank") and not fb.has_bin("ext:sdg1") and not fb.has_bin("cloud:onedrive")


def test_new_shares_have_the_recycle_bin_but_not_time_machine(client):
    s = client.post("/api/shares", json={"name": "Family", "volume": "tank", "smb": {"enabled": True}}).json()
    assert s["smb"]["recycle_bin"] is True
    tm = client.post("/api/shares", json={"name": "Macs", "volume": "tank",
                                          "smb": {"enabled": True, "time_machine": True, "recycle_bin": True}}).json()
    assert tm["smb"]["recycle_bin"] is False


def test_two_way_sync_keeps_what_it_deletes(tmp_path):
    from types import SimpleNamespace
    from talon.cloudsync import CloudSync
    cs = CloudSync(SimpleNamespace(state_file=str(tmp_path / "s.json")), None, None, demo=True)
    cmd = cs.command({"id": "t", "remote": "Work", "bwlimit": "", "delete": False, "max_delete": 50,
                      "direction": "bisync"}, "c.conf", "/srv/nas/tank/Work", False)
    assert cmd[cmd.index("--backup-dir1") + 1].startswith("/srv/nas/tank/Work/.versions/")
