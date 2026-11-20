"""Network settings: validation, config files for netplan / ifupdown, and the
apply -> confirm or roll back flow."""
import time

import pytest

from talon import network as net
from talon.util import UserError


def static(**kw):
    base = {"iface": "eth0", "mode": "static", "address": "192.168.1.60", "subnet": "255.255.255.0",
            "gateway": "192.168.1.1", "dns": ["1.1.1.1", "", "8.8.8.8"]}
    return {**base, **kw}


def test_validate():
    assert net.validate({"iface": "eth0", "mode": "dhcp"}) == {"iface": "eth0", "mode": "dhcp"}
    c = net.validate(static())
    assert c == {"iface": "eth0", "mode": "static", "address": "192.168.1.60", "prefix": 24,
                 "gateway": "192.168.1.1", "dns": ["1.1.1.1", "8.8.8.8"]}
    assert net.validate(static(subnet="24"))["prefix"] == 24
    assert net.mask_of(22) == "255.255.252.0" and net.prefix_of("255.255.252.0") == 22
    for bad in (static(address="192.168.1.300"), static(subnet="255.0.255.0"),
                static(address="192.168.1.0"), static(address="192.168.1.255"),
                static(gateway="10.0.0.1"), static(gateway="192.168.1.60"),
                static(dns=["", " "]), static(dns=["dns.google"]), static(iface="eth0; reboot"),
                {"iface": "eth0", "mode": "other"}):
        with pytest.raises(UserError):
            net.validate(bad)


def test_netplan_file_and_key():
    y = net.netplan_yaml("eth0", net.validate(static()))
    assert "dhcp4: false" in y and "addresses: [192.168.1.60/24]" in y
    assert "via: 192.168.1.1" in y and "addresses: [1.1.1.1, 8.8.8.8]" in y
    cloud = "network:\n  version: 2\n  ethernets:\n    enp1s0:\n      dhcp4: true\n"
    assert net.netplan_key([cloud], "enp1s0") == ("enp1s0", False)
    renamed = ("network:\n  ethernets:\n    id0:\n      match:\n        macaddress: aa:bb\n"
               "      set-name: lan0\n      addresses: [10.0.0.5/24]\n")
    assert net.netplan_key([renamed], "lan0") == ("id0", True)
    assert net.netplan_key([cloud], "eth9") == ("eth9", False)


def test_ifupdown():
    text = ("source /etc/network/interfaces.d/*\n\nauto lo\niface lo inet loopback\n\n"
            "allow-hotplug eth0\niface eth0 inet dhcp\n\n# end\n")
    out = net.ifupdown_replace(text, "eth0", net.ifupdown_stanza("eth0", net.validate(static())))
    assert "iface eth0 inet static\n    address 192.168.1.60/24\n    gateway 192.168.1.1\n" in out
    assert "iface lo inet loopback" in out and "allow-hotplug eth0" in out and "# end" in out
    assert net.ifupdown_method(out, "eth0") == "static"
    back = net.ifupdown_replace(out, "eth0", net.ifupdown_stanza("eth0", {"mode": "dhcp"}))
    assert net.ifupdown_method(back, "eth0") == "dhcp" and "address 192.168.1.60" not in back
    assert net.ifupdown_replace(text, "eth1", "x") is None


class FakePlatform:
    def __init__(self):
        self.cfg = {"mode": "dhcp"}
        self.calls = []

    def net_interfaces(self):
        return [{"name": "eth0", "manager": "netplan", **self.cfg}]

    def net_apply(self, iface, cfg, log):
        old, self.cfg = self.cfg, dict(cfg)
        self.calls.append("apply")
        return {"old": old}

    def net_restore(self, iface, token, log):
        self.cfg = token["old"]
        self.calls.append("restore")


class FakeState:
    def log_activity(self, *a, **k):
        pass


def wait(cond, timeout=8):
    end = time.time() + timeout
    while time.time() < end:
        if cond():
            return True
        time.sleep(0.05)
    return False


def test_change_is_kept_when_the_nas_is_reached(monkeypatch):
    p = FakePlatform()
    n = net.Network(p, FakeState())
    n.apply(static(), "admin")
    with pytest.raises(UserError):
        n.apply(static(), "admin")                    # one change at a time
    assert wait(lambda: n._pending and n._pending["applied"])
    n._pending["applied"] -= 5
    n.seen_request("127.0.0.1")                       # local requests do not count
    assert n.info()["pending"]
    n.seen_request("192.168.1.20")
    assert n.info()["pending"] is None and p.cfg["mode"] == "static" and p.calls == ["apply"]


def test_change_is_rolled_back_when_nobody_reaches_the_nas(monkeypatch):
    monkeypatch.setattr(net, "CONFIRM_SECONDS", 1)
    p = FakePlatform()
    n = net.Network(p, FakeState())
    n.apply(static(), "admin")
    assert wait(lambda: n.info()["pending"] is None)
    assert p.calls == ["apply", "restore"] and p.cfg == {"mode": "dhcp"}


def test_network_api(client):
    info = client.get("/api/network").json()
    eth = info["interfaces"][0]
    assert eth["mode"] == "dhcp" and eth["subnet"] == "255.255.255.0" and info["pending"] is None
    assert client.put("/api/network", json=static(iface=eth["name"], gateway="10.0.0.1")).status_code == 400
    r = client.put("/api/network", json=static(iface=eth["name"]))
    assert r.status_code == 200 and r.json()["pending"]["address"] == "192.168.1.60"
    assert wait(lambda: (client.get("/api/network").json()["pending"] or {}).get("applied"))
    nas = client.app.state.nas
    nas.network._pending["applied"] -= 5
    info = client.get("/api/network").json()          # this request confirms the change
    assert client.get("/api/network").json()["pending"] is None
    assert client.get("/api/network").json()["interfaces"][0]["address"] == "192.168.1.60"


# ---------------------------------------------------------------- real platform, with commands faked
from types import SimpleNamespace

from talon.platform import real


@pytest.fixture
def fake_run(monkeypatch):
    calls = []
    outputs = {}

    def run(cmd, check=True, log=None, timeout=None, **k):
        calls.append(list(cmd))
        return SimpleNamespace(stdout=outputs.get(tuple(cmd), ""), returncode=0, stderr="")
    monkeypatch.setattr(real, "run", run)
    return calls, outputs


def platform(monkeypatch, manager, ref=None):
    p = real.RealPlatform.__new__(real.RealPlatform)
    monkeypatch.setattr(p, "_net_manager", lambda iface: (manager, ref))
    return p


def test_networkmanager_apply_and_restore(monkeypatch, fake_run):
    calls, outputs = fake_run
    con = "Wired connection 1"
    for k, v in {"ipv4.method": "auto", "ipv4.addresses": "", "ipv4.gateway": "",
                 "ipv4.dns": "", "ipv4.ignore-auto-dns": "no"}.items():
        outputs[("nmcli", "-g", k, "connection", "show", con)] = v
    p = platform(monkeypatch, "networkmanager", con)
    token = p.net_apply("eth0", net.validate(static()), print)
    mod = next(c for c in calls if c[:3] == ["nmcli", "connection", "modify"])
    assert mod == ["nmcli", "connection", "modify", con, "ipv4.method", "manual",
                   "ipv4.addresses", "192.168.1.60/24", "ipv4.gateway", "192.168.1.1",
                   "ipv4.dns", "1.1.1.1 8.8.8.8", "ipv4.ignore-auto-dns", "yes"]
    assert ["nmcli", "connection", "up", con] in calls
    calls.clear()
    p.net_restore("eth0", token, print)
    assert calls[0][4:6] == ["ipv4.method", "auto"] and calls[-1] == ["nmcli", "connection", "up", con]


def test_netplan_apply_and_restore(monkeypatch, fake_run, tmp_path):
    calls, _ = fake_run
    (tmp_path / "50-cloud-init.yaml").write_text("network:\n  version: 2\n  ethernets:\n    eth0:\n      dhcp4: true\n")
    monkeypatch.setattr(real.RealPlatform, "NETPLAN_DIR", str(tmp_path))
    p = platform(monkeypatch, "netplan")
    token = p.net_apply("eth0", net.validate(static()), print)
    own = tmp_path / "90-talon-eth0.yaml"
    assert "addresses: [192.168.1.60/24]" in own.read_text() and oct(own.stat().st_mode)[-3:] == "600"
    assert ["netplan", "generate"] in calls and ["netplan", "apply"] in calls
    p.net_restore("eth0", token, print)
    assert not own.exists()                                  # back to the system's own file
    p.net_apply("eth0", net.validate(static()), print)
    p.net_apply("eth0", {"iface": "eth0", "mode": "dhcp"}, print)
    assert not own.exists()


def test_ifupdown_apply_and_restore(monkeypatch, fake_run, tmp_path):
    calls, _ = fake_run
    ifaces = tmp_path / "interfaces"
    ifaces.write_text("auto lo\niface lo inet loopback\n\nallow-hotplug eth0\niface eth0 inet dhcp\n")
    resolv = tmp_path / "resolv.conf"
    resolv.write_text("nameserver 192.168.1.1\n")
    monkeypatch.setattr(real.RealPlatform, "RESOLV", str(resolv))
    p = platform(monkeypatch, "ifupdown", str(ifaces))
    token = p.net_apply("eth0", net.validate(static()), print)
    assert "iface eth0 inet static" in ifaces.read_text()
    assert resolv.read_text() == "nameserver 1.1.1.1\nnameserver 8.8.8.8\n"
    assert ["ifdown", "--force", "eth0"] in calls and ["ifup", "eth0"] in calls
    p.net_restore("eth0", token, print)
    assert "iface eth0 inet dhcp" in ifaces.read_text() and resolv.read_text() == "nameserver 192.168.1.1\n"
