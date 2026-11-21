"""Scheduled tasks: schedules, running scripts, the API, and Entra secret reminders."""
import datetime
import os
import time

import pytest

from talon import scheduler as sch
from talon.util import UserError


def ts(y, mo, d, h=0, mi=0):
    return datetime.datetime(y, mo, d, h, mi).timestamp()


# ---------------------------------------------------------------- schedules
def test_fixed_schedules():
    after = ts(2026, 11, 20, 10, 0)                     # a Friday
    assert sch.next_run({"kind": "daily", "time": "02:00"}, after) == ts(2026, 11, 21, 2, 0)
    assert sch.next_run({"kind": "daily", "time": "11:30"}, after) == ts(2026, 11, 20, 11, 30)
    assert sch.next_run({"kind": "weekly", "weekday": 6, "time": "02:00"}, after) == ts(2026, 11, 22, 2, 0)
    assert sch.next_run({"kind": "monthly", "day": 1, "time": "03:00"}, after) == ts(2026, 12, 1, 3, 0)
    assert sch.next_run({"kind": "interval", "minutes": 60}, after) == after + 3600
    assert sch.next_run({"kind": "manual"}, after) is None
    assert sch.next_run({"kind": "startup"}, after) is None


def test_cron():
    after = ts(2026, 11, 20, 10, 7)
    assert sch.cron_next("*/15 * * * *", after) == ts(2026, 11, 20, 10, 15)
    assert sch.cron_next("30 2 * * *", after) == ts(2026, 11, 21, 2, 30)
    assert sch.cron_next("0 9 * * 1-5", after) == ts(2026, 11, 23, 9, 0)     # next Monday
    assert sch.cron_next("0 0 1 1 *", after) == ts(2027, 1, 1, 0, 0)
    assert sch.cron_next("0 4 * * 7", after) == ts(2026, 11, 22, 4, 0)       # 7 = Sunday
    for bad in ("", "* * * *", "61 * * * *", "* * * * mon", "*/0 * * * *"):
        with pytest.raises(UserError):
            sch.parse_cron(bad)


def test_labels():
    assert sch.schedule_label({"kind": "interval", "minutes": 360}) == "Every 6 hours"
    assert sch.schedule_label({"kind": "weekly", "weekday": 6, "time": "02:00"}) == "Weekly · Sunday 02:00"


# ---------------------------------------------------------------- execution
def test_execute_output_and_exit_code():
    out = []
    code = sch.execute("echo hello\necho oops >&2\nexit 3", "root", 30, out.append, lambda p: None)
    assert code == 3
    assert "hello\n" in out and "oops\n" in out


def test_execute_time_limit_stops_the_whole_script():
    out = []
    t0 = time.time()
    code = sch.execute("sleep 30 & wait", "root", 1, out.append, lambda p: None)
    assert code == 124 and time.time() - t0 < 10
    assert "time limit" in "".join(out)


# ---------------------------------------------------------------- API (demo)
def task(**kw):
    base = {"name": "Clean downloads", "script": "find /srv/nas/tank/Downloads -mtime +30 -delete",
            "run_as": "root", "timeout": 60, "schedule": {"kind": "daily", "time": "03:00"},
            "notify": True, "skip_if_running": True}
    return {**base, **kw}


def wait_idle(client, tid, timeout=10):
    end = time.time() + timeout
    while time.time() < end:
        t = next(x for x in client.get("/api/scheduled").json()["tasks"] if x["id"] == tid)
        if not t["running"] and t["last"]:
            return t
        time.sleep(0.2)
    raise AssertionError("task did not finish")


def test_scheduled_crud_run_and_history(client):
    data = client.get("/api/scheduled").json()
    assert data["tasks"] == [] and data["run_as"][0] == "root"
    t = client.post("/api/scheduled", json=task()).json()
    assert t["schedule_label"] == "Daily 03:00" and t["next_run"] and t["enabled"]
    assert client.post("/api/scheduled", json=task()).status_code == 400      # duplicate name
    assert client.post("/api/scheduled", json=task(name="x", script=" ")).status_code == 400
    assert client.post("/api/scheduled", json=task(name="x", run_as="nobody")).status_code == 400
    assert client.post("/api/scheduled", json=task(name="x", timeout=7)).status_code == 400
    assert client.post("/api/scheduled", json=task(name="x", schedule={"kind": "cron", "cron": "bad"})).status_code == 400

    assert client.post(f"/api/scheduled/{t['id']}/run").status_code == 200
    done = wait_idle(client, t["id"])
    assert done["last"]["status"] == "success"
    runs = client.get(f"/api/scheduled/{t['id']}/runs").json()
    assert runs[0]["exit_code"] == 0 and "Demo mode" in runs[0]["output"]

    paused = client.post(f"/api/scheduled/{t['id']}/pause").json()
    assert not paused["enabled"] and paused["next_run"] is None
    assert client.post(f"/api/scheduled/{t['id']}/resume").json()["enabled"]

    upd = client.put(f"/api/scheduled/{t['id']}", json=task(schedule={"kind": "cron", "cron": "0 4 * * 0"})).json()
    assert upd["schedule_label"] == "Custom · 0 4 * * 0"
    assert client.post("/api/scheduled/test", json=task()).json()["exit_code"] == 0
    assert client.delete(f"/api/scheduled/{t['id']}").status_code == 200
    assert client.get("/api/scheduled").json()["tasks"] == []


def test_schedule_fires_when_due(client):
    s = client.app.state.nas.scheduler
    t = client.post("/api/scheduled", json=task(name="Hourly", schedule={"kind": "interval", "minutes": 60})).json()
    s.tick(now=time.time() + 60)                       # not due yet
    assert not client.get("/api/scheduled").json()["tasks"][0]["running"]
    s.tick(now=time.time() + 3700)
    assert wait_idle(client, t["id"])["last"]["status"] == "success"


# ---------------------------------------------------------------- Entra secret expiry
def test_entra_secret_expiry_and_reminder(client):
    soon = (datetime.date.today() + datetime.timedelta(days=10)).isoformat()
    body = {"tenant": "common", "client_id": "11111111-2222-3333-4444-555555555555",
            "client_secret": "s", "secret_expires": soon, "remind_days": 30,
            "remind_to": "it@example.com, me@example.com"}
    r = client.put("/api/settings/entra", json=body).json()
    assert r["secret_expires"] == soon and r["remind_to"] == ["it@example.com", "me@example.com"]
    assert r["expiry"] == {"date": soon, "days": 10, "remind": True}
    alerts = client.get("/api/dashboard").json()["alerts"]
    assert any(a["title"] == "EntraID client secret expires in 10 days" for a in alerts)
    assert client.put("/api/settings/entra", json={**body, "secret_expires": "31-02-2028"}).status_code == 400
    eu = client.put("/api/settings/entra", json={**body, "secret_expires": "20-11-2028"}).json()
    assert eu["secret_expires"] == "2028-11-20"                     # dd-mm-yyyy accepted
    client.put("/api/settings/entra", json=body)
    assert client.put("/api/settings/entra", json={**body, "remind_days": 3}).status_code == 400

    nas = client.app.state.nas
    sent = []
    nas.notifier.send = lambda *a, **k: sent.append((a, k))
    nas.cloud.check_secret_expiry()                    # no SMTP server yet: waits
    assert not sent
    nas.state.update(lambda d: d.__setitem__("smtp", {"host": "smtp.example.com"}))
    nas.cloud.check_secret_expiry()
    nas.cloud.check_secret_expiry()                    # sent once only
    assert len(sent) == 1 and sent[0][1]["to"] == ["it@example.com", "me@example.com"]
    assert "expires in 10 days" in sent[0][0][2]
    assert datetime.date.fromisoformat(soon).strftime("%d-%m-%Y") in sent[0][0][1]

    later = (datetime.date.today() + datetime.timedelta(days=200)).isoformat()
    r = client.put("/api/settings/entra", json={**body, "secret_expires": later}).json()
    assert r["expiry"]["remind"] is False
    assert not any("client secret" in a["title"] for a in client.get("/api/dashboard").json()["alerts"])


def test_output_lines_carry_their_time(client):
    import re
    t = client.post("/api/scheduled", json=task(name="Stamped")).json()
    client.post(f"/api/scheduled/{t['id']}/run")
    wait_idle(client, t["id"])
    out = client.get(f"/api/scheduled/{t['id']}/runs").json()[0]["output"]
    lines = [ln for ln in out.split("\n") if ln]
    assert lines and all(re.match(r"^\d\d:\d\d:\d\d\t", ln) for ln in lines)


def test_progress_lines_update_the_bar_and_are_not_logged():
    out, prog = [], []
    script = ("printf 'copying\\n'\n"
              "printf '\\r   1,048,576  25%%    1.00MB/s    0:00:03  \\r   2,097,152  50%%    2.00MB/s    0:00:02  '\n"
              "printf '\\nfile2\\n'\n"
              "echo 'PROGRESS 75'\n")
    assert sch.execute(script, "root", 30, out.append, lambda p: None, prog.append) == 0
    assert "".join(out) == "copying\nfile2\n"
    assert [p["percent"] for p in prog] == [25, 50, 75]
    assert prog[1]["bytes"] == 2_097_152 and prog[1]["speed"] == 2 * 1024 ** 2 and prog[1]["eta"] == 2
    assert prog[2] == {"percent": 75.0, "source": "script"}
