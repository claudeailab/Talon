"""Print the GitHub release notes for one version.

Usage: python3 .github/scripts/release_notes.py <version> <owner/repo>

Notes are the version's bullet points from CHANGELOG.md plus a link to the
full changelog. Without a CHANGELOG.md entry, the commit subjects since the
previous release are used instead.
"""
import re
import subprocess
import sys


def vkey(tag):
    return tuple(int(x) for x in re.findall(r"\d+", tag))


def git(*args):
    return subprocess.run(["git", *args], check=True, capture_output=True, text=True).stdout


version, repo = sys.argv[1], sys.argv[2]
tag = f"v{version}"

with open("CHANGELOG.md", encoding="utf-8") as f:
    changelog = f.read()
m = re.search(rf"^## {re.escape(version)}[ \t]*\n(.*?)(?=^## |\Z)", changelog, re.M | re.S)
bullets = [l for l in (m.group(1).splitlines() if m else []) if l.startswith("- ")]

older = sorted((t for t in git("tag", "-l", "v*").split() if re.fullmatch(r"v\d+(\.\d+)*", t)
                and vkey(t) < vkey(tag)), key=vkey)
prev = older[-1] if older else None

if not bullets:
    rev = f"{prev}..HEAD" if prev else "HEAD"
    for subject in git("log", "--no-merges", "--format=%s", rev).splitlines():
        for part in subject.split("; "):
            part = part.strip()
            if part and not re.match(r"(?i)release \d", part):
                bullets.append(f"- {part[0].upper()}{part[1:]}")

print("\n".join(bullets))
print()
if prev:
    print(f"**Full Changelog**: https://github.com/{repo}/compare/{prev}...{tag}")
else:
    print(f"**Full Changelog**: https://github.com/{repo}/commits/{tag}")
