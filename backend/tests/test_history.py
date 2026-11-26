import time

from talon.history import History, _merge


def test_tiers_average_and_keep_peaks(tmp_path):
    h = History(str(tmp_path / "h.json"), flush_every=10**9)
    t0 = 1_700_000_000 - 1_700_000_000 % 3600
    for i in range(0, 3 * 3600, 2):                  # three hours of 2-second samples
        h.add({"ts": t0 + i, "cpu": 90.0 if i == 100 else 10.0, "mem": 30.0})
    minutes = h.tiers["minute"]
    assert len(minutes) == 3 * 60 - 1                  # the last minute is still being added up
    first = minutes[1]
    assert first["cpu"] > 10 and first["cpu^"] == 90.0 and first["mem"] == 30.0
    assert len(h.tiers["quarter"]) == 11 and len(h.tiers["hour"]) == 2
    h.flush()
    again = History(str(tmp_path / "h.json"))
    assert len(again.tiers["minute"]) == len(minutes)


def test_merge_and_forecast(tmp_path):
    pts = [{"ts": i, "cpu": float(i), "cpu^": float(i)} for i in range(10)]
    m = _merge(pts, 5)
    assert [p["cpu"] for p in m] == [2.0, 7.0] and [p["cpu^"] for p in m] == [4.0, 9.0]
    h = History(str(tmp_path / "h.json"))
    now = time.time()
    h.tiers["hour"] = [{"ts": now - (100 - i) * 3600, "vol:tank": 1e12 + i * 1e9} for i in range(100)]
    f = h.forecast("vol:tank", 2e12)
    assert abs(f["per_month"] - 24e9 * 30) < 1e9 and 30 < f["full_in_days"] < 50


def test_history_api(client):
    r = client.get("/api/history", params={"range": "7d"}).json()
    assert r["step"] == 900 and len(r["points"]) > 600 and "cpu^" in r["points"][0]
    assert r["disks"] and r["volumes"]
    assert any(v["forecast"] for v in r["volumes"].values())
    assert client.get("/api/history", params={"range": "1y"}).json()["step"] == 21600


def test_trend_steps_and_seed():
    from talon.history import Trend
    t = Trend(step=20, keep=90)
    # after a restart: the last half hour of the saved per-minute history, each minute as three steps
    now = 100_000.0
    minutes = [{"ts": now - 3600, "cpu": 99.0, "mem": 50.0},                      # too old
               {"ts": now - 120, "cpu": 10.0, "mem": 40.0, "rx": 100.0},
               {"ts": now - 60, "cpu": 20.0, "mem": 42.0}]
    t.seed(minutes, now)
    s = t.series()
    assert len(s) == 6 and [p["cpu"] for p in s] == [10.0] * 3 + [20.0] * 3
    assert s[0]["mem_used"] / s[0]["mem_total"] == 0.4 and s[0]["rx"] == 100.0 and s[3]["rx"] == 0.0
    # 2-second samples are averaged into 20-second steps; the step being filled is included
    for i in range(15):                                                               # 30 s
        t.add({"ts": now + i * 2, "cpu": 10.0 if i < 10 else 40.0, "mem_used": 1.0, "mem_total": 4.0,
               "temp": 50.0, "load": [0.1], "rx": 0.0, "tx": 0.0, "read": float(i), "write": 0.0})
    s = t.series()
    assert len(s) == 8 and s[-2]["ts"] == now and s[-2]["cpu"] == 10.0 and s[-2]["read"] == 4.5
    assert s[-1]["ts"] == now + 20 and s[-1]["cpu"] == 40.0 and s[-1]["temp"] == 50.0 and s[-1]["mem_total"] == 4.0


def test_stats_api(client):
    import time as _t
    _t.sleep(2.5)                                       # one sample at least
    st = client.get("/api/stats").json()
    assert st["now"] and "cpu" in st["now"] and st["history"]
    d = client.get("/api/dashboard").json()
    assert d["history"] and "now" in d
