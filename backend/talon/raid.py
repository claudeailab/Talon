"""RAID level rules: which layouts are possible for a set of disks and
what capacity / fault tolerance each one gives.

All levels map 1:1 onto Linux md (mdadm).  ``single`` means "no RAID":
one disk with a filesystem directly on its partition.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Dict, List, Optional


@dataclass(frozen=True)
class RaidLevel:
    id: str
    label: str
    min_disks: int
    max_disks: Optional[int]
    supports_spares: bool
    description: str
    read_perf: int   # 1..5 relative indication used by the UI
    write_perf: int  # 1..5


LEVELS: Dict[str, RaidLevel] = {
    "single": RaidLevel("single", "Single disk", 1, 1, False,
                        "One disk, no redundancy. If the disk fails, its data is lost.", 2, 2),
    "raid0": RaidLevel("raid0", "RAID 0 (stripe)", 2, None, False,
                       "Data striped across all disks. Fastest and full capacity, "
                       "but ONE failed disk destroys the whole volume.", 5, 5),
    "raid1": RaidLevel("raid1", "RAID 1 (mirror)", 2, None, True,
                       "Every disk holds an identical copy. Survives the loss of all "
                       "but one disk. Capacity of one disk.", 3, 2),
    "raid5": RaidLevel("raid5", "RAID 5 (single parity)", 3, None, True,
                       "Striping with one disk worth of parity. Survives one disk failure.", 4, 3),
    "raid6": RaidLevel("raid6", "RAID 6 (double parity)", 4, None, True,
                       "Striping with two disks worth of parity. Survives any two disk failures.", 4, 2),
    "raid10": RaidLevel("raid10", "RAID 10 (striped mirrors)", 4, None, True,
                        "Mirrored pairs striped together. Fast, survives at least one "
                        "disk failure (one per mirror pair). Half the raw capacity.", 5, 4),
}

MD_LEVEL = {"raid0": "0", "raid1": "1", "raid5": "5", "raid6": "6", "raid10": "10"}


def usable_capacity(level: str, sizes: List[int]) -> int:
    """Usable bytes for ``level`` built from data disks of ``sizes`` (spares excluded).
    md uses the smallest member size on every member."""
    n = len(sizes)
    if n == 0:
        return 0
    smallest = min(sizes)
    if level == "single":
        return sizes[0]
    if level == "raid0":
        return smallest * n
    if level == "raid1":
        return smallest
    if level == "raid5":
        return smallest * (n - 1)
    if level == "raid6":
        return smallest * (n - 2)
    if level == "raid10":
        return smallest * n // 2  # near=2 layout
    raise ValueError(level)


def fault_tolerance(level: str, n: int) -> int:
    """Number of disks that may fail (worst case) without data loss."""
    return {"single": 0, "raid0": 0, "raid1": n - 1, "raid5": 1, "raid6": 2,
            "raid10": 1}[level]


def recommended_level(n: int) -> Optional[str]:
    if n <= 0:
        return None
    if n == 1:
        return "single"
    if n == 2:
        return "raid1"
    if n <= 5:
        return "raid5"
    return "raid6"


def validate(level: str, data_disks: int, spares: int) -> Optional[str]:
    """Return an error message, or None when the combination is valid."""
    lv = LEVELS.get(level)
    if lv is None:
        return f"Unknown RAID level {level!r}"
    if data_disks < lv.min_disks:
        return f"{lv.label} needs at least {lv.min_disks} disk(s)"
    if lv.max_disks is not None and data_disks > lv.max_disks:
        return f"{lv.label} supports at most {lv.max_disks} disk(s)"
    if spares < 0:
        return "Spare count cannot be negative"
    if spares and not lv.supports_spares:
        return f"{lv.label} does not use hot spares"
    return None


def options_for(sizes: List[int], spares: int = 0) -> List[dict]:
    """Describe every RAID level for the given selection (sizes of all
    selected disks; the last ``spares`` disks are hot spares)."""
    total = len(sizes)
    data = sizes[: total - spares] if spares else list(sizes)
    raw = sum(sizes)
    out = []
    rec = recommended_level(len(data))
    for lv in LEVELS.values():
        err = validate(lv.id, len(data), spares)
        usable = usable_capacity(lv.id, data) if err is None else 0
        warnings = []
        if err is None and data and len(set(data)) > 1 and lv.id != "single":
            wasted = sum(data) - min(data) * len(data)
            warnings.append(f"Disks differ in size: {wasted} bytes of raw capacity will be unused")
        if err is None and lv.id == "raid0":
            warnings.append("No redundancy: any disk failure loses all data")
        if err is None and lv.id == "raid5" and data and min(data) >= 8 * 10**12:
            warnings.append("Large disks: RAID 6 is safer during long rebuilds")
        out.append({
            **asdict(lv),
            "available": err is None,
            "reason": err,
            "usable_bytes": usable,
            "raw_bytes": raw,
            "fault_tolerance": fault_tolerance(lv.id, len(data)) if err is None else 0,
            "recommended": lv.id == rec and err is None,
            "warnings": warnings,
        })
    return out
