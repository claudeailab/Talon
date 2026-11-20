# Talon – repository rules

## Git workflow (owner's standing instruction)
- Every change is committed and pushed **directly to `main`** automatically. No pull requests.
- Do not keep other branches: if a session starts on a different branch, merge its work into
  `main`, push `main`, then delete that branch locally and on `origin`.

## Before pushing
- `cd backend && python -m pytest -q tests`
- `shellcheck -S warning install.sh uninstall.sh`
- If anything in `frontend/` changed: `cd frontend && npm run build` and commit `backend/talon/web/`
  (the installer ships the pre-built UI; CI fails if it is stale).
- To publish an update to installed systems, raise `__version__` in `backend/talon/__init__.py`;
  the Release workflow tags and releases it on push to `main`.

## Automation
`.github/workflows/auto-merge.yml` merges any pushed non-main branch into `main` and deletes it,
so even a session that can only push to its own branch ends up on `main`.
