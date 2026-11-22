"""Entry point: ``python -m talon [serve|apply|--demo]``."""
from __future__ import annotations

import argparse
import os
import sys

from . import __version__, config


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="talon")
    ap.add_argument("command", nargs="?", default="serve", choices=["serve", "apply", "enable-local-login"],
                    help="serve the web UI (default), re-apply share configuration, or turn sign-in "
                         "with a user name and password back on")
    ap.add_argument("--demo", action="store_true",
                    help="run with simulated disks (no changes to the system)")
    ap.add_argument("--port", type=int)
    ap.add_argument("--host")
    ap.add_argument("--no-tls", action="store_true", help="serve plain HTTP")
    ap.add_argument("--version", action="version", version=__version__)
    args = ap.parse_args(argv)

    cfg = config.load(demo=args.demo)
    if args.port:
        cfg.port = args.port
    if args.host:
        cfg.host = args.host

    from .platform import get_platform
    platform = get_platform(cfg)

    if args.command == "enable-local-login":
        # recovery when Microsoft sign-in no longer works: stop Talon, change the
        # setting, start it again (a running Talon would keep its own copy)
        import subprocess
        from .mslogin import enable_local_login
        from .state import State
        active = subprocess.run(["systemctl", "is-active", "--quiet", "talon"]).returncode == 0
        if active:
            subprocess.run(["systemctl", "stop", "talon"], check=False)
        enable_local_login(State(cfg.state_file))
        if active:
            subprocess.run(["systemctl", "start", "talon"], check=False)
        print("Sign-in with a user name and password is on again.")
        return 0

    if args.command == "apply":
        from .nas import Nas
        Nas(cfg, platform).apply_shares()
        print("Share configuration applied.")
        return 0

    if not cfg.demo and os.geteuid() != 0:
        print("talon must run as root (it manages disks, users and services).",
              file=sys.stderr)
        return 1

    import uvicorn
    from .app import create_app
    app = create_app(cfg, platform)
    kwargs = {}
    use_tls = cfg.https and not args.no_tls and not cfg.demo and os.path.exists(cfg.tls_cert)
    app.state.serving = {"https": use_tls, "port": cfg.port}
    if use_tls:
        kwargs = {"ssl_certfile": cfg.tls_cert, "ssl_keyfile": cfg.tls_key}
    uvicorn.run(app, host=cfg.host, port=cfg.port, log_level="warning",
                proxy_headers=False, server_header=False, **kwargs)
    return 0


if __name__ == "__main__":
    sys.exit(main())
