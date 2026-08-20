#!/usr/bin/env python3
"""Video -> skeleton pose-drive video (DWPose/RTMPose whole-body via rtmlib).

Outputs the OpenPose-style RGB skeleton the pose-driven generation stack expects:
  <name>-skeleton.mp4  - skeleton on black (the drive video)
  <name>-overlay.mp4   - skeleton over the source frames (sanity check)

Usage:
  python3 pose_drive.py input.mov [--out-dir DIR] [--mode balanced|performance|lightweight]
"""

import argparse
import os
import subprocess
import sys

import cv2
import numpy as np
from rtmlib import Wholebody, draw_skeleton


def main():
    ap = argparse.ArgumentParser(
        description="Extract a skeleton pose-drive video (DWPose-style whole-body)."
    )
    ap.add_argument("input")
    ap.add_argument("--out-dir", default=None, help="default: alongside the input")
    ap.add_argument(
        "--mode",
        default="balanced",
        choices=["performance", "balanced", "lightweight"],
    )
    ap.add_argument(
        "--kpt-thr", type=float, default=0.43, help="keypoint confidence threshold"
    )
    ap.add_argument(
        "--all-people",
        action="store_true",
        help="keep every detected person (default: only the primary subject)",
    )
    ap.add_argument(
        "--no-skeleton",
        action="store_true",
        help="skip skeleton reference generation",
    )
    ap.add_argument(
        "--no-overlay",
        action="store_true",
        help="skip overlay reference generation",
    )
    args = ap.parse_args()

    generate_skeleton = not args.no_skeleton
    generate_overlay = not args.no_overlay
    if not generate_skeleton and not generate_overlay:
        sys.exit("At least one output must be enabled.")

    cap = cv2.VideoCapture(args.input)
    if not cap.isOpened():
        sys.exit(f"Cannot open {args.input}")

    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

    base = os.path.splitext(os.path.basename(args.input))[0].replace(" ", "_")
    out_dir = args.out_dir or os.path.dirname(os.path.abspath(args.input))
    os.makedirs(out_dir, exist_ok=True)
    skel_raw = os.path.join(out_dir, f"{base}-skeleton-raw.mp4")
    over_raw = os.path.join(out_dir, f"{base}-overlay-raw.mp4")

    model = Wholebody(
        to_openpose=True, mode=args.mode, backend="onnxruntime", device="cpu"
    )
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    w_skel = (
        cv2.VideoWriter(skel_raw, fourcc, fps, (w, h)) if generate_skeleton else None
    )
    w_over = (
        cv2.VideoWriter(over_raw, fourcc, fps, (w, h)) if generate_overlay else None
    )

    # Keep the main subject stable across frames instead of switching to
    # background people when multiple bodies are visible.
    prev_center = None

    def pick_primary(keypoints, scores):
        nonlocal prev_center
        if len(keypoints) <= 1:
            return keypoints, scores
        best, best_val = 0, -1e18
        for p in range(len(keypoints)):
            valid = keypoints[p][scores[p] > args.kpt_thr]
            if len(valid) < 4:
                continue
            area = float(
                (valid[:, 0].max() - valid[:, 0].min())
                * (valid[:, 1].max() - valid[:, 1].min())
            )
            center = valid.mean(axis=0)
            dist = (
                float(np.linalg.norm(center - prev_center))
                if prev_center is not None
                else 0.0
            )
            val = area - dist * max(w, h) * 0.5
            if val > best_val:
                best, best_val = p, val
        sel = keypoints[best][scores[best] > args.kpt_thr]
        if len(sel):
            prev_center = sel.mean(axis=0)
        return keypoints[best : best + 1], scores[best : best + 1]

    n = 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        keypoints, scores = model(frame)
        if not args.all_people:
            keypoints, scores = pick_primary(keypoints, scores)
        if generate_skeleton:
            black = np.zeros_like(frame)
            w_skel.write(
                draw_skeleton(
                    black,
                    keypoints,
                    scores,
                    openpose_skeleton=True,
                    kpt_thr=args.kpt_thr,
                )
            )
        if generate_overlay:
            w_over.write(
                draw_skeleton(
                    frame.copy(),
                    keypoints,
                    scores,
                    openpose_skeleton=True,
                    kpt_thr=args.kpt_thr,
                )
            )
        n += 1
        if n % 20 == 0:
            print(f"  {n}/{total} frames", flush=True)

    cap.release()
    if w_skel is not None:
        w_skel.release()
    if w_over is not None:
        w_over.release()

    # Re-encode mp4v -> h264 so browsers and downstream tools can read the files.
    outputs = []
    if generate_skeleton:
        outputs.append((skel_raw, "skeleton"))
    if generate_overlay:
        outputs.append((over_raw, "overlay"))

    for raw, name in outputs:
        final = os.path.join(out_dir, f"{base}-{name}.mp4")
        subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-loglevel",
                "error",
                "-i",
                raw,
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                "-crf",
                "18",
                final,
            ],
            check=True,
        )
        os.remove(raw)
        print(final)


if __name__ == "__main__":
    main()
