from talon import raid

TB = 10**12


def avail(n):
    return {o["id"] for o in raid.options_for([4 * TB] * n) if o["available"]}


def test_levels_per_disk_count():
    assert avail(1) == {"single"}
    assert avail(2) == {"raid0", "raid1"}
    assert avail(3) == {"raid0", "raid1", "raid5"}
    assert avail(4) == {"raid0", "raid1", "raid5", "raid6", "raid10"}
    assert avail(50) == {"raid0", "raid1", "raid5", "raid6", "raid10"}
    assert avail(0) == set()


def test_capacity():
    s = [4 * TB] * 6
    assert raid.usable_capacity("raid0", s) == 24 * TB
    assert raid.usable_capacity("raid1", s) == 4 * TB
    assert raid.usable_capacity("raid5", s) == 20 * TB
    assert raid.usable_capacity("raid6", s) == 16 * TB
    assert raid.usable_capacity("raid10", s) == 12 * TB
    assert raid.usable_capacity("raid5", [4 * TB, 8 * TB, 4 * TB]) == 8 * TB


def test_spares():
    opts = {o["id"]: o for o in raid.options_for([4 * TB] * 4, spares=1)}
    assert opts["raid5"]["available"] and opts["raid5"]["usable_bytes"] == 8 * TB
    assert not opts["raid6"]["available"]          # only 3 data disks
    assert not opts["raid0"]["available"]          # raid0 has no spares
    assert raid.validate("raid1", 2, 1) is None


def test_recommendation():
    assert raid.recommended_level(1) == "single"
    assert raid.recommended_level(2) == "raid1"
    assert raid.recommended_level(4) == "raid5"
    assert raid.recommended_level(8) == "raid6"
