"""Usage history: CPU, memory, network, disk activity, temperatures and used space
for up to a year, shown when you tap a card on the Dashboard.

Samples (every 2 seconds) are averaged into tiers, each with its own resolution:
  minute  1 minute    for 24 hours   (1 hour and 24 hours)
  quarter 15 minutes  for 7 days
  hour    1 hour      for 30 days
  day6    6 hours     for 1 year
Each bucket keeps the average and, for CPU and temperatures, the peak. Everything
is kept in memory and written to one file every 10 minutes (every hour when the
system disk is an SD card or USB flash drive), about 1 MB in all."""
from __future__ import annotations

import collections
import json
import os
import random
import threading
import time
from typing import Dict, List, Optional

from .util import write_atomic

TIERS = [("minute", 60, 24 * 3600), ("quarter", 900, 7 * 86400), ("hour", 3600, 30 * 86400), ("day6", 21600, 366 * 86400)]
RANGES = {"1h": ("minute", 3600), "24h": ("minute", 86400), "7d": ("quarter", 7 * 86400),
          "30d": ("hour", 30 * 86400), "1y": ("day6", 366 * 86400)}
METRICS = ("cpu", "mem", "temp", "rx", "tx", "read", "write")
PEAKS = ("cpu", "temp")          # also keep the highest value of each bucket


class _Acc:
    """Adds up the samples of one bucket."""

    def __init__(self, start: float):
        self.start = start
        self.n: Dict[str, int] = {}
        self.sum: Dict[str, float] = {}
        self.max: Dict[str, float] = {}

    def add(self, key: str, v) -> None:
        if v is None:
            return
        self.n[key] = self.n.get(key, 0) + 1
        self.sum[key] = self.sum.get(key, 0.0) + float(v)
        if key in PEAKS or key.startswith("disk:"):
            self.max[key] = max(self.max.get(key, float(v)), float(v))

    def add_point(self, p: dict) -> None:
        for k, v in p.items():
            if k != "ts":
                self.add(k, v)

    def point(self) -> dict:
        out = {"ts": self.start}
        for k, n in self.n.items():
            out[k] = round(self.sum[k] / n, 3)
        for k, v in self.max.items():
            out[k + "^"] = round(v, 3)          # the bucket's peak
        return out


class History:
    def __init__(self, path: str, flush_every: float = 600):
        self.path = path
        self.flush_every = flush_every
        self._lock = threading.Lock()
        self.tiers: Dict[str, List[dict]] = {name: [] for name, _, _ in TIERS}
        self._acc: Dict[str, Optional[_Acc]] = {name: None for name, _, _ in TIERS}
        self._flushed = time.time()
        self._load()

    # ------------------------------------------------------------ in
    def add(self, point: dict) -> None:
        """One sample: {"ts", "cpu", "mem", "temp", "rx", ..., "disk:sda": 37, "vol:tank": 1.2e12}."""
        ts = point["ts"]
        with self._lock:
            for name, step, keep in TIERS:
                start = ts - ts % step
                acc = self._acc[name]
                if acc and acc.start != start:
                    self.tiers[name].append(acc.point())
                    cut = ts - keep
                    while self.tiers[name] and self.tiers[name][0]["ts"] < cut:
                        self.tiers[name].pop(0)
                    acc = None
                if acc is None:
                    acc = self._acc[name] = _Acc(start)
                acc.add_point(point)
        if time.time() - self._flushed > self.flush_every:
            self.flush()

    # ------------------------------------------------------------ out
    def series(self, rng: str) -> dict:
        tier, span = RANGES.get(rng, RANGES["24h"])
        now = time.time()
        with self._lock:
            pts = [p for p in self.tiers[tier] if p["ts"] >= now - span]
            if self._acc[tier]:
                pts.append(self._acc[tier].point())
        step = dict((n, s) for n, s, _ in TIERS)[tier]
        if rng == "24h":                       # 1440 minutes is more than a chart needs: 5 minutes
            pts, step = _merge(pts, 5), 300
        return {"range": rng, "step": step, "points": pts}

    def forecast(self, key: str, total: float) -> Optional[dict]:
        """When will a volume be full, from the growth of the last 30 days (hourly)."""
        with self._lock:
            pts = [(p["ts"], p[key]) for p in self.tiers["hour"] if key in p]
        if len(pts) < 24 * 3:                       # at least three days of data
            return None
        x0 = pts[0][0]
        xs = [(t - x0) / 86400 for t, _ in pts]
        ys = [v for _, v in pts]
        n = len(xs)
        mx, my = sum(xs) / n, sum(ys) / n
        den = sum((x - mx) ** 2 for x in xs)
        if not den:
            return None
        slope = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / den      # bytes a day
        if slope <= 0:
            return {"per_month": slope * 30, "full_in_days": None}
        days = (total - ys[-1]) / slope
        return {"per_month": slope * 30, "full_in_days": max(0.0, days)}

    # ------------------------------------------------------------ disk
    def _load(self) -> None:
        try:
            with open(self.path) as f:
                data = json.load(f)
            for name in self.tiers:
                self.tiers[name] = [p for p in data.get(name, []) if isinstance(p, dict) and "ts" in p]
        except (OSError, ValueError):
            pass

    def flush(self) -> None:
        with self._lock:
            data = {name: list(pts) for name, pts in self.tiers.items()}
            self._flushed = time.time()
        try:
            write_atomic(self.path, json.dumps(data, separators=(",", ":")), 0o600)
        except OSError:
            pass

    def seed_demo(self, volumes: Dict[str, float], disks: List[str]) -> None:
        """Demo mode: a year of believable history."""
        if any(self.tiers.values()):
            return
        rnd = random.Random(3)
        now = time.time()
        for name, step, keep in TIERS:
            pts = []
            t = now - keep
            t -= t % step
            while t < now - step:
                hour = time.localtime(t).tm_hour
                busy = 1.0 + (0.8 if 8 <= hour <= 23 else 0.0)
                cpu = min(100, rnd.uniform(3, 12) * busy + (rnd.random() < 0.02) * rnd.uniform(40, 80))
                p = {"ts": t, "cpu": round(cpu, 1), "cpu^": round(min(100, cpu * rnd.uniform(1.2, 2.5)), 1),
                     "mem": round(28 + rnd.uniform(-3, 6), 1), "temp": round(41 + cpu * 0.25 + rnd.uniform(-2, 2), 1),
                     "rx": rnd.uniform(1e4, 4e6) * busy, "tx": rnd.uniform(1e4, 2e6) * busy,
                     "read": rnd.uniform(1e4, 8e6) * busy, "write": rnd.uniform(1e4, 3e6) * busy}
                p["temp^"] = round(p["temp"] + rnd.uniform(1, 6), 1)
                for d in disks:
                    p["disk:" + d] = round(33 + rnd.uniform(-2, 4) + (busy - 1) * 3, 1)
                    p["disk:" + d + "^"] = p["disk:" + d] + 2
                age = (now - t) / 86400
                for v, used in volumes.items():
                    p["vol:" + v] = max(0.0, used - age * 1.3e9 + rnd.uniform(-2e8, 2e8))
                pts.append(p)
                t += step
            self.tiers[name] = pts


def _merge(pts: List[dict], n: int) -> List[dict]:
    """Average every n points into one (peaks stay peaks)."""
    out = []
    for i in range(0, len(pts), n):
        chunk = pts[i:i + n]
        p: dict = {"ts": chunk[0]["ts"]}
        keys = {k for c in chunk for k in c if k != "ts"}
        for k in keys:
            vals = [c[k] for c in chunk if c.get(k) is not None]
            if vals:
                p[k] = max(vals) if k.endswith("^") else round(sum(vals) / len(vals), 3)
        out.append(p)
    return out


TREND_KEYS = ("cpu", "mem_used", "rx", "tx", "read", "write", "temp")


class Trend:
    """The Dashboard cards' small charts: the last 30 minutes in 20-second steps, so a
    short burst (opening the page) does not fill the chart and there is always something
    to see. Starts from the saved per-minute history after a restart."""

    def __init__(self, step: int = 20, keep: int = 90):
        self.step = step
        self.points: "collections.deque[dict]" = collections.deque(maxlen=keep)
        self._acc: Optional[dict] = None
        self._lock = threading.Lock()

    def seed(self, minutes: List[dict], now: float) -> None:
        """Fill with the per-minute history (History "minute" tier) of the last half hour:
        each minute becomes three steps. Memory is a percentage there."""
        span = self.step * (self.points.maxlen or 90)
        with self._lock:
            for m in minutes:
                if m["ts"] < now - span or m.get("cpu") is None:
                    continue
                for k in range(60 // self.step):
                    self.points.append({"ts": m["ts"] + k * self.step, "cpu": m.get("cpu", 0.0),
                                        "mem_used": m.get("mem") or 0.0, "mem_total": 100.0,
                                        "temp": m.get("temp"), "load": [],
                                        **{x: m.get(x) or 0.0 for x in ("rx", "tx", "read", "write")}})

    def add(self, p: dict) -> None:
        """One 2-second sample, as kept for the live numbers."""
        start = p["ts"] - p["ts"] % self.step
        with self._lock:
            a = self._acc
            if a and a["start"] != start:
                self.points.append(self._avg(a))
                a = None
            if a is None:
                a = self._acc = {"start": start, "n": 0, "sum": {k: 0.0 for k in TREND_KEYS}, "tn": 0}
            a["n"] += 1
            for k in TREND_KEYS:
                if k == "temp":
                    if p.get("temp") is not None:
                        a["sum"]["temp"] += p["temp"]
                        a["tn"] += 1
                else:
                    a["sum"][k] += p.get(k) or 0.0
            a["last"] = p

    @staticmethod
    def _avg(a: dict) -> dict:
        last = a["last"]
        out = {k: a["sum"][k] / a["n"] for k in TREND_KEYS if k != "temp"}
        out.update(ts=a["start"], temp=a["sum"]["temp"] / a["tn"] if a["tn"] else None,
                   mem_total=last.get("mem_total", 0.0), load=last.get("load", []))
        return out

    def series(self) -> List[dict]:
        """The finished steps and the one being filled."""
        with self._lock:
            out = list(self.points)
            if self._acc:
                out.append(self._avg(self._acc))
        return out
