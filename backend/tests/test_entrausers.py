"""EntraID users and Sign in with Microsoft (demo: the directory and Microsoft are simulated)."""
TENANT = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
GUID = "11111111-2222-3333-4444-555555555555"


def _setup(client, tenant=TENANT):
    client.put("/api/settings/entra", json={"tenant": tenant, "client_id": GUID, "client_secret": "s"})


def test_needs_the_app_for_one_organization(client):
    assert client.get("/api/entra/users").json()["configured"] is False
    _setup(client, "common")                                       # personal accounts: no directory
    r = client.get("/api/entra/users").json()
    assert r["configured"] is True and r["ready"] is False         # the tab shows what to change
    assert client.get("/api/entra/directory").status_code == 400
    _setup(client)
    assert client.get("/api/entra/users").json() == {"ready": True, "configured": True, "users": []}


def test_add_users_and_give_web_access(client):
    _setup(client)
    people = client.get("/api/entra/directory").json()
    assert len(people) >= 3 and not any(p["added"] for p in people)
    assert len(client.get("/api/entra/directory", params={"q": "maria"}).json()) == 1
    ids = [people[0]["id"], people[1]["id"]]
    assert client.post("/api/entra/users", json={"ids": ids}).json()["added"] == 2
    users = client.get("/api/entra/users").json()["users"]
    assert len(users) == 2 and not any(u["web"] for u in users)
    assert client.get("/api/auth/methods").json() == {"local": True, "microsoft": False}
    u = users[0]
    assert client.put(f"/api/entra/users/{u['oid']}", json={"web": True}).json()["web"] is True
    assert client.get("/api/auth/methods").json() == {"local": True, "microsoft": True}


def test_microsoft_only_when_the_local_admin_is_disabled(client):
    _setup(client)
    people = client.get("/api/entra/directory").json()
    client.post("/api/entra/users", json={"ids": [people[0]["id"]]})
    oid = people[0]["id"]
    # the only local administrator cannot be disabled while nobody else has web access
    assert client.put("/api/users/admin", json={"disabled": True}).status_code == 400
    client.put(f"/api/entra/users/{oid}", json={"web": True})

    # sign in with Microsoft as the EntraID user, then disable the local administrator
    client.post("/api/auth/logout")
    start = client.get("/api/auth/microsoft", follow_redirects=False)
    cb = start.headers["location"].split("://", 1)[1].split("/", 1)[1]
    assert 'location.replace("/")' in client.get("/" + cb).text
    me = client.get("/api/auth/me").json()["user"]
    assert me == people[0]["upn"]
    assert client.put("/api/users/admin", json={"disabled": True}).status_code == 200
    assert client.get("/api/auth/methods").json() == {"local": False, "microsoft": True}
    # the last user with web access cannot lose it
    assert client.put(f"/api/entra/users/{oid}", json={"web": False}).status_code == 400
    assert client.delete(f"/api/entra/users/{oid}").status_code == 400
    # enabling the local administrator again brings the password form back
    assert client.put("/api/users/admin", json={"disabled": False}).status_code == 200
    assert client.get("/api/auth/methods").json() == {"local": True, "microsoft": True}
    acts = client.get("/api/activity", params={"q": "with Microsoft"}).json()["items"]
    assert acts and acts[0]["user"] == people[0]["upn"]


def test_people_without_web_access_cannot_sign_in(client):
    _setup(client)
    people = client.get("/api/entra/directory").json()
    client.post("/api/entra/users", json={"ids": [people[0]["id"], people[1]["id"]]})
    client.put(f"/api/entra/users/{people[0]['id']}", json={"web": True})
    nas = client.app.state.nas
    state = nas.entra_users.start("https://nas.local").split("state=")[1]
    nas.state.update(lambda d: d["entra_users"][people[0]["id"]].__setitem__("web", False))
    page = client.get(f"/api/onedrive/callback?code=demo&state={state}").text
    assert "login_error=" in page


def test_organization_by_email_domain(monkeypatch):
    import pytest
    from talon import entra
    from talon.util import UserError
    calls = []

    def fake(url, *a, **k):
        calls.append(url)
        if "contoso.com" in url:
            return 200, '{"issuer": "https://login.microsoftonline.com/72f988bf-86f1-41af-91ab-2d7cd011db47/v2.0"}'
        return 400, '{"error": "invalid_tenant"}'
    monkeypatch.setattr(entra, "_request", fake)
    assert entra.resolve_tenant("contoso.com") == "72f988bf-86f1-41af-91ab-2d7cd011db47"
    assert entra.resolve_tenant("me@contoso.com") == "72f988bf-86f1-41af-91ab-2d7cd011db47"
    assert entra.resolve_tenant("consumers") == "consumers" and entra.resolve_tenant(TENANT) == TENANT
    with pytest.raises(UserError):
        entra.resolve_tenant("nowhere.example")
    with pytest.raises(UserError):
        entra.resolve_tenant("not a domain")


def test_settings_need_the_tenant_id_and_detect_the_accounts(client):
    body = {"client_id": GUID, "client_secret": "s"}
    assert client.put("/api/settings/entra", json={**body, "tenant": ""}).status_code == 400
    assert client.put("/api/settings/entra", json={**body, "tenant": TENANT}).json()["tenant"] == TENANT
    assert client.app.state.nas.state.get("entra")["onedrive_authority"] == "common"   # demo: work and personal


def test_detect_onedrive_authority(monkeypatch):
    from talon import entra
    cfg = {"tenant": TENANT, "client_id": GUID}
    for allowed, want in (({"organizations", "consumers"}, "common"), ({"consumers"}, "consumers"),
                          ({"organizations"}, TENANT), (set(), TENANT)):
        monkeypatch.setattr(entra, "_allows", lambda c, a, r, allowed=allowed: a in allowed)
        assert entra.detect_onedrive_authority(cfg, "https://nas/api/onedrive/callback") == want
    assert entra.onedrive_authority({"tenant": TENANT, "onedrive_authority": "consumers"}) == "consumers"
    assert entra.onedrive_authority({"tenant": TENANT}) == TENANT


def test_old_account_types_keep_onedrive_and_fill_in_the_tenant(client):
    import base64, json
    cloud = client.app.state.nas.cloud

    def token(tid):
        return "x." + base64.urlsafe_b64encode(json.dumps({"tid": tid}).encode()).decode().rstrip("=") + ".y"
    client.app.state.nas.state.update(lambda d: (
        d.__setitem__("entra", {"tenant": "common", "client_id": GUID, "client_secret": "s"}),
        d["onedrive"].__setitem__("token", {"access_token": token(TENANT)})))
    cloud.migrate_tenant()
    e = client.app.state.nas.state.get("entra")
    assert (e["tenant"], e["onedrive_authority"]) == (TENANT, "common")
    client.app.state.nas.state.update(lambda d: (
        d.__setitem__("entra", {"tenant": "consumers", "client_id": GUID, "client_secret": "s"}),
        d["onedrive"].__setitem__("token", {"access_token": token(entra_personal())})))
    cloud.migrate_tenant()
    e = client.app.state.nas.state.get("entra")
    assert (e["tenant"], e["onedrive_authority"]) == ("consumers", "consumers")   # no tenant ID to fill in


def entra_personal():
    from talon import entra
    return entra.PERSONAL_TENANT
