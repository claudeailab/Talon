"""The activity log: categories, filters, search, and every change is logged."""
from talon.activity import categorize


def test_categories_of_background_messages():
    assert categorize("OneDrive task Photos: run started") == "onedrive"
    assert categorize("Scheduled task Backup finished in 2 min") == "scheduled"
    assert categorize("Create RAID tank completed") == "storage"
    assert categorize("Notification sent: Disk sda is hot") == "alerts"
    assert categorize("Signed in from 1.2.3.4") == "signin"
    assert categorize("Talon 1.2.0 started") == "updates" or categorize("Talon 1.2.0 started") == "system"


def test_filters_and_search(client):
    st = client.app.state.nas.state
    st.log_activity("admin", "Created volume media", "info", "storage")
    st.log_activity("admin", "Scheduled task Backup failed (exit 3)", "error", "scheduled")
    st.log_activity("alice", "Renamed tank/a.txt to b.txt", "info", "files")
    a = client.get("/api/activity", params={"category": "scheduled"}).json()
    assert [i["message"] for i in a["items"]] == ["Scheduled task Backup failed (exit 3)"]
    assert any(c["id"] == "storage" for c in a["categories"])
    assert client.get("/api/activity", params={"level": "error"}).json()["items"][0]["category"] == "scheduled"
    found = client.get("/api/activity", params={"q": "renamed b.txt"}).json()["items"]
    assert len(found) == 1 and found[0]["user"] == "alice"
    assert client.get("/api/activity", params={"q": "alice"}).json()["total"] >= 1        # by user too
    both = client.get("/api/activity", params={"category": "storage,files"}).json()
    assert {i["category"] for i in both["items"]} <= {"storage", "files"} and both["total"] >= 2


def test_every_change_is_logged(client):
    before = client.get("/api/activity").json()["total"]
    # an endpoint that does not log in its own words gets a generic entry, with its category
    assert client.post("/api/update/check").status_code == 200
    top = client.get("/api/activity").json()["items"][0]
    assert top["message"] == "Checked for updates" and top["category"] == "updates"
    # an endpoint that logs itself is not logged twice
    client.post("/api/files/folder", json={"volume": "tank", "path": "", "name": "Logged"})
    items = client.get("/api/activity").json()["items"]
    assert items[0]["message"].startswith("Created folder") and items[0]["category"] == "files"
    assert not items[1]["message"].startswith("Created folder")
    assert client.get("/api/activity").json()["total"] == before + 2
    # a request that fails is not logged
    client.post("/api/files/folder", json={"volume": "tank", "path": "", "name": ".hidden"})
    assert client.get("/api/activity").json()["total"] == before + 2


def test_background_tasks_link_their_details_and_keep_them(client):
    import time
    nas = client.app.state.nas
    job = nas.jobs.submit("Test job", "admin", lambda log: log("step one"))
    for _ in range(50):
        if job.status in ("success", "error"):
            break
        time.sleep(0.1)
    time.sleep(0.2)
    items = client.get("/api/activity", params={"q": "Test job"}).json()["items"]
    assert [i["message"] for i in items] == ["Test job completed", "Test job started"]
    assert all(i["job"] == job.id for i in items)
    nas.jobs.jobs.clear()                              # as after a restart: read from disk
    details = client.get(f"/api/jobs/{job.id}").json()
    assert details["status"] == "success" and "step one" in details["log"]
    assert client.get("/api/jobs/zzzzzzzzzzzz").status_code == 404


def test_system_logs(client):
    r = client.get("/api/activity", params={"source": "system", "limit": 10}).json()
    assert len(r["items"]) == 10 and r["more"] and {s["id"] for s in r["sources"]} >= {"samba", "ssh", "kernel"}
    ssh = client.get("/api/activity", params={"source": "system", "system": "ssh", "limit": 50}).json()["items"]
    assert ssh and all(e["source"] == "ssh" for e in ssh)
    errs = client.get("/api/activity", params={"source": "system", "level": "error", "limit": 50}).json()["items"]
    assert errs and all(e["level"] == "error" for e in errs)
    found = client.get("/api/activity", params={"source": "system", "q": "failed password", "limit": 50}).json()["items"]
    assert found and all("Failed password" in e["message"] for e in found)


def test_journal_search_is_literal():
    from talon.syslog import _escape, _level
    assert _escape("a.b (c)") == r"a\.b \(c\)"
    assert (_level("3"), _level(4), _level("6"), _level(None)) == ("error", "warning", "info", "info")


def test_activity_everything_and_system(client):
    allp = client.get("/api/activity", params={"source": "all", "limit": 50}).json()
    kinds = {e["kind"] for e in allp["items"]}
    assert kinds == {"talon", "system"} and allp["more"]
    ts = [e["ts"] for e in allp["items"]]
    assert ts == sorted(ts, reverse=True)
    sysp = client.get("/api/activity", params={"source": "system", "system": "ssh", "limit": 20}).json()
    assert sysp["items"] and all(e["kind"] == "system" and e["source"] == "ssh" for e in sysp["items"])
    tal = client.get("/api/activity", params={"limit": 5}).json()
    assert tal["total"] is not None and all(e["kind"] == "talon" for e in tal["items"]) and tal["sources"]
