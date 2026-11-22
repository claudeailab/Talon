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
