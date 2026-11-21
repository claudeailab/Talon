"""Scheduled tasks: shell scripts that run on the NAS on a schedule.

Each task is a bash script that runs as root or as a NAS user, with a time
limit. The output of the last runs is kept on disk. Only administrators can
reach these endpoints, and every change is written to the activity log.
"""
from __future__ import annotations

import datetime
import json
import os
import pwd
import re
import shutil
import signal
import subprocess
import tempfile
import threading
import time
import uuid
from typing import Callable, Dict, List, Optional

from .util import UserError, write_atomic

KEEP_RUNS = 2       # the last run's output; earlier runs are in the activity log
MAX_OUTPUT = 256 * 1024                    # bytes of output kept per run
# progress a script reports: rsync --info=progress2 ("  1,234,567  45%  12.3MB/s  0:01:23 ..."),
# or a line "PROGRESS 45" from any script. These update the progress bar and are not logged.
RSYNC_PROGRESS = re.compile(r"^\s*([\d,]+)\s+(\d{1,3})%\s+([\d.]+)([kMGT]?)B/s\s+(\d+:\d\d:\d\d)(.*)$")
PLAIN_PROGRESS = re.compile(r"^PROGRESS\s+(\d{1,3}(?:\.\d+)?)\s*%?\s*$")


def parse_progress(seg: str) -> Optional[dict]:
    m = RSYNC_PROGRESS.match(seg)
    if m:
        mult = {"": 1, "k": 1024, "M": 1024 ** 2, "G": 1024 ** 3, "T": 1024 ** 4}[m.group(4)]
        hms = [int(x) for x in m.group(5).split(":")]
        done = "xfr#" in m.group(6) and "to-chk=0/" in m.group(6)
        # while copying the time is what is left; on a line closing a file it is the time taken
        eta = None if "xfr#" in m.group(6) else hms[0] * 3600 + hms[1] * 60 + hms[2]
        return {"percent": min(100, int(m.group(2))), "bytes": int(m.group(1).replace(",", "")),
                "speed": float(m.group(3)) * mult, "eta": 0 if done else eta, "source": "rsync"}
    m = PLAIN_PROGRESS.match(seg)
    if m:
        return {"percent": min(100.0, float(m.group(1))), "source": "script"}
    return None
MAX_SCRIPT = 64 * 1024
TIMEOUTS = (0, 5, 15, 30, 60, 120, 360, 720, 1440)     # minutes, 0 = no limit
INTERVALS = (15, 30, 60, 180, 360, 720)                # minutes
KINDS = ("manual", "interval", "daily", "weekly", "monthly", "startup", "cron")
TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
NAME_MAX = 60


# ---------------------------------------------------------------- cron
_CRON_RANGES = ((0, 59), (0, 23), (1, 31), (1, 12), (0, 7))


def _cron_field(text: str, lo: int, hi: int) -> set:
    out: set = set()
    for part in text.split(","):
        step = 1
        if "/" in part:
            part, s = part.split("/", 1)
            if not s.isdigit() or int(s) < 1:
                raise ValueError
            step = int(s)
        if part == "*":
            a, b = lo, hi
        elif "-" in part:
            x, y = part.split("-", 1)
            a, b = int(x), int(y)
        else:
            a = b = int(part)
            if step > 1:
                b = hi
        if a < lo or b > hi or a > b:
            raise ValueError
        out.update(range(a, b + 1, step))
    return out


def parse_cron(expr: str) -> List[set]:
    """Five fields: minute hour day-of-month month day-of-week (0 or 7 = Sunday)."""
    fields = str(expr or "").split()
    if len(fields) != 5:
        raise UserError("A custom schedule needs 5 fields: minute hour day month weekday")
    try:
        sets = [_cron_field(f, *_CRON_RANGES[i]) for i, f in enumerate(fields)]
        if 7 in sets[4]:
            sets[4] = (sets[4] - {7}) | {0}
    except ValueError:
        raise UserError(f"Invalid custom schedule: {expr}") from None
    sets.append(set(fields[2:3]) == {"*"})   # day-of-month unrestricted
    sets.append(set(fields[4:5]) == {"*"})   # weekday unrestricted
    return sets


def _cron_match(sets: List[set], dt: datetime.datetime) -> bool:
    mi, hr, dom, mon, dow, dom_any, dow_any = sets
    if dt.minute not in mi or dt.hour not in hr or dt.month not in mon:
        return False
    d_ok, w_ok = dt.day in dom, (dt.isoweekday() % 7) in dow
    if dom_any or dow_any:                 # standard cron: either restriction may match
        return d_ok and w_ok
    return d_ok or w_ok


def cron_next(expr: str, after: float) -> Optional[float]:
    sets = parse_cron(expr)
    dt = datetime.datetime.fromtimestamp(after).replace(second=0, microsecond=0) + \
        datetime.timedelta(minutes=1)
    end = dt + datetime.timedelta(days=366)
    while dt < end:
        if dt.month not in sets[3]:
            dt = (dt.replace(day=1, hour=0, minute=0) + datetime.timedelta(days=32)).replace(day=1)
            continue
        if dt.hour not in sets[1]:
            dt = dt.replace(minute=0) + datetime.timedelta(hours=1)
            continue
        if _cron_match(sets, dt):
            return dt.timestamp()
        dt += datetime.timedelta(minutes=1)
    return None


# ---------------------------------------------------------------- schedule
def next_run(s: dict, after: float) -> Optional[float]:
    """First time strictly after `after` the schedule fires (None: never by itself)."""
    kind = s["kind"]
    if kind == "interval":
        return after + s["minutes"] * 60
    if kind in ("daily", "weekly", "monthly"):
        hh, mm = map(int, s["time"].split(":"))
        base = datetime.datetime.fromtimestamp(after)
        day = base.replace(hour=hh, minute=mm, second=0, microsecond=0)
        for _ in range(400):
            ok = (kind == "daily" or (kind == "weekly" and day.weekday() == s["weekday"])
                  or (kind == "monthly" and day.day == s["day"]))
            if ok and day.timestamp() > after:
                return day.timestamp()
            day += datetime.timedelta(days=1)
            day = day.replace(hour=hh, minute=mm)
        return None
    if kind == "cron":
        return cron_next(s["cron"], after)
    return None


def schedule_label(s: dict) -> str:
    kind = s["kind"]
    if kind == "interval":
        m = s["minutes"]
        return f"Every {m} minutes" if m < 60 else ("Every hour" if m == 60 else f"Every {m // 60} hours")
    if kind == "daily":
        return f"Daily {s['time']}"
    if kind == "weekly":
        return f"Weekly · {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][s['weekday']]} {s['time']}"
    if kind == "monthly":
        return f"Monthly · day {s['day']} {s['time']}"
    if kind == "startup":
        return "At startup"
    if kind == "cron":
        return f"Custom · {s['cron']}"
    return "Manually"


# ---------------------------------------------------------------- execution
def _segment(raw: bytes, on_output, on_progress) -> None:
    seg = raw.decode("utf-8", "replace")
    if not seg.strip():
        return
    prog = parse_progress(seg)
    if prog:
        if on_progress:
            on_progress(prog)
        return
    on_output(seg + "\n")


def execute(script: str, run_as: str, timeout_s: float,
            on_output: Callable[[str], None], started: Callable[[subprocess.Popen], None],
            on_progress: Optional[Callable[[dict], None]] = None) -> int:
    """Run `script` with bash as `run_as`; returns the exit code (124 on time-out)."""
    fd, path = tempfile.mkstemp(prefix="talon-task-", suffix=".sh")
    try:
        with os.fdopen(fd, "w") as f:
            f.write(script if script.endswith("\n") else script + "\n")
        env = {"PATH": "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
               "LANG": "C.UTF-8", "TALON_TASK": "1"}
        if run_as == "root" or (os.geteuid() != 0 and run_as == pwd.getpwuid(os.geteuid()).pw_name):
            cmd = ["bash", path]
            home = pwd.getpwuid(os.geteuid()).pw_dir
        else:
            pw = pwd.getpwnam(run_as)
            os.chmod(path, 0o644)
            cmd = [shutil.which("runuser") or "/usr/sbin/runuser", "-u", run_as, "--", "bash", path]
            home = pw.pw_dir
        env.update(HOME=home, USER=run_as, LOGNAME=run_as)
        cwd = "/srv/nas" if os.path.isdir("/srv/nas") else "/"
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                stdin=subprocess.DEVNULL, cwd=cwd, env=env,
                                start_new_session=True)
        started(proc)
        timer = None
        timed_out = threading.Event()
        if timeout_s:
            def kill():
                timed_out.set()
                _kill_group(proc)
            timer = threading.Timer(timeout_s, kill)
            timer.daemon = True
            timer.start()
        assert proc.stdout is not None
        # split on carriage returns too: rsync rewrites its progress line with "\r"
        buf = b""
        fd_out = proc.stdout.fileno()
        while True:
            chunk = os.read(fd_out, 65536)
            if not chunk:
                break
            buf += chunk
            *parts, buf = re.split(rb"[\r\n]", buf)
            for raw in parts:
                _segment(raw, on_output, on_progress)
        if buf:
            _segment(buf, on_output, on_progress)
        code = proc.wait()
        if timer:
            timer.cancel()
        if timed_out.is_set():
            limit = f"{timeout_s / 60:g} minutes" if timeout_s >= 60 else f"{timeout_s:g} seconds"
            on_output(f"\nStopped after {limit} (time limit)\n")
            return 124
        return code
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass


def _kill_group(proc: subprocess.Popen) -> None:
    try:
        os.killpg(proc.pid, signal.SIGTERM)
    except (OSError, ProcessLookupError):
        return
    try:
        proc.wait(5)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except (OSError, ProcessLookupError):
            pass


# ---------------------------------------------------------------- scheduler
class Scheduler:
    def __init__(self, cfg, state, nas, demo: bool = False):
        self.state = state
        self.nas = nas
        self.demo = demo
        self.dir = os.path.join(os.path.dirname(os.path.abspath(cfg.state_file)), "scheduled")
        self._running: Dict[str, dict] = {}
        self._pending: set = set()
        self._lock = threading.RLock()
        self._stop = threading.Event()

    # ------------------------------------------------------------ state
    def _tasks(self) -> Dict[str, dict]:
        return dict((self.state.get("scheduled") or {}).get("tasks") or {})

    def _task(self, tid: str) -> dict:
        t = self._tasks().get(tid)
        if not t:
            raise UserError("Task not found")
        return t

    def _put(self, t: dict) -> None:
        def f(d):
            s = d.setdefault("scheduled", {})
            s.setdefault("tasks", {})[t["id"]] = t
        self.state.update(f)

    def _view(self, t: dict) -> dict:
        r = self._running.get(t["id"])
        return {**{k: v for k, v in t.items() if k not in ("due_after", "boot")},
                "schedule_label": schedule_label(t["schedule"]),
                "next_run": None if not t.get("enabled", True) else self._next(t),
                "running": {"started": r["started"],
                            "percent": (r.get("progress") or {}).get("percent")} if r else None}

    def list(self) -> List[dict]:
        return [self._view(t) for t in sorted(self._tasks().values(), key=lambda x: x["name"].lower())]

    def run_as_options(self) -> List[str]:
        return ["root"] + sorted(u["name"] for u in self.nas.users() if not u.get("disabled"))

    # ------------------------------------------------------------ validation
    def _validate(self, data: dict, old: Optional[dict], check_name: bool = True) -> dict:
        name = str(data.get("name", "")).strip()
        if not name or len(name) > NAME_MAX:
            raise UserError(f"Enter a task name (at most {NAME_MAX} characters)")
        if check_name and any(t["name"].lower() == name.lower() and (not old or t["id"] != old["id"])
               for t in self._tasks().values()):
            raise UserError(f"A task named {name} already exists")
        script = str(data.get("script", "")).replace("\r\n", "\n")
        if not script.strip():
            raise UserError("Enter what to run")
        if len(script.encode()) > MAX_SCRIPT:
            raise UserError("The script is too long (64 KB at most)")
        run_as = str(data.get("run_as") or "root")
        if run_as not in self.run_as_options():
            raise UserError(f"Unknown account {run_as}")
        try:
            timeout = int(data.get("timeout", 60))
        except (TypeError, ValueError):
            timeout = -1
        if timeout not in TIMEOUTS:
            raise UserError("Choose a time limit")
        s = data.get("schedule") or {}
        kind = s.get("kind")
        if kind not in KINDS:
            raise UserError("Choose a schedule")
        sched: dict = {"kind": kind}
        if kind == "interval":
            if s.get("minutes") not in INTERVALS:
                raise UserError("Choose how often to run")
            sched["minutes"] = s["minutes"]
        if kind in ("daily", "weekly", "monthly"):
            if not TIME_RE.match(str(s.get("time", ""))):
                raise UserError("Enter a time like 02:00")
            sched["time"] = s["time"]
        if kind == "weekly":
            if s.get("weekday") not in range(7):
                raise UserError("Choose a weekday")
            sched["weekday"] = s["weekday"]
        if kind == "monthly":
            if s.get("day") not in range(1, 29):
                raise UserError("Choose a day of the month between 1 and 28")
            sched["day"] = s["day"]
        if kind == "cron":
            expr = " ".join(str(s.get("cron", "")).split())
            parse_cron(expr)
            sched["cron"] = expr
        return {"name": name, "script": script, "run_as": run_as, "timeout": timeout,
                "schedule": sched, "notify": bool(data.get("notify", True)),
                "skip_if_running": bool(data.get("skip_if_running", True))}

    # ------------------------------------------------------------ CRUD
    def create(self, data: dict, user: str) -> dict:
        clean = self._validate(data, None)
        now = time.time()
        t = {**clean, "id": uuid.uuid4().hex[:12], "enabled": True, "created": now,
             "due_after": now, "boot": self._boot_time(), "last": None}
        self._put(t)
        self.state.log_activity(user, f"Created scheduled task {t['name']}")
        return self._view(t)

    def update(self, tid: str, data: dict, user: str) -> dict:
        old = self._task(tid)
        clean = self._validate(data, old)
        t = {**old, **clean}
        if clean["schedule"] != old["schedule"]:
            t["due_after"] = time.time()
        self._put(t)
        self.state.log_activity(user, f"Updated scheduled task {t['name']}")
        return self._view(t)

    def set_enabled(self, tid: str, enabled: bool, user: str) -> dict:
        t = {**self._task(tid), "enabled": bool(enabled)}
        if enabled:
            t["due_after"] = time.time()
        self._put(t)
        self.state.log_activity(user, f"{'Resumed' if enabled else 'Paused'} scheduled task {t['name']}")
        return self._view(t)

    def delete(self, tid: str, user: str) -> None:
        t = self._task(tid)
        self.stop_task(tid)
        self.state.update(lambda d: (d.get("scheduled") or {}).get("tasks", {}).pop(tid, None))
        shutil.rmtree(os.path.join(self.dir, tid), ignore_errors=True)
        self.state.log_activity(user, f"Deleted scheduled task {t['name']}")

    # ------------------------------------------------------------ history
    def runs(self, tid: str) -> List[dict]:
        self._task(tid)
        out = []
        r = self._running.get(tid)
        if r:
            out.append({"id": "running", "started": r["started"], "finished": None,
                        "status": "running", "exit_code": None, "trigger": r["trigger"],
                        "output": "".join(r["output"]),
                        "idle": int(time.time() - r.get("last_output", r["started"])),
                        "progress": r.get("progress")})
        d = os.path.join(self.dir, tid)
        try:
            names = sorted((n for n in os.listdir(d) if n.endswith(".json")), reverse=True)
        except OSError:
            names = []
        for n in names[:KEEP_RUNS]:
            try:
                with open(os.path.join(d, n)) as f:
                    out.append(json.load(f))
            except (OSError, ValueError):
                continue
        if r:          # for reference while running: how long the last good run took
            last = next((x for x in out if x.get("status") == "success" and x.get("finished")), None)
            out[0]["last_took"] = round(last["finished"] - last["started"]) if last else None
        return out

    def _save_run(self, tid: str, run: dict) -> None:
        d = os.path.join(self.dir, tid)
        os.makedirs(d, mode=0o700, exist_ok=True)
        write_atomic(os.path.join(d, f"{int(run['started'] * 1000):015d}.json"), json.dumps(run))
        names = sorted(n for n in os.listdir(d) if n.endswith(".json"))
        for n in names[:-KEEP_RUNS]:
            try:
                os.unlink(os.path.join(d, n))
            except OSError:
                pass

    # ------------------------------------------------------------ running
    def run_now(self, tid: str, user: str) -> None:
        t = self._task(tid)
        if tid in self._running:
            raise UserError(f"{t['name']} is already running")
        self.state.log_activity(user, f"Started scheduled task {t['name']}")
        self._start(t, "manual")

    def test_run(self, data: dict, user: str) -> dict:
        """Run unsaved settings once and return the output (at most 60 seconds)."""
        clean = self._validate({**data, "name": "Test run"}, None, check_name=False)
        self.state.log_activity(user, f"Test run as {clean['run_as']}")
        if self.demo:
            return {"exit_code": 0, "output": _demo_output(clean["script"]), "seconds": 0.4}
        buf: List[str] = []
        size = [0]

        def out(line: str) -> None:
            if size[0] < MAX_OUTPUT:
                buf.append(line)
                size[0] += len(line)
        t0 = time.time()
        code = execute(clean["script"], clean["run_as"], 60, out, lambda p: None)   # 1 minute at most
        return {"exit_code": code, "output": "".join(buf), "seconds": round(time.time() - t0, 1)}

    def stop_task(self, tid: str) -> None:
        r = self._running.get(tid)
        if r:
            r["cancel"] = True
            if r.get("proc"):
                _kill_group(r["proc"])

    def _start(self, t: dict, trigger: str) -> None:
        with self._lock:
            if t["id"] in self._running:
                return
            self._running[t["id"]] = {"started": time.time(), "trigger": trigger,
                                      "output": [], "size": 0, "cancel": False, "proc": None}
        if trigger != "manual":                 # by hand: logged with who started it
            self.state.log_activity("talon", f"Scheduled task {t['name']} started ({trigger})", "info", "scheduled")
        threading.Thread(target=self._run, args=(t, trigger), daemon=True,
                         name=f"task-{t['id']}").start()

    def _run(self, t: dict, trigger: str) -> None:
        r = self._running[t["id"]]

        def out(text: str) -> None:
            # each line gets the time it was printed ("HH:MM:SS<TAB>line"), like the
            # OneDrive log, so the output window can show when things happened
            r["last_output"] = time.time()
            when = time.strftime("%H:%M:%S")
            for line in text.splitlines(keepends=True):
                if r["size"] >= MAX_OUTPUT:
                    return
                if not line.strip():
                    continue
                line = f"{when}\t{line if line.endswith(chr(10)) else line + chr(10)}"
                r["output"].append(line)
                r["size"] += len(line)
                if r["size"] >= MAX_OUTPUT:
                    r["output"].append(f"{when}\t[output truncated]\n")

        def started(p):
            r["proc"] = p

        try:
            if self.demo:
                time.sleep(1.5)
                out(_demo_output(t["script"]))
                if "rsync" in t["script"]:            # demo: show what rsync progress looks like
                    total = 2_400_000_000
                    for i in range(1, 13):
                        if r["cancel"]:
                            break
                        time.sleep(0.7)
                        r.update(last_output=time.time(), progress={
                            "percent": round(i * 100 / 12), "bytes": total * i // 12,
                            "speed": 48 * 1024 ** 2, "eta": (12 - i) * 4, "source": "rsync"})
                        out(f"Photos/2026/Holiday in Paphos/IMG_{4100 + i}.HEIC")
                code = 0
            else:
                code = execute(t["script"], t["run_as"], t["timeout"] * 60, out, started,
                               lambda p: r.update(last_output=time.time(), progress={
                                   **(r.get("progress") or {}),
                                   **{k: v for k, v in p.items() if v is not None}}))
        except Exception as e:        # noqa: BLE001 - report any failure as the run result
            out(f"\nCould not run the task: {e}\n")
            code = 127
        finished = time.time()
        status = "cancelled" if r["cancel"] else ("success" if code == 0 else "error")
        run = {"id": str(int(r["started"] * 1000)), "started": r["started"], "finished": finished,
               "status": status, "exit_code": code, "trigger": trigger,
               "output": "".join(r["output"])}
        try:
            self._save_run(t["id"], run)
        except OSError:
            pass
        last = {k: run[k] for k in ("started", "finished", "status", "exit_code")}
        cur = self._tasks().get(t["id"])
        if cur:
            self._put({**cur, "last": last})
        with self._lock:
            self._running.pop(t["id"], None)
            again = t["id"] in self._pending
            self._pending.discard(t["id"])
        secs = int(finished - r["started"])
        took = f"{secs} s" if secs < 90 else f"{round(secs / 60)} min" if secs < 5400 else f"{secs / 3600:.1f} h"
        if status == "success":
            self.state.log_activity("talon", f"Scheduled task {t['name']} finished in {took}", "info", "scheduled")
        elif status == "cancelled":
            self.state.log_activity("talon", f"Scheduled task {t['name']} was stopped after {took}", "warning", "scheduled")
        if status == "error":
            self.state.log_activity("talon", f"Scheduled task {t['name']} failed (exit {code}) after {took}",
                                    "error", "scheduled")
            if t.get("notify"):
                tail = "".join(run["output"])[-4000:]
                self.nas.notifier.send(
                    "scheduled_failed", f"Scheduled task {t['name']} failed",
                    f"The scheduled task {t['name']} failed with exit code {code}.\n\n"
                    f"Last output:\n{tail}", force=True)
        if again and cur:
            self._start(cur, "schedule")

    # ------------------------------------------------------------ schedule loop
    @staticmethod
    def _boot_time() -> float:
        try:
            with open("/proc/stat") as f:
                for line in f:
                    if line.startswith("btime "):
                        return float(line.split()[1])
        except OSError:
            pass
        return 0.0

    def _next(self, t: dict) -> Optional[float]:
        s = t["schedule"]
        if s["kind"] == "interval":
            last = (t.get("last") or {}).get("started") or 0
            return next_run(s, max(last, t.get("due_after", t["created"])))
        try:
            return next_run(s, t.get("due_after", t["created"]))
        except UserError:
            return None

    def start(self) -> None:
        threading.Thread(target=self._loop, daemon=True, name="scheduler").start()

    def stop(self) -> None:
        self._stop.set()

    def _loop(self) -> None:
        self.tick(startup=True)
        while not self._stop.wait(20):
            self.tick()

    def tick(self, startup: bool = False, now: Optional[float] = None) -> None:
        now = now or time.time()
        boot = self._boot_time()
        for t in self._tasks().values():
            try:
                if not t.get("enabled", True):
                    continue
                if t["schedule"]["kind"] == "startup":
                    if startup and boot and t.get("boot") != boot:
                        self._put({**t, "boot": boot})
                        self._fire(t)
                    continue
                nxt = self._next(t)
                if nxt is not None and now >= nxt:
                    self._put({**t, "due_after": now})
                    self._fire(t)
            except Exception:       # noqa: BLE001 - one bad task must not stop the others
                continue

    def _fire(self, t: dict) -> None:
        if t["id"] in self._running:
            if t.get("skip_if_running", True):
                self.state.log_activity("talon", f"Skipped scheduled task {t['name']}: still running")
            else:
                self._pending.add(t["id"])
            return
        self._start(t, "schedule")


def _demo_output(script: str) -> str:
    lines = [ln for ln in script.splitlines() if ln.strip()][:6]
    return "".join(f"+ {ln}\n" for ln in lines) + "Demo mode: commands are not run.\n"
