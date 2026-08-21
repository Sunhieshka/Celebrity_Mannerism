---
name: celebrity-mannerism
description: >-
  Turn uploaded performance footage into a character video that copies the
  performer's mannerisms, using DWPose skeleton extraction plus BytePlus Ark
  Seedance video generation. Use this whenever the user wants to drive a
  character/celebrity/avatar with someone's real body or facial motion,
  extract a pose/skeleton "drive video" from a clip, transfer mannerisms or a
  performance onto a character sheet, or generate a Seedance video from
  reference footage. Triggers on requests like "make this character move like
  in this video", "extract the pose skeleton from my clip", "drive my avatar
  with this performance", "generate a Seedance video of X doing these
  mannerisms", "mocap this footage", or "sync these assets to BytePlus and run
  Seedance". This is the CLI-driven form of the Actor Motion Studio pipeline.
---

# Celebrity Mannerism (motion transfer pipeline)

Reproduce a performer's mannerisms on a character by (1) extracting a DWPose
whole-body **skeleton drive video** from footage locally, then (2) generating a
**Seedance 2.5** video that renders a character sheet performing that motion.
The three bundled scripts in `scripts/` are the same runtimes the Actor Motion
Studio app spawns — this skill drives them directly from the command line, so no
web app or server is needed.

The pipeline has three stages. **Stage 1 is fully local and needs no
credentials** — always available. **Stages 2–3 call BytePlus Ark** and need API
keys; use them only when the user actually wants a rendered video and has
supplied credentials.

```
 footage.mp4 ──(1 pose_drive.py, local)──▶ *-skeleton.mp4  (the mannerism/drive video)
                                          └▶ *-overlay.mp4  (skeleton over source, a sanity check)

 skeleton.mp4 + character.png ──(2 asset_runtime.py, BytePlus)──▶ public URLs + Ark asset id
                                          │
                                          ▼
             ──(3 seedance_runtime.py, BytePlus Ark)──▶ Seedance task ──poll──▶ generated video URL
```

## Setup (once per environment)

The scripts need a Python 3.9 environment with the pinned deps, and `ffmpeg` on
`PATH` (Stage 1 re-encodes to H.264 so browsers/tools can read the output).

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt   # requirements.txt sits next to this SKILL.md
```

Run every script with that interpreter (`.venv/bin/python scripts/<name>.py …`).
Stage 1 pulls RTMPose ONNX weights from the network on first run and caches them.
`requirements.txt` deliberately omits PyTorch — `pose_drive.py` runs `rtmlib` with
`backend="onnxruntime"`, so nothing here needs torch.

## Stage 1 — Extract the mannerism skeleton (local, no credentials)

This is the heart of "copy the mannerisms": it tracks the primary subject's
whole-body pose (body, hands, face) frame by frame and paints an OpenPose-style
skeleton. That skeleton video is what later drives the character.

```bash
.venv/bin/python scripts/pose_drive.py <input-video> \
  --out-dir <output-dir> \
  --mode balanced          # performance (most accurate/slow) | balanced | lightweight (fastest)
```

Produces, in `--out-dir` (defaults alongside the input):

- `<name>-skeleton.mp4` — skeleton on black. **This is the drive video** you pass
  to Seedance as a body or facial reference.
- `<name>-overlay.mp4` — the same skeleton drawn over the original frames, so you
  (or the user) can eyeball whether tracking held before spending a generation.

Useful flags: `--kpt-thr 0.43` (raise to drop low-confidence joints/jitter),
`--all-people` (keep everyone; default keeps only the primary subject, tracked
across frames so it doesn't hop to background people), `--no-overlay` /
`--no-skeleton` to emit just one output. For separate body and facial motion,
run it once on a full-body clip and once on a face clip.

Read `references/pose-drive.md` for how subject tracking and the modes behave,
and how to debug empty or jittery skeletons.

## Stage 2 — Sync assets to BytePlus (needs credentials)

Seedance references media by **public URL** (drive videos) and by **Ark asset**
(the character sheet). `scripts/asset_runtime.py` uploads to TOS object storage
and registers Ark assets. Set the env vars first (see
`references/seedance-pipeline.md` for the full table); minimally
`BYTEPLUS_AK`/`BYTEPLUS_SK` and `TOS_BUCKET_NAME`.

Register the character sheet as an Ark asset (creates a group if you omit
`--group-id`):

```bash
.venv/bin/python scripts/asset_runtime.py create-asset-from-file \
  --file-path character.png --asset-type Image \
  --group-name "my-character" --key-hint character
# → {"group_id","asset_id","asset_url","object_key"}   (asset_url feeds Stage 3's --image-asset-uri)
```

Upload each skeleton drive video to get a public URL:

```bash
.venv/bin/python scripts/asset_runtime.py upload-file \
  --file-path body-skeleton.mp4 --key-hint body --group-id <group_id>
# → {"object_key","url","content_type"}                (url feeds --body/facial-reference-video-url)
```

Both commands print a single JSON object on stdout — capture and parse it. Errors
print `{"error": "..."}` to stderr with a non-zero exit.

## Stage 3 — Generate the Seedance video (needs credentials)

`scripts/seedance_runtime.py` wraps the Ark Seedance task API. Needs `ARK_API_KEY`
(and optionally `ARK_BASE_URL`). Create the task, then poll `get` until it
reports done.

```bash
.venv/bin/python scripts/seedance_runtime.py create \
  --model "$SEEDANCE_MODEL" \
  --prompt "<describe the character performing the motion>" \
  --image-asset-uri "<asset_url from Stage 2>" \
  --body-reference-video-url "<uploaded body skeleton url>" \
  --facial-reference-video-url "<uploaded facial skeleton url>" \
  --ratio 9:16 --resolution 720p --duration 10
# → JSON containing the task id

.venv/bin/python scripts/seedance_runtime.py get --task-id <id>
# → JSON with status; poll every few seconds until status is succeeded/failed
```

`create` requires the image plus both a body and a facial reference URL. If the
user has only body motion, pass the body skeleton URL for both, or point
`--facial-reference-video-url` at the same clip. Extra `--reference-image-url`,
`--reference-video-url`, and `--reference-audio-url` (repeatable) attach more
references. See `references/seedance-pipeline.md` for the env-var table, ratio /
resolution / duration options, and the full task JSON shape.

## Working with a user end-to-end

1. **Always start with Stage 1** and show the user the `-overlay.mp4` so they can
   confirm the mannerisms were captured before any paid generation. Motion
   quality here caps everything downstream — a bad skeleton makes a bad video.
2. **Stop after Stage 1 unless the user wants a rendered character video** and has
   BytePlus/Ark credentials. Don't assume credentials exist; ask, and if they're
   absent, deliver the skeleton/overlay and explain Stages 2–3 need Ark access.
3. **Capture the JSON** from Stages 2–3 (ids and URLs); each stage's output is the
   next stage's input. Keep the character `asset_url` and the drive-video URLs.
4. **Poll, don't block.** After `create`, call `get` on an interval rather than
   assuming instant completion; report the status URL/id to the user.

## Notes and guardrails

- **Consent and likeness.** Motion transfer and character generation can recreate
  a real person's look or performance. Use it for footage the user has the right
  to (their own performance, licensed/consented material, clearly-labeled
  parody/fan work). Don't generate deceptive deepfakes of real, identifiable
  people presented as authentic, or non-consensual/explicit likenesses. If a
  request looks like impersonation meant to deceive, check with the user.
- **Cost.** Stage 3 hits a paid generation API. Confirm before kicking off long
  or high-resolution jobs, and prefer a short `--duration` first pass.
- **These scripts are copied verbatim** from the Actor Motion Studio app
  (`apps/actor-studio/server`); their CLI contracts match that app. If you have
  the full workspace checked out, you can also run the app per its
  `actor-studio-dev` skill instead of using this standalone skill.
