# dwpose

Actor Motion Studio — a pipeline for turning uploaded performance footage into
DWPose-style skeleton-drive videos (via `rtmlib`, an `onnxruntime`-based
reimplementation of DWPose), syncing reference assets to a BytePlus asset
library, and generating Seedance videos from them.

## Repository layout

```text
dwpose/
├── apps/
│   └── actor-studio/       React (Vite) client + Express API — the application. See its README.
├── .venv/                   Shared Python 3.9 environment used by every server-spawned
│                             script (pose_drive.py, seedance_runtime.py, asset_runtime.py).
├── requirements.txt         Pinned dependencies for .venv (pip freeze).
└── .claude/skills/          Project skill for Claude Code covering setup/run/troubleshoot.
```

`.venv` is the one thing shared across the workspace: `apps/actor-studio/server`
locates it via a relative path computed from the workspace root at startup —
see `WORKSPACE_ROOT` in
[`apps/actor-studio/server/index.js`](apps/actor-studio/server/index.js). Keep
`.venv` a sibling of `apps/` at the repository root, or update that constant.

## Prerequisites

- Node.js 18+ and npm
- Python 3.9
- A BytePlus / Ark account if you need asset-library sync or Seedance generation
  (optional for local skeleton generation only)

## Setup

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt

npm install --prefix apps/actor-studio
npm install --prefix apps/actor-studio/client
npm install --prefix apps/actor-studio/server

cp apps/actor-studio/.env.example apps/actor-studio/.env
```

Fill in `apps/actor-studio/.env` with the keys you need — nothing is required just
to run the app and generate skeleton videos locally. See
[`apps/actor-studio/README.md`](apps/actor-studio/README.md#configuration) for what
each key controls.

## Running

```bash
npm run dev --prefix apps/actor-studio
```

Starts the API on `http://localhost:8787` and the UI on `http://localhost:5173`.
Full operational docs — processing pipeline, asset sync, Seedance generation,
project data layout — live in
[`apps/actor-studio/README.md`](apps/actor-studio/README.md).

## Working with this repo in Claude Code

The `.claude/skills/actor-studio-dev` skill encodes this setup/run workflow and
the path-wiring constraints above, so Claude Code picks it up automatically for
setup, run, and troubleshooting requests in this workspace.
