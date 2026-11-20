"""Turning HTTPS off and on writes config.json and restarts Talon."""
import json
import time

from talon import config, webconfig
from talon.config import Config


class State:
    def __init__(self):
        self.log = []

    def log_activity(self, user, msg, *a):
        self.log.append(msg)


def test_https_off_and_on(tmp_path, monkeypatch):
    conf = tmp_path / "config.json"
    conf.write_text(json.dumps({"port": 443, "repo": "claudeailab/Talon"}))
    cert = tmp_path / "cert.pem"
    cert.write_text("x")
    monkeypatch.setattr(config, "CONFIG_PATH", str(conf))
    monkeypatch.setattr(webconfig, "_port_free", lambda p: True)
    restarts = []
    monkeypatch.setattr(webconfig.subprocess, "run", lambda cmd, **k: restarts.append(cmd))
    cfg = Config(tls_cert=str(cert))
    st = State()

    r = webconfig.set_https(cfg, False, "admin", st)
    assert r == {"https": False, "port": 80, "restarting": True}
    assert json.loads(conf.read_text()) == {"port": 80, "repo": "claudeailab/Talon", "https": False, "https_port": 443}
    time.sleep(1.8)
    assert restarts == [["systemctl", "restart", "talon"]]

    r = webconfig.set_https(cfg, True, "admin", st)
    assert r["port"] == 443 and json.loads(conf.read_text())["https"] is True
    assert json.loads(conf.read_text())["port"] == 443
    assert webconfig.set_https(cfg, True, "admin", st)["restarting"] is False   # no change


def test_port_80_in_use(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "CONFIG_PATH", str(tmp_path / "config.json"))
    monkeypatch.setattr(webconfig, "_port_free", lambda p: False)
    import pytest
    from talon.util import UserError
    with pytest.raises(UserError):
        webconfig.set_https(Config(), False, "admin", State())


def test_web_api(client):
    r = client.get("/api/settings/web").json()
    assert r["https"] is True
    r = client.put("/api/settings/web", json={"https": False}).json()
    assert r == {"https": False, "port": 80, "restarting": False}        # demo: no restart
    assert client.get("/api/settings/web").json()["https"] is False
