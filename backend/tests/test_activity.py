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
