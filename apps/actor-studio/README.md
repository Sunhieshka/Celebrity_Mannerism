# Actor Motion Studio

React (Vite) + Express application for organizing actor reference projects,
generating DWPose skeleton-drive videos from uploaded footage, syncing
reference assets to a BytePlus asset library, and driving Seedance 2.5 video
generation from those assets.

Part of the [`dwpose`](../../README.md) workspace — see that README for
repository-wide setup and layout.

## Contents

- [Run locally](#run-locally)
- [Configuration](#configuration)
- [Project data layout](#project-data-layout)
- [How skeleton generation works](#how-skeleton-generation-works)
- [Character sheet asset sync](#character-sheet-asset-sync)
- [Seedance 2.5 generation](#seedance-25-generation)

## Run locally

From the workspace root (`dwpose/`), with `.venv` already set up per the
[root README](../../README.md#setup):

```bash
cp apps/actor-studio/.env.example apps/actor-studio/.env
npm run dev --prefix apps/actor-studio
```

Or start each side independently:

```bash
npm run dev --prefix apps/actor-studio/server   # Express API on :8787
npm run dev --prefix apps/actor-studio/client   # Vite dev server on :5173
```

| Service | URL |
| --- | --- |
| UI | `http://localhost:5173` |
| API | `http://localhost:8787` |

## Configuration

All configuration lives in `apps/actor-studio/.env` (copy from `.env.example`).
Nothing is required to run the app and generate skeleton videos locally — the
sections below are additive, feature-gated capabilities.

| Variable | Required for | Notes |
| --- | --- | --- |
| `PORT` | — | API port, defaults to `8787` |
| `VITE_API_BASE_URL` | — | API base URL the client calls |
| `BYTEPLUS_AK` / `BYTEPLUS_SK` | Asset sync | BytePlus access credentials |
| `BYTEPLUS_REGION` | Asset sync | Defaults to `ap-southeast-1` |
| `TOS_REGION` / `TOS_BUCKET_NAME` / `TOS_ENDPOINT` | Asset sync | Object storage target for uploaded assets |
| `TOS_PREFIX` | Asset sync | Key prefix for uploaded objects, defaults to `ark-assets` |
| `TOS_PUBLIC_URL_PREFIX` | Asset sync, Seedance | Public URL prefix used to build shareable object URLs |
| `PUBLIC_BASE_URL` | Asset sync, Seedance | Public base URL of this deployment |
| `ARK_PROJECT` | Asset sync | Ark project name, defaults to `default` |
| `ARK_ASSET_MODERATION_STRATEGY` | Asset sync | Defaults to `Skip` |
| `ARK_API_KEY` | Asset sync, Seedance | Ark API credential |
| `ARK_BASE_URL` | Seedance | Ark API base URL |
| `SEEDANCE_MODEL` | Seedance | Model identifier used for generation requests |


## Project data layout

Each project is created under `apps/actor-studio/projects/<project-slug>/`:

```text
Motion references/
├── body/                  uploaded body-motion source videos
├── facial/                 uploaded facial-motion source videos
└── processed/              generated *-skeleton.mp4 and *-overlay.mp4 outputs
    ├── body/
    └── facial/
character sheets/           uploaded stills, PDFs, or art references
seedance references/
├── reference images/
├── reference videos/
└── reference audios/
.actor-studio.json           project metadata: synced asset IDs, Seedance job history
```

This directory holds real user-uploaded content — it's gitignored, and the
app's own file-management routes are the intended way to modify it.

## How skeleton generation works

Clicking `Generate skeleton` on a motion reference video runs, via the shared
workspace `.venv`:

```bash
.venv/bin/python server/pose_drive.py \
  <video-path> \
  --out-dir <project>/Motion references/processed \
  --mode <lightweight|balanced|performance>
```

`pose_drive.py` runs RTMPose whole-body inference via `rtmlib` (an
`onnxruntime`-backed reimplementation of DWPose) — it has no dependency on the
original DWPose/mmpose codebase. See `POSE_SCRIPT`/`PYTHON_BIN` in
[`server/index.js`](server/index.js) for path resolution.

## Character sheet asset sync

Uploading an image into `character sheets` triggers, via `server/asset_runtime.py`:

1. Creates an Ark asset group for the project if one doesn't already exist.
2. Uploads the image bytes to TOS.
3. Builds a public object URL from `TOS_PUBLIC_URL_PREFIX`.
4. Calls `CreateAsset` to register that TOS object in the asset library.

Generated motion-reference `.mp4` outputs go through the same TOS upload step,
and their public URLs are stored in the project's `.actor-studio.json` for use
as Seedance references.

## Seedance 2.5 generation

Via `server/seedance_runtime.py`:

1. Select one synced character sheet asset as `@Image1`.
2. Select one generated motion-reference video as `@Video1` (optionally a
   second as `@Video2` for facial motion).
3. Edit the prompt template and start generation.
4. The backend creates a Seedance task and polls it through the Ark runtime API.
