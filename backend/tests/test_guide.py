"""Every screenshot the Support guide refers to ships with the pre-built web UI."""
import os
import re

ROOT = os.path.join(os.path.dirname(__file__), "..", "..")


def test_guide_screenshots_exist():
    with open(os.path.join(ROOT, "frontend", "src", "lib", "guide.ts")) as f:
        names = set(re.findall(r'img: "([\w-]+)"', f.read()))
    assert names
    web = os.path.join(ROOT, "backend", "talon", "web", "guide")
    missing = [n for n in names if not os.path.isfile(os.path.join(web, f"{n}.webp"))]
    assert not missing, f"missing guide screenshots: {missing}"
