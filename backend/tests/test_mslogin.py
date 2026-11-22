"""Sign in to Talon with a Microsoft account (demo: Microsoft is simulated)."""
import re

GUID = "11111111-2222-3333-4444-555555555555"


def _setup(client):
    client.put("/api/settings/entra", json={"tenant": "common", "client_id": GUID, "client_secret": "s"})


def _follow(client, url):
    """Microsoft (simulated) sends the browser back to Talon's callback."""
    path = url.split("://", 1)[1].split("/", 1)[1]
    return client.get("/" + path)


def test_off_by_default_and_needs_the_entra_app(client):
    assert client.get("/api/auth/methods").json() == {"microsoft": False, "local": True}
    assert client.put("/api/settings/signin", json={"enabled": True}).status_code == 400   # no EntraID app
    _setup(client)
    assert client.put("/api/settings/signin", json={"enabled": True, "local": False}).status_code == 400  # nothing linked
    assert client.put("/api/settings/signin", json={"enabled": True}).json()["enabled"] is True
    assert client.get("/api/auth/methods").json()["microsoft"] is False                      # nothing linked yet


def test_link_then_sign_in_with_microsoft(client):
    _setup(client)
    client.put("/api/settings/signin", json={"enabled": True})
    url = client.post("/api/auth/microsoft/link", json={"origin": "https://nas.local"}).json()["url"]
    page = _follow(client, url).text
    assert "/settings?tab=entra&linked=" in page
    links = client.get("/api/settings/signin").json()["links"]
    assert links[0]["user"] == "admin" and links[0]["email"] == "alex@outlook.com"
    assert client.get("/api/auth/methods").json() == {"microsoft": True, "local": True}

    # password sign-in off: only Microsoft is offered, and the password route refuses
    assert client.put("/api/settings/signin", json={"enabled": True, "local": False}).json()["local"] is False
    assert client.get("/api/auth/methods").json() == {"microsoft": True, "local": False}
    client.post("/api/auth/logout")
    assert client.get("/api/dashboard").status_code == 401
    r = client.post("/api/auth/login", json={"username": "admin", "password": "talon"})
    assert r.status_code == 403

    # sign in with Microsoft: the session cookie is set and the page continues to Talon
    start = client.get("/api/auth/microsoft", follow_redirects=False)
    assert start.status_code == 302
    page = _follow(client, start.headers["location"])
    assert "location.replace(\"/\")" in page.text
    assert client.get("/api/dashboard").status_code == 200
    acts = client.get("/api/activity", params={"q": "with Microsoft"}).json()["items"]
    assert acts and acts[0]["user"] == "admin" and acts[0]["category"] == "signin"

    # unlinking the last account turns password sign-in back on
    s = client.delete(f"/api/settings/signin/links/{links[0]['oid']}").json()
    assert s["links"] == [] and s["local"] is True
    assert client.get("/api/auth/methods").json() == {"microsoft": False, "local": True}


def test_expired_or_unknown_state_is_refused(client):
    _setup(client)
    page = client.get("/api/onedrive/callback?code=x&state=nope").text
    assert "expired" in page.lower()


def test_recovery_command_turns_password_sign_in_back_on(tmp_path):
    from talon.mslogin import enable_local_login
    from talon.state import State
    st = State(str(tmp_path / "state.json"))
    st.update(lambda d: d.__setitem__("mslogin", {"enabled": True, "local": False, "links": [{"oid": "x"}]}))
    enable_local_login(st)
    assert State(str(tmp_path / "state.json")).get("mslogin")["local"] is True
