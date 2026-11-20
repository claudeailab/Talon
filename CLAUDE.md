# Talon – repository rules

## Git workflow (owner's standing instruction)
- Every change is committed and pushed **directly to `main`** automatically. No pull requests.
- Do not keep other branches: if a session starts on a different branch, merge its work into
  `main`, push `main`, then delete that branch locally and on `origin`.
- After every push, delete **all** leftover non-`main` branches on `origin` (including ones from
  other sessions) once their commits are contained in `main`.
- Raise `__version__` in `backend/talon/__init__.py` with **every** change (patch bump, e.g.
  1.0.1 → 1.0.2), so each change is published as a release.
- Add a `## <version>` section to the top of `CHANGELOG.md` with 1–3 short bullet points
  ("- Shorter install command"). They become the GitHub release notes.
- The project is named **Talon** and lives at `claudeailab/Talon`. Never use the old names.

## Before pushing
- `cd backend && python -m pytest -q tests`
- `shellcheck -S warning install.sh uninstall.sh`
- If anything in `frontend/` changed: `cd frontend && npm run build` and commit `backend/talon/web/`
  (the installer ships the pre-built UI; CI fails if it is stale).
- Raise `__version__` in `backend/talon/__init__.py` (see above); the Release workflow tags and
  releases it on push to `main` by itself. Do not also start it manually.

## Automation
`.github/workflows/auto-merge.yml` merges any pushed non-main branch into `main` and deletes it,
so even a session that can only push to its own branch ends up on `main`.
