"""Small helpers: command execution, validation, atomic file writes."""
from __future__ import annotations

import os
import re
import subprocess
import tempfile
from typing import Callable, Iterable, Optional, Sequence

Logger = Callable[[str], None]


class CommandError(RuntimeError):
    def __init__(self, cmd: Sequence[str], code: int, stdout: str, stderr: str):
        self.cmd = list(cmd)
        self.code = code
        self.stdout = stdout
        self.stderr = stderr
        msg = (stderr or stdout or "").strip().splitlines()
        super().__init__(f"`{' '.join(cmd)}` failed ({code}): {msg[-1] if msg else 'no output'}")


class UserError(ValueError):
    """An error caused by invalid user input; shown verbatim in the UI."""


def run(cmd: Sequence[str], *, input: Optional[str] = None, check: bool = True,
        timeout: Optional[float] = 600, log: Optional[Logger] = None,
        env: Optional[dict] = None) -> subprocess.CompletedProcess:
    if log:
        log("$ " + " ".join(cmd))
    full_env = None
    if env:
        full_env = dict(os.environ)
        full_env.update(env)
    try:
        cp = subprocess.run(list(cmd), input=input, capture_output=True, text=True,
                            timeout=timeout, env=full_env)
    except FileNotFoundError as e:
        if check:
            raise CommandError(cmd, 127, "", f"command not found: {cmd[0]}") from e
        return subprocess.CompletedProcess(list(cmd), 127, "", f"command not found: {cmd[0]}")
    if log:
        out = (cp.stdout or "").strip()
        err = (cp.stderr or "").strip()
        if out:
            log(out[-4000:])
        if err:
            log(err[-4000:])
    if check and cp.returncode != 0:
        raise CommandError(cmd, cp.returncode, cp.stdout, cp.stderr)
    return cp


def write_atomic(path: str, content: str, mode: int = 0o644) -> None:
    d = os.path.dirname(path) or "."
    os.makedirs(d, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=d, prefix=".talon-")
    try:
        with os.fdopen(fd, "w") as f:
            f.write(content)
        os.chmod(tmp, mode)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def read_file(path: str, default: str = "") -> str:
    try:
        with open(path) as f:
            return f.read()
    except OSError:
        return default


# ---- validation -----------------------------------------------------------

VOLUME_NAME_RE = re.compile(r"^[a-z][a-z0-9_-]{0,23}$")
SHARE_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$")
USER_NAME_RE = re.compile(r"^[a-z_][a-z0-9_-]{0,31}$")
NFS_CLIENT_RE = re.compile(r"^(\*|[A-Za-z0-9*?.:_-]+(/[0-9]{1,3})?|@[A-Za-z0-9_.-]+)$")
DEVICE_RE = re.compile(r"^[A-Za-z0-9_-]+$")
RESERVED_SHARES = {"global", "homes", "printers", "print$", "ipc$"}


def require(pattern: re.Pattern, value: str, what: str) -> str:
    if not isinstance(value, str) or not pattern.match(value):
        raise UserError(f"Invalid {what}: {value!r}")
    return value


def human_bytes(n: float) -> str:
    """Like Windows and the web interface: 1 GB = 1024**3 bytes."""
    units = ["B", "KB", "MB", "GB", "TB", "PB"]
    i = 0
    while n >= 1024 and i < len(units) - 1:
        n /= 1024.0
        i += 1
    return f"{n:.1f} {units[i]}" if i else f"{int(n)} B"


def unique(items: Iterable[str]) -> list:
    seen, out = set(), []
    for x in items:
        if x not in seen:
            seen.add(x)
            out.append(x)
    return out


# date and time formats (Settings → General); strftime patterns for emails and logs
DATE_FORMATS = {"dd-mm-yyyy": "%d-%m-%Y", "dd/mm/yyyy": "%d/%m/%Y", "dd.mm.yyyy": "%d.%m.%Y",
                "mm/dd/yyyy": "%m/%d/%Y", "yyyy-mm-dd": "%Y-%m-%d"}
TIME_FORMATS = {"24h": "%H:%M", "12h": "%I:%M %p"}


def date_pattern(settings: Optional[dict], with_time: bool = False) -> str:
    s = settings or {}
    d = DATE_FORMATS.get(s.get("date_format", ""), DATE_FORMATS["dd-mm-yyyy"])
    return f"{d} {TIME_FORMATS.get(s.get('time_format', ''), TIME_FORMATS['24h'])}" if with_time else d
