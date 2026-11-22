import time

from conftest import wait_job


def _wait_scan(client):
    for _ in range(200):
        info = client.get("/api/antivirus").json()
        if info["progress"]["state"] != "running":
            return info
        time.sleep(0.1)
    raise AssertionError("scan timeout")


def test_install_scan_quarantine(client):
    info = client.get("/api/antivirus").json()
    assert not info["installed"] and info["ram_ok"]
    assert client.post("/api/antivirus/scan").status_code == 400          # not installed
    job = client.post("/api/antivirus/install").json()
    assert wait_job(client, job)["status"] == "success"
    assert client.get("/api/antivirus").json()["installed"]
    assert client.post("/api/antivirus/scan", json={}).status_code == 200
    info = _wait_scan(client)
    assert info["progress"]["state"] == "success" and info["last_scan"]["found"] == 1
    q = info["quarantine"]
    assert len(q) == 1 and q[0]["virus"].startswith("Win.Trojan")
    acts = [a["message"] for a in client.get("/api/activity", params={"category": "antivirus"}).json()["items"]]
    assert any("found 1 infected" in m for m in acts)
    info = client.delete(f"/api/antivirus/quarantine/{q[0]['id']}").json()
    assert info["quarantine"] == []


def test_settings_and_version_parsing(client):
    r = client.put("/api/antivirus/settings", json={"schedule": "weekly", "time": "03:15", "weekday": 6, "shares": ["nope"]}).json()
    assert r["settings"] == {"shares": [], "schedule": "weekly", "time": "03:15", "weekday": 6}
    assert client.put("/api/antivirus/settings", json={"schedule": "hourly"}).status_code == 400
    from talon.antivirus import parse_version
    v = parse_version("ClamAV 1.4.3/27831/Sat Nov 21 09:30:00 2026")
    assert v["version"] == "1.4.3" and v["db_version"] == "27831" and v["db_date"]
    assert parse_version("ClamAV 1.4.3")["version"] == "1.4.3"
