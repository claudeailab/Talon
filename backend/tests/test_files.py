import io
import os
import zipfile


def ls(client, path="", volume="tank"):
    r = client.get("/api/files", params={"volume": volume, "path": path})
    assert r.status_code == 200, r.text
    return {i["name"]: i for i in r.json()["items"]}


def test_browse_and_change_files(client):
    root = ls(client)
    assert root["Media"]["folder"] and root["Media"]["count"] >= 1
    photos = ls(client, "Media/Photos")
    assert list(photos)[:2] == ["2025", "2026"]                    # folders first
    assert photos["Beach sunset.jpg"]["size"] == 4_200_000

    assert client.post("/api/files/folder", json={"volume": "tank", "path": "Media", "name": "Video"}).json()["path"] == "Media/Video"
    assert client.post("/api/files/folder", json={"volume": "tank", "path": "Media", "name": "Video"}).status_code == 400

    up = client.put("/api/files/upload", params={"volume": "tank", "path": "Media/Video", "name": "clip.mp4"},
                    content=b"x" * 5000)
    assert up.status_code == 200 and up.json()["size"] == 5000
    assert client.put("/api/files/upload", params={"volume": "tank", "path": "Media/Video", "name": "clip.mp4"},
                      content=b"y").status_code == 400                # exists
    assert client.put("/api/files/upload", params={"volume": "tank", "path": "Media/Video", "name": "clip.mp4",
                                                   "overwrite": "true"}, content=b"y").json()["size"] == 1

    r = client.post("/api/files/rename", json={"volume": "tank", "path": "Media/Video/clip.mp4", "name": "holiday.mp4"})
    assert r.json()["path"] == "Media/Video/holiday.mp4"
    m = client.post("/api/files/move", json={"volume": "tank", "items": ["Media/Video/holiday.mp4"], "dest": "Documents"})
    assert m.json()["moved"] == 1 and "holiday.mp4" in ls(client, "Documents")
    assert client.post("/api/files/move", json={"volume": "tank", "items": ["Media"], "dest": "Media/Video"}).status_code == 400

    one = client.get("/api/files/download", params={"volume": "tank", "item": "Documents/holiday.mp4"})
    assert one.status_code == 200 and one.content == b"y" and "attachment" in one.headers["content-disposition"]
    z = client.get("/api/files/download", params=[("volume", "tank"), ("item", "Media/Photos/2025"),
                                                  ("item", "Documents/holiday.mp4")])
    assert "tank.zip" in z.headers["content-disposition"]
    z2 = client.get("/api/files/download", params=[("volume", "tank"), ("item", "Media/Photos/2025"),
                                                   ("item", "Media/Photos/2026")])
    assert "Photos.zip" in z2.headers["content-disposition"]
    names = zipfile.ZipFile(io.BytesIO(z.content)).namelist()
    assert "2025/Lake.jpg" in names and "holiday.mp4" in names

    d = client.post("/api/files/delete", json={"volume": "tank", "items": ["Documents/holiday.mp4", "Media/Video"]})
    assert d.json()["deleted"] == 2 and "Video" not in ls(client, "Media")


def test_paths_cannot_leave_the_volume(client):
    bad_paths = ["..", "../backup", "Media/../../etc", "/etc", "Media/../.."]
    for p in bad_paths:
        r = client.get("/api/files", params={"volume": "tank", "path": p})
        assert r.status_code == 400, p
    for name in ["..", "a/b", ".hidden", ""]:
        assert client.post("/api/files/folder", json={"volume": "tank", "path": "", "name": name}).status_code == 400
    assert client.post("/api/files/delete", json={"volume": "tank", "items": [""]}).status_code == 400
    assert client.post("/api/files/rename", json={"volume": "tank", "path": "", "name": "x"}).status_code == 400
    # a symlink pointing outside the volume is neither listed nor usable
    fb = client.app.state.nas.files
    root, _ = fb.resolve("tank", "")
    os.symlink("/etc", os.path.join(root, "escape"))
    assert "escape" not in ls(client)
    assert client.get("/api/files", params={"volume": "tank", "path": "escape"}).status_code == 400
    assert client.get("/api/files", params={"volume": "nope"}).status_code == 400


def test_locations_external_disk_and_onedrive(client):
    locs = {l["id"]: l for l in client.get("/api/files/locations").json()}
    assert locs["tank"]["kind"] == "volume" and locs["backup"]["kind"] == "volume"
    usb = locs["ext:sdg1"]
    assert usb["kind"] == "usb" and usb["detail"] == "sdg1 · exFAT" and not usb["mounted"]
    assert "cloud:onedrive" not in locs                         # OneDrive is not connected yet

    files = ls(client, volume="ext:sdg1")                        # opening it mounts it
    assert files["Holiday 2025"]["folder"] and "Notes.txt" in files
    assert client.put("/api/files/upload", params={"volume": "ext:sdg1", "name": "new.txt"},
                      content=b"hi").status_code == 200
    # moving between a volume and the USB disk works (both are local)
    assert client.post("/api/files/move", json={"volume": "ext:sdg1", "items": ["new.txt"],
                                                "dest_volume": "tank", "dest": "Documents"}).status_code == 200
    assert "new.txt" in ls(client, "Documents")
    assert {l["id"]: l for l in client.get("/api/files/locations").json()}["ext:sdg1"]["mounted"]
    assert client.post("/api/files/eject", json={"volume": "ext:sdg1"}).status_code == 200
    assert not {l["id"]: l for l in client.get("/api/files/locations").json()}["ext:sdg1"]["mounted"]

    # connect OneDrive (demo): it appears as a location
    client.put("/api/settings/entra", json={"tenant": "common", "client_id": "11111111-2222-3333-4444-555555555555",
                                            "client_secret": "s"})
    client.post("/api/services/onedrive/enable")
    url = client.post("/api/onedrive/connect", json={"origin": "https://nas"}).json()["url"]
    client.get(url.replace("https://nas", ""))
    locs = {l["id"]: l for l in client.get("/api/files/locations").json()}
    assert locs["cloud:onedrive"]["name"] == "OneDrive"
    assert "Documents" in ls(client, volume="cloud:onedrive")
    r = client.post("/api/files/move", json={"volume": "cloud:onedrive", "items": ["Notes.txt"],
                                             "dest_volume": "tank", "dest": ""})
    assert r.status_code == 400 and "OneDrive" in r.json()["detail"]


# ---------------------------------------------------------------- OneDrive over Microsoft Graph (faked)
def test_onedrive_files_requests(tmp_path):
    from talon.odfiles import OneDriveFiles, PIECE
    calls = []

    class Fake(OneDriveFiles):
        def _call(self, method, url, body=None, data=None, headers=None, auth=True, timeout=60):
            calls.append((method, url, body, len(data) if data else 0, dict(headers or {}), auth))
            if url.startswith("/me/drive/root/children?"):
                return 200, {"value": [{"name": "b.txt", "file": {}, "size": 5, "lastModifiedDateTime": "2026-11-20T10:00:00Z"},
                                       {"name": "A", "folder": {"childCount": 2}}],
                             "@odata.nextLink": "https://graph.microsoft.com/v1.0/next"}
            if url.endswith("/next"):
                return 200, {"value": [{"name": "c", "folder": {"childCount": 0}}]}
            if "createUploadSession" in url:
                return 200, {"uploadUrl": "https://upload.example/session"}
            if url == "https://upload.example/session":
                return 202, {}
            if url.endswith("?$select=id"):
                return 404, {"error": {"code": "itemNotFound"}}
            if "?$select=id,name,folder,file,size" in url:
                return 200, {"id": "DEST", "folder": {}}
            if method == "DELETE":
                return 204, {}
            return 200, {}

    od = Fake(lambda: "token")
    items = od.list("")
    assert [i["name"] for i in items] == ["A", "c", "b.txt"] and items[0]["count"] == 2
    od.mkdir("Work", "New")
    assert calls[-1][:3] == ("POST", "/me/drive/root:/Work:/children",
                             {"name": "New", "folder": {}, "@microsoft.graph.conflictBehavior": "fail"})
    od.rename("Work/a b.txt", "c.txt")
    assert calls[-1][:3] == ("PATCH", "/me/drive/root:/Work/a%20b.txt:", {"name": "c.txt"})
    od.move("Work/c.txt", "Archive")
    assert calls[-1][2]["parentReference"] == {"id": "DEST"}
    od.delete("Work/c.txt")
    assert calls[-1][:2] == ("DELETE", "/me/drive/root:/Work/c.txt:")

    small = tmp_path / "small.bin"
    small.write_bytes(b"x" * 1000)
    od.upload("Work", "small.bin", str(small), overwrite=False)
    assert calls[-1][:2] == ("PUT", "/me/drive/root:/Work/small.bin:/content") and calls[-1][5]

    big = tmp_path / "big.bin"
    big.write_bytes(b"y" * (PIECE + 1000))
    calls.clear()
    od.upload("Work", "big.bin", str(big), overwrite=True)
    pieces = [c for c in calls if c[1] == "https://upload.example/session"]
    assert [c[4]["Content-Range"] for c in pieces] == [f"bytes 0-{PIECE - 1}/{PIECE + 1000}",
                                                      f"bytes {PIECE}-{PIECE + 999}/{PIECE + 1000}"]
    assert all(not c[5] for c in pieces)                       # no Authorization on the upload URL
    assert PIECE % (320 * 1024) == 0
