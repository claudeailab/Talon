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
