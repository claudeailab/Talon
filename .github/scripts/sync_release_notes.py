"""Update the notes of published releases whose CHANGELOG.md entry changed.

Usage: python3 .github/scripts/sync_release_notes.py <owner/repo>

Reads every release with one API call and edits only the ones that differ, so the
step takes seconds, not one round trip per version.
"""
import json
import os
import re
import subprocess
import sys
import tempfile

repo = sys.argv[1]
here = os.path.dirname(os.path.abspath(__file__))


def run(*args):
    return subprocess.run(args, check=True, capture_output=True, text=True).stdout


bodies = {}
for line in run("gh", "api", "--paginate", f"repos/{repo}/releases?per_page=100",
                "--jq", ".[] | [.tag_name, (.body // \"\")] | @json").splitlines():
    tag, body = json.loads(line)
    bodies[tag] = body

with open("CHANGELOG.md", encoding="utf-8") as f:
    versions = re.findall(r"^## ([0-9][0-9.]*)[ \t]*$", f.read(), re.M)

norm = lambda s: s.replace("\r\n", "\n").strip()  # noqa: E731
for v in versions:
    tag = f"v{v}"
    if tag not in bodies:
        continue
    notes = run(sys.executable, os.path.join(here, "release_notes.py"), v, repo)
    if norm(notes) == norm(bodies[tag]):
        continue
    with tempfile.NamedTemporaryFile("w", suffix=".md", delete=False, encoding="utf-8") as f:
        f.write(notes)
    run("gh", "release", "edit", tag, "--repo", repo, "--notes-file", f.name)
    os.unlink(f.name)
    print(f"{tag}: notes updated")
