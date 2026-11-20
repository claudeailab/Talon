"""IPv4 settings of the NAS: DHCP or a static address, subnet, gateway and DNS.

The platform layer applies them with whatever manages the network on this
system (NetworkManager, netplan or ifupdown). A change is only kept once the
NAS is reached again over the network: if no request arrives within
CONFIRM_SECONDS after applying, the previous settings are restored, so a wrong
address or gateway cannot lock you out.
"""
from __future__ import annotations

import ipaddress
import re
import threading
import time
from typing import Dict, List, Optional, Tuple

from .util import UserError

CONFIRM_SECONDS = 180
NAME_RE = re.compile(r"^[A-Za-z0-9_.:-]{1,15}$")


# ---------------------------------------------------------------- validation
def prefix_of(mask: str) -> int:
    """'255.255.255.0' or '24' or '/24' -> 24"""
    m = str(mask or "").strip().lstrip("/")
    if m.isdigit():
        p = int(m)
        if 1 <= p <= 32:
            return p
        raise UserError("Enter the subnet mask like 255.255.255.0")
    try:
        return ipaddress.IPv4Network(f"0.0.0.0/{m}").prefixlen
    except ValueError:
        raise UserError("Enter the subnet mask like 255.255.255.0") from None


def mask_of(prefix: int) -> str:
    return str(ipaddress.IPv4Network(f"0.0.0.0/{prefix}").netmask)


def _ip(value: str, what: str) -> str:
    try:
        return str(ipaddress.IPv4Address(str(value or "").strip()))
    except ValueError:
        raise UserError(f"Enter the {what} like 192.168.1.10") from None


def validate(data: dict) -> dict:
    iface = str(data.get("iface") or "")
    if not NAME_RE.match(iface):
        raise UserError("Choose a network interface")
    mode = data.get("mode")
    if mode == "dhcp":
        return {"iface": iface, "mode": "dhcp"}
    if mode != "static":
        raise UserError("Choose DHCP or a static address")
    address = _ip(data.get("address"), "IP address")
    prefix = prefix_of(data.get("subnet") or data.get("prefix"))
    net = ipaddress.IPv4Network(f"{address}/{prefix}", strict=False)
    addr = ipaddress.IPv4Address(address)
    if prefix < 31 and addr in (net.network_address, net.broadcast_address):
        raise UserError(f"{address} cannot be used with this subnet mask; pick another address")
    if addr.is_loopback or addr.is_multicast or addr.is_unspecified:
        raise UserError(f"{address} cannot be used as the NAS address")
    gateway = _ip(data.get("gateway"), "gateway")
    if ipaddress.IPv4Address(gateway) not in net:
        raise UserError(f"The gateway {gateway} is not in the subnet {net}")
    if gateway == address:
        raise UserError("The gateway must be another device, usually your router")
    dns = []
    for d in data.get("dns") or []:
        if str(d or "").strip():
            ip = _ip(d, "DNS server")
            if ip not in dns:
                dns.append(ip)
    if not dns:
        raise UserError("Enter at least one DNS server, for example your router's address")
    return {"iface": iface, "mode": "static", "address": address, "prefix": prefix,
            "gateway": gateway, "dns": dns[:3]}


# ---------------------------------------------------------------- config files
def netplan_yaml(key: str, cfg: dict) -> str:
    """A netplan file for one ethernet interface (it overrides the same key in
    the other files, which netplan reads in alphabetical order)."""
    lines = ["# Written by Talon (Settings > Networking).", "network:", "  version: 2",
             "  ethernets:", f"    {key}:"]
    if cfg["mode"] == "dhcp":
        lines.append("      dhcp4: true")
    else:
        lines += ["      dhcp4: false",
                  f"      addresses: [{cfg['address']}/{cfg['prefix']}]",
                  "      routes:",
                  f"        - to: default",
                  f"          via: {cfg['gateway']}",
                  "      nameservers:",
                  f"        addresses: [{', '.join(cfg['dns'])}]"]
    return "\n".join(lines) + "\n"


def netplan_key(texts: List[str], iface: str) -> Tuple[str, bool]:
    """(netplan id of the interface, whether another file gives it fixed addresses).
    Looks for `<iface>:` under ethernets, or an entry whose set-name/match name is iface."""
    for text in texts:
        lines = text.splitlines()
        for i, line in enumerate(lines):
            if not re.match(r"^\s*ethernets:\s*$", line):
                continue
            base = len(line) - len(line.lstrip())
            j = i + 1
            child = None
            while j < len(lines):
                ln = lines[j]
                if not ln.strip() or ln.lstrip().startswith("#"):
                    j += 1
                    continue
                ind = len(ln) - len(ln.lstrip())
                if ind <= base:
                    break
                if child is None:
                    child = ind
                if ind == child:
                    m = re.match(r"^\s*([^\s:#]+):\s*$", ln)
                    if m:
                        key = m.group(1).strip("'\"")
                        block = []
                        k = j + 1
                        while k < len(lines) and (not lines[k].strip() or
                                                  len(lines[k]) - len(lines[k].lstrip()) > ind):
                            block.append(lines[k])
                            k += 1
                        body = "\n".join(block)
                        names = re.findall(r"(?:set-name|name):\s*['\"]?([^\s'\"#]+)", body)
                        if key == iface or iface in names:
                            return key, bool(re.search(r"^\s*addresses:", body, re.M))
                j += 1
    return iface, False


IFUPDOWN_KEYWORDS = ("iface", "auto", "allow-", "mapping", "source", "rename", "no-")


def ifupdown_stanza(iface: str, cfg: dict) -> str:
    if cfg["mode"] == "dhcp":
        return f"iface {iface} inet dhcp\n"
    return (f"iface {iface} inet static\n"
            f"    address {cfg['address']}/{cfg['prefix']}\n"
            f"    gateway {cfg['gateway']}\n"
            f"    dns-nameservers {' '.join(cfg['dns'])}\n")


def ifupdown_replace(text: str, iface: str, stanza: str) -> Optional[str]:
    """Replace the `iface <iface> inet ...` stanza; None if there is none."""
    lines = text.splitlines(keepends=True)
    out, i, found = [], 0, False
    while i < len(lines):
        if re.match(rf"^iface\s+{re.escape(iface)}\s+inet\s+\S+", lines[i]):
            found = True
            out.append(stanza)
            i += 1
            # the stanza's options follow on indented lines (or unindented option lines)
            while i < len(lines) and lines[i].strip() and (
                    lines[i][0] in " \t" or not lines[i].startswith(IFUPDOWN_KEYWORDS + ("#",))):
                i += 1
            continue
        out.append(lines[i])
        i += 1
    return "".join(out) if found else None


def ifupdown_method(text: str, iface: str) -> Optional[str]:
    m = re.search(rf"^iface\s+{re.escape(iface)}\s+inet\s+(\S+)", text, re.M)
    return m.group(1) if m else None


# ---------------------------------------------------------------- service
class Network:
    def __init__(self, platform, state, demo: bool = False):
        self.p = platform
        self.state = state
        self.demo = demo
        self._lock = threading.Lock()
        self._pending: Optional[dict] = None

    def info(self) -> dict:
        ifaces = self.p.net_interfaces()
        pend = self._pending
        return {"interfaces": ifaces,
                "pending": None if not pend else {
                    k: pend[k] for k in ("iface", "mode", "address", "deadline", "applied", "error")}}

    def apply(self, data: dict, user: str) -> dict:
        cfg = validate(data)
        current = {i["name"]: i for i in self.p.net_interfaces()}
        cur = current.get(cfg["iface"])
        if not cur:
            raise UserError(f"Interface {cfg['iface']} not found")
        if not cur.get("manager"):
            raise UserError(cur.get("unsupported") or "Talon cannot change the network settings on this system")
        with self._lock:
            if self._pending:
                raise UserError("A network change is still waiting to be confirmed")
            self._pending = {"iface": cfg["iface"], "mode": cfg["mode"],
                             "address": cfg.get("address"), "deadline": time.time() + CONFIRM_SECONDS,
                             "applied": None, "error": None, "restore": None, "user": user}
        what = "DHCP" if cfg["mode"] == "dhcp" else f"static address {cfg['address']}/{cfg['prefix']}"
        self.state.log_activity(user, f"Changing {cfg['iface']} to {what}")
        threading.Thread(target=self._apply, args=(cfg,), daemon=True, name="network").start()
        return self.info()

    def _apply(self, cfg: dict) -> None:
        time.sleep(1.5)                       # let the HTTP response reach the browser first
        pend = self._pending
        try:
            pend["restore"] = self.p.net_apply(cfg["iface"], cfg, lambda m: None)
        except Exception as e:                # noqa: BLE001 - report and roll back
            pend["error"] = str(e)
            self.state.log_activity(pend["user"], f"Network change failed: {e}", "error")
            with self._lock:
                self._pending = None
            return
        pend["applied"] = time.time()
        pend["deadline"] = pend["applied"] + CONFIRM_SECONDS
        while self._pending is pend and time.time() < pend["deadline"]:
            time.sleep(1)
        if self._pending is pend:              # nobody reached the NAS: restore
            try:
                self.p.net_restore(cfg["iface"], pend["restore"], lambda m: None)
                self.state.log_activity("talon", "Network change was not confirmed within "
                                        f"{CONFIRM_SECONDS // 60} minutes; previous settings restored", "warning")
            except Exception as e:            # noqa: BLE001
                self.state.log_activity("talon", f"Restoring the network settings failed: {e}", "error")
            with self._lock:
                self._pending = None

    def seen_request(self, client: Optional[str]) -> None:
        """Called for every HTTP request: one arriving over the network after the
        change was applied proves the NAS is reachable, so the change is kept."""
        pend = self._pending
        if not pend or not pend["applied"] or not client:
            return
        local = client.startswith("127.") or client == "::1"
        if (local and not self.demo) or time.time() < pend["applied"] + 2:
            return
        with self._lock:
            if self._pending is pend:
                self._pending = None
                self.state.log_activity(pend["user"], "Network change confirmed")
