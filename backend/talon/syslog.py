"""System logs: what the operating system and its services wrote to the journal.

Shown under Activity → System logs, next to Talon's own activity log. Read with
journalctl (JSON output), filtered by source (Samba, NFS, SSH, disks, kernel,
Talon's own service), level and a text search."""
from __future__ import annotations

import json
import random
import time
from typing import List, Optional

from .util import run

# journal matches per source: matches of the same field are OR'ed by journalctl,
# "+" separates alternatives
SOURCES = {
    "samba": {"label": "Samba", "match": ["_SYSTEMD_UNIT=smbd.service", "+", "_SYSTEMD_UNIT=nmbd.service",
                                          "+", "SYSLOG_IDENTIFIER=smbd", "+", "SYSLOG_IDENTIFIER=nmbd"]},
    "nfs": {"label": "NFS", "match": ["_SYSTEMD_UNIT=nfs-server.service", "+", "_SYSTEMD_UNIT=nfs-mountd.service",
                                      "+", "SYSLOG_IDENTIFIER=rpc.mountd", "+", "SYSLOG_IDENTIFIER=nfsdcld"]},
    "ssh": {"label": "SSH", "match": ["_SYSTEMD_UNIT=ssh.service", "+", "SYSLOG_IDENTIFIER=sshd",
                                      "+", "SYSLOG_IDENTIFIER=sshd-session"]},
    "disks": {"label": "Disks", "match": ["_SYSTEMD_UNIT=smartmontools.service", "+", "SYSLOG_IDENTIFIER=smartd",
                                          "+", "SYSLOG_IDENTIFIER=mdadm", "+", "_SYSTEMD_UNIT=mdmonitor.service"]},
    "kernel": {"label": "Kernel", "match": ["_TRANSPORT=kernel"]},
    "talon": {"label": "Talon service", "match": ["_SYSTEMD_UNIT=talon.service"]},
}
MAX_SCAN = 5000            # newest entries read per query


def _level(priority) -> str:
    try:
        p = int(priority)
    except (TypeError, ValueError):
        return "info"
    return "error" if p <= 3 else "warning" if p == 4 else "info"


def _source_of(e: dict) -> str:
    unit = e.get("_SYSTEMD_UNIT") or ""
    ident = e.get("SYSLOG_IDENTIFIER") or ""
    if e.get("_TRANSPORT") == "kernel":
        return "kernel"
    for key, src in SOURCES.items():
        for m in src["match"]:
            if m != "+" and (m == f"_SYSTEMD_UNIT={unit}" or m == f"SYSLOG_IDENTIFIER={ident}"):
                return key
    return ""


class SystemLog:
    def __init__(self, demo: bool = False):
        self.demo = demo
        self._sample: Optional[List[dict]] = None

    def sources(self) -> List[dict]:
        return [{"id": k, "label": v["label"]} for k, v in SOURCES.items()]

    def query(self, offset: int = 0, limit: int = 25, source: str = "", level: str = "", q: str = "",
              cap: int = 200) -> dict:
        offset, limit = max(0, int(offset)), max(1, min(cap, int(limit)))
        want = min(MAX_SCAN, offset + limit + 1)
        entries = self._sample_entries(source, level, q) if self.demo else self._journal(want, source, level, q)
        page = entries[offset:offset + limit]
        return {"items": page, "offset": offset, "limit": limit, "more": len(entries) > offset + limit,
                "sources": self.sources()}

    # ------------------------------------------------------------ journal
    def _journal(self, n: int, source: str, level: str, q: str) -> List[dict]:
        cmd = ["journalctl", "--no-pager", "-o", "json", "-r", "-n", str(n),
               "--output-fields=MESSAGE,PRIORITY,_SYSTEMD_UNIT,SYSLOG_IDENTIFIER,_TRANSPORT,__REALTIME_TIMESTAMP"]
        if level == "error":
            cmd += ["-p", "err"]
        elif level == "warning":
            cmd += ["-p", "warning"]
        if q:
            cmd += ["--case-sensitive=false", "-g", _escape(q)]
        if source in SOURCES:
            cmd += SOURCES[source]["match"]
        cp = run(cmd, check=False, timeout=30)
        out = []
        for line in (cp.stdout or "").splitlines():
            try:
                e = json.loads(line)
            except ValueError:
                continue
            msg = e.get("MESSAGE")
            if isinstance(msg, list):                 # binary messages come as byte lists
                msg = bytes(x for x in msg if isinstance(x, int) and 0 <= x < 256).decode("utf-8", "replace")
            try:
                ts = int(e.get("__REALTIME_TIMESTAMP", "0")) / 1e6
            except ValueError:
                ts = 0
            src = source if source in SOURCES else _source_of(e)
            out.append({"ts": ts, "level": _level(e.get("PRIORITY")), "source": src,
                        "program": e.get("SYSLOG_IDENTIFIER") or (e.get("_SYSTEMD_UNIT") or "").removesuffix(".service")
                        or ("kernel" if e.get("_TRANSPORT") == "kernel" else ""),
                        "message": (msg or "").strip()})
        return out

    # ------------------------------------------------------------ demo
    def _sample_entries(self, source: str, level: str, q: str) -> List[dict]:
        if self._sample is None:
            rnd = random.Random(7)
            now = time.time()
            lines = [
                ("ssh", "sshd", "error", "Failed password for root from 203.0.113.7 port 51022 ssh2"),
                ("ssh", "sshd", "info", "Accepted publickey for nasadmin from 192.168.1.20 port 50112 ssh2"),
                ("disks", "smartd", "warning", "Device: /dev/sdb [SAT], Temperature changed +4 Celsius to 56 Celsius"),
                ("disks", "smartd", "info", "Device: /dev/sda [SAT], SMART Usage Attribute: 194 Temperature_Celsius changed from 64 to 63"),
                ("disks", "mdadm", "info", "RebuildFinished event detected on md device /dev/md0"),
                ("samba", "smbd", "info", "maria connected to service Documents"),
                ("samba", "smbd", "warning", "Authentication for user [guest] -> [guest] FAILED with error NT_STATUS_NO_SUCH_USER"),
                ("samba", "nmbd", "info", "Samba name server TALON-DEMO is now a local master browser for workgroup WORKGROUP"),
                ("nfs", "rpc.mountd", "info", "authenticated mount request from 192.168.1.50:812 for /srv/nas/tank/Media"),
                ("kernel", "kernel", "info", "md/raid:md0: device sdc operational as raid disk 2"),
                ("kernel", "kernel", "warning", "ata3: SError: { CommWake }"),
                ("kernel", "kernel", "info", "EXT4-fs (md0): mounted filesystem with ordered data mode"),
                ("talon", "talon", "info", "Uvicorn running on https://0.0.0.0:443"),
            ]
            out = []
            t = now
            for _ in range(160):
                t -= rnd.randint(60, 2400)
                src, prog, lvl, msg = rnd.choice(lines)
                out.append({"ts": t, "level": lvl, "source": src, "program": prog, "message": msg})
            self._sample = out
        words = q.lower().split()
        ok = {"error": ("error",), "warning": ("error", "warning")}.get(level)
        return [e for e in self._sample
                if (not source or e["source"] == source) and (not ok or e["level"] in ok)
                and all(w in e["message"].lower() for w in words)]


def _escape(q: str) -> str:
    """journalctl -g takes a regular expression: search for the literal text."""
    return "".join("\\" + c if c in r".^$*+?()[]{}|\/" else c for c in q.strip())
