"""Runtime configuration (paths, port).  Loaded from /etc/talon/config.json."""
from __future__ import annotations

import json
import os
from dataclasses import dataclass, field


@dataclass
class Config:
    host: str = "0.0.0.0"
    port: int = 443
    tls_cert: str = "/etc/talon/tls/cert.pem"
    tls_key: str = "/etc/talon/tls/key.pem"
    state_file: str = "/var/lib/talon/state.json"
    mount_root: str = "/srv/nas"
    admin_group: str = "nasadmins"
    users_group: str = "nasusers"
    pam_service: str = "talon"
    session_hours: int = 12
    demo: bool = False
    extra: dict = field(default_factory=dict)


CONFIG_PATH = os.environ.get("TALON_CONFIG", "/etc/talon/config.json")


def load(demo: bool = False) -> Config:
    cfg = Config()
    try:
        with open(CONFIG_PATH) as f:
            data = json.load(f)
        for k, v in data.items():
            if hasattr(cfg, k):
                setattr(cfg, k, v)
    except FileNotFoundError:
        pass
    if os.environ.get("TALON_PORT"):
        cfg.port = int(os.environ["TALON_PORT"])
    if demo or os.environ.get("TALON_DEMO") == "1":
        cfg.demo = True
        cfg.state_file = os.environ.get("TALON_STATE", "/tmp/talon-demo-state.json")
    return cfg
