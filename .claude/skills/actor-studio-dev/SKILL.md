---
name: actor-studio-dev
description: Set up, run, and troubleshoot the actor-studio app in this dwpose workspace (apps/actor-studio client+server, shared .venv). Use this whenever the user asks to run/start/launch actor-studio, set up or bootstrap this project from a fresh clone, install dependencies, fix "python not found" / pose_drive / skeleton-generation errors, or asks what the folder layout means. Also use it before making changes that touch server/index.js path resolution, .env, or the .venv location, since those are wired together by relative paths that are easy to break.
---

# actor-studio dev workflow

This workspace is a small monorepo: `apps/actor-studio` (the app) locates
`.venv` (a shared Python environment) through a **relative path computed at
runtime** in
[apps/actor-studio/server/index.js](../../apps/actor-studio/server/index.js) — see
`WORKSPACE_ROOT` near the top of the file. `.venv` is the thing to protect: it must
stay a sibling of `apps/` at the workspace root, in this exact shape:

```text
dwpose/
├── .venv/                 shared Python env for pose_drive.py, seedance_runtime.py, asset_runtime.py
├── requirements.txt       pip freeze of .venv — reproduce with `pip install -r requirements.txt`
└── apps/
    └── actor-studio/
        ├── server/        Express API + pose_drive.py/seedance_runtime.py/asset_runtime.py
        ├── client/        Vite/React UI
        └── projects/      user data, gitignored
```

`pose_drive.py` runs RTMPose whole-body inference via `rtmlib` (an
`onnxruntime`-backed reimplementation of DWPose) — there is no vendored DWPose
source in this repo, and none is needed.

If you ever move or rename `.venv`, grep `apps/actor-studio/server/index.js` for
`WORKSPACE_ROOT` and `PYTHON_BIN` and update the relative `path.resolve(...)`
segments to match — the app will fail silently (500s on skeleton generation)
rather than crash at boot if these drift.

## First-time setup (fresh clone)

Run from the workspace root (`dwpose/`):

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
npm install --prefix apps/actor-studio/client
npm install --prefix apps/actor-studio/server
npm install --prefix apps/actor-studio
cp apps/actor-studio/.env.example apps/actor-studio/.env
```

Then open `apps/actor-studio/.env` and fill in whichever keys the user actually
needs (BytePlus/TOS asset sync, Seedance/Ark generation, etc. — see
[apps/actor-studio/README.md](../../apps/actor-studio/README.md) for what each key does).
Nothing needs to be filled in just to run the app and generate skeleton videos locally.

## Running it

```bash
npm run dev --prefix apps/actor-studio
```

This runs `concurrently` to start the Express server (nodemon, port 8787) and the
Vite client (port 5173) together. Prefer this over starting them separately unless
you're debugging one side in isolation — in that case:

```bash
npm run dev --prefix apps/actor-studio/server   # API only, :8787
npm run dev --prefix apps/actor-studio/client   # UI only, :5173
```

To sanity-check the server booted and can see its Python runtime and scripts:

```bash
curl -s http://localhost:8787/api/health
```

This reports `pythonExists`, `poseScriptExists`, `seedanceScriptExists`, and
`assetScriptExists` — check it first if skeleton generation or Seedance calls
fail with a spawn error.

## Common failure modes

- **Skeleton generation fails / "spawn ENOENT"** — almost always `.venv` isn't
  where `WORKSPACE_ROOT`-relative resolution expects it, or it doesn't have the
  right interpreter symlinked (`.venv/bin/python`). Re-run `python3 -m venv .venv`
  if it's missing entirely. Check `GET /api/health` first — it reports
  `pythonExists`/`poseScriptExists`/`seedanceScriptExists`/`assetScriptExists`.
- **`ModuleNotFoundError: rtmlib` (or cv2/torch/onnxruntime)** — `.venv` exists but
  wasn't installed from `requirements.txt`. Re-run the pip install step above.
- **Server can't find `.env` values** — `.env` must live at
  `apps/actor-studio/.env`, not the workspace root; `index.js` loads it via
  `path.resolve(__dirname, '..', '.env')`.
- **New dependency needed for `pose_drive.py`/`seedance_runtime.py`/`asset_runtime.py`** —
  install it into `.venv`, then refresh the lockfile: `.venv/bin/pip freeze > requirements.txt`.

## Project data

`apps/actor-studio/projects/<slug>/` holds real user-uploaded content (motion
reference videos, character sheets, generated skeletons) — it's gitignored and
not sample data. Don't restructure, rename, or clean it up without asking; the
app's own file-management routes are the intended way to modify it.
