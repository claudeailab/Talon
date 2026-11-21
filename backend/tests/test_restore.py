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
