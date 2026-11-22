import base64


def _auth(user="admin", pw="talon"):
    return {"Authorization": "Basic " + base64.b64encode(f"{user}:{pw}".encode()).decode()}


def test_webdav_off_by_default_then_files_round_trip(client):
    assert client.request("PROPFIND", "/dav/", headers=_auth()).status_code == 404
    assert client.post("/api/services/webdav/enable").status_code == 200
    assert client.request("PROPFIND", "/dav/").status_code == 401
    assert client.request("PROPFIND", "/dav/", headers=_auth(pw="wrong")).status_code == 401
    r = client.request("PROPFIND", "/dav/", headers={**_auth(), "Depth": "1"})
    assert r.status_code == 207 and "<d:href>/dav/Documents/</d:href>" in r.text
    h = _auth()
    assert client.request("MKCOL", "/dav/Documents/Camera Roll", headers=h).status_code == 201
    assert client.request("MKCOL", "/dav/Documents/Camera Roll", headers=h).status_code == 405
    assert client.put("/dav/Documents/Camera Roll/IMG_1.jpg", content=b"x" * 1000, headers=h).status_code == 201
    assert client.put("/dav/Documents/Camera Roll/IMG_1.jpg", content=b"y" * 10, headers=h).status_code == 204
    assert client.put("/dav/Documents/missing/IMG.jpg", content=b"x", headers=h).status_code == 409
    g = client.get("/dav/Documents/Camera Roll/IMG_1.jpg", headers=h)
    assert g.status_code == 200 and g.content == b"y" * 10
    part = client.get("/dav/Documents/Camera Roll/IMG_1.jpg", headers={**h, "Range": "bytes=2-4"})
    assert part.status_code == 206 and part.content == b"yyy"
    r = client.request("PROPFIND", "/dav/Documents/Camera%20Roll/", headers={**h, "Depth": "1"})
    assert "IMG_1.jpg" in r.text and "<d:getcontentlength>10</d:getcontentlength>" in r.text
    mv = client.request("MOVE", "/dav/Documents/Camera Roll/IMG_1.jpg",
                        headers={**h, "Destination": "https://nas/dav/Documents/Camera%20Roll/IMG_2.jpg"})
    assert mv.status_code == 201
    assert client.get("/dav/Documents/Camera Roll/IMG_1.jpg", headers=h).status_code == 404
    assert client.request("DELETE", "/dav/Documents/Camera Roll/IMG_2.jpg", headers=h).status_code == 204
    assert client.request("LOCK", "/dav/Documents/new.txt", headers=h).status_code == 200
    assert client.request("OPTIONS", "/dav/").headers["DAV"] == "1, 2"


def test_webdav_respects_share_permissions(client):
    client.post("/api/services/webdav/enable")
    assert client.post("/api/users", json={"name": "zoe", "password": "longenough1"}).status_code == 200
    shares = {s["name"]: s for s in client.get("/api/shares").json()}
    doc = shares["Documents"]
    doc["groups"] = {}
    doc["users"] = {"zoe": "ro"}
    assert client.put("/api/shares/Documents", json=doc).status_code == 200
    z = _auth("zoe", "longenough1")
    listing = client.request("PROPFIND", "/dav/", headers={**z, "Depth": "1"}).text
    assert "/dav/Documents/" in listing
    assert client.put("/dav/Documents/x.txt", content=b"x", headers=z).status_code == 403
    assert client.request("PROPFIND", "/dav/Documents/%2e%2e/%2e%2e/etc", headers=z).status_code == 400
    assert client.request("PROPFIND", "/dav/Documents/.recycle", headers=z).status_code == 404
