# Stage 1 reference — `pose_drive.py`

DWPose-style whole-body pose extraction via `rtmlib` (an `onnxruntime`-backed
RTMPose reimplementation). Fully local; the only external dependency at runtime
is `ffmpeg` on `PATH` for the final H.264 re-encode. First run downloads and
caches the RTMPose ONNX weights.

## CLI

```
python pose_drive.py INPUT [--out-dir DIR] [--mode MODE] [--kpt-thr FLOAT]
                           [--all-people] [--no-skeleton] [--no-overlay]
```

| Argument | Default | Meaning |
| --- | --- | --- |
| `INPUT` | — | Source video (any format OpenCV can open: mp4, mov, …). |
| `--out-dir` | alongside input | Where the outputs are written (created if missing). |
| `--mode` | `balanced` | `performance` (most accurate, slowest), `balanced`, `lightweight` (fastest, roughest). |
| `--kpt-thr` | `0.43` | Keypoint confidence threshold. Raise to drop jittery low-confidence joints; lower to keep more (noisier) detail. |
| `--all-people` | off | Keep every detected person. Default keeps only the primary subject. |
| `--no-skeleton` | off | Skip `-skeleton.mp4`. |
| `--no-overlay` | off | Skip `-overlay.mp4`. At least one output must remain enabled. |

## Outputs

For input `clip.mov` with `--out-dir out/`:

- `out/clip-skeleton.mp4` — OpenPose-style skeleton on a black background. This is
  the **drive video** for downstream generation.
- `out/clip-overlay.mp4` — the same skeleton drawn over the original frames. Use
  it to confirm tracking quality before spending a generation.

Spaces in the base name are replaced with `_`. Files are written first with the
`mp4v` codec then re-encoded to H.264 (`libx264`, `yuv420p`, `crf 18`); the raw
intermediates are deleted.

## Primary-subject tracking

When multiple people are visible and `--all-people` is off, the script picks one
subject per frame by scoring each detected person on **bounding-box area minus
movement from the previous frame's center** (`area - dist * max(w,h) * 0.5`).
This keeps the skeleton locked to the main, foreground performer instead of
hopping to background people. Only keypoints above `--kpt-thr` count toward the
area/center computation, and a person with fewer than 4 valid keypoints is
skipped.

## Progress and debugging

- Prints `  N/TOTAL frames` every 20 frames, then the final path(s) on completion.
- **Empty / mostly-black skeleton:** subject too small, too dark, or heavily
  occluded — try `--mode performance`, lower `--kpt-thr`, or a clearer clip.
- **Skeleton jumps between people:** raise `--kpt-thr`, or crop the source to the
  intended subject.
- **`Cannot open <input>`:** OpenCV can't read the container/codec — transcode to
  a standard H.264 mp4 first.
- **ffmpeg error at the end:** `ffmpeg` isn't installed or not on `PATH`; the pose
  pass succeeded but the H.264 re-encode failed.

## Body vs. facial drive videos

Seedance can take a separate body and facial reference. Produce them by running
the script twice: once on a full-body clip (body mannerisms) and once on a
tighter face clip (facial mannerisms). If you only have one clip, its skeleton
can serve as both references.
