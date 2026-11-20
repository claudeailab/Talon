import os
import sys
import time

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("TALON_STATE", str(tmp_path / "state.json"))
    monkeypatch.setenv("TALON_CONFIG", str(tmp_path / "none.json"))
    from fastapi.testclient import TestClient
    from talon import config
    from talon.app import create_app
    from talon.platform import get_platform
    cfg = config.load(demo=True)
    app = create_app(cfg, get_platform(cfg))
    with TestClient(app, headers={"X-Requested-With": "talon"}) as c:
        r = c.post("/api/auth/login", json={"username": "admin", "password": "talon"})
        assert r.status_code == 200, r.text
        yield c


def wait_job(client, job, timeout=20):
    end = time.time() + timeout
    while time.time() < end:
        j = client.get(f"/api/jobs/{job['id']}").json()
        if j["status"] in ("success", "error"):
            return j
        time.sleep(0.1)
    raise AssertionError("job timeout")
