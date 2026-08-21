#!/usr/bin/env python3
"""Thin CLI wrapper around the BytePlus Ark Seedance task APIs."""

import argparse
import json
import os
import sys
from typing import Any

from byteplussdkarkruntime import Ark


def to_plain(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, list):
        return [to_plain(item) for item in value]
    if isinstance(value, tuple):
        return [to_plain(item) for item in value]
    if isinstance(value, dict):
        return {key: to_plain(item) for key, item in value.items()}
    if hasattr(value, "model_dump"):
        return to_plain(value.model_dump())
    if hasattr(value, "dict"):
        return to_plain(value.dict())
    if hasattr(value, "__dict__"):
        return to_plain(
            {
                key: item
                for key, item in vars(value).items()
                if not key.startswith("_")
            }
        )
    return str(value)


def parse_bool(raw: str) -> bool:
    normalized = raw.strip().lower()
    if normalized in {"1", "true", "yes", "y", "on"}:
        return True
    if normalized in {"0", "false", "no", "n", "off"}:
        return False
    raise ValueError(f"Cannot parse boolean value: {raw}")


def create_client() -> Ark:
    api_key = os.environ.get("ARK_API_KEY")
    if not api_key:
        raise RuntimeError("ARK_API_KEY is required.")

    return Ark(
        base_url=os.environ.get(
            "ARK_BASE_URL", "https://ark.ap-southeast.bytepluses.com/api/v3"
        ),
        api_key=api_key,
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Seedance task runner")
    subparsers = parser.add_subparsers(dest="command", required=True)

    create_parser = subparsers.add_parser("create")
    create_parser.add_argument("--model", required=True)
    create_parser.add_argument("--prompt", required=True)
    create_parser.add_argument("--image-asset-uri", required=True)
    create_parser.add_argument("--body-reference-video-url", required=True)
    create_parser.add_argument("--facial-reference-video-url", required=True)
    create_parser.add_argument("--ratio", default="9:16")
    create_parser.add_argument("--resolution", default="720p")
    create_parser.add_argument("--duration", type=int, default=10)
    create_parser.add_argument("--generate-audio", default="true")
    create_parser.add_argument("--watermark", default="true")
    create_parser.add_argument("--return-last-frame", default="true")
    create_parser.add_argument("--reference-image-url", action="append", default=[])
    create_parser.add_argument("--reference-video-url", action="append", default=[])
    create_parser.add_argument("--reference-audio-url", action="append", default=[])

    get_parser = subparsers.add_parser("get")
    get_parser.add_argument("--task-id", required=True)

    args = parser.parse_args()
    client = create_client()

    if args.command == "create":
        content = [
            {
                "type": "text",
                "text": args.prompt,
            },
            {
                "type": "image_url",
                "image_url": {
                    "url": args.image_asset_uri,
                },
                "role": "reference_image",
            },
            {
                "type": "video_url",
                "video_url": {
                    "url": args.body_reference_video_url,
                },
                "role": "reference_video",
            },
            {
                "type": "video_url",
                "video_url": {
                    "url": args.facial_reference_video_url,
                },
                "role": "reference_video",
            },
        ]
        for url in args.reference_image_url:
            content.append(
                {
                    "type": "image_url",
                    "image_url": {"url": url},
                    "role": "reference_image",
                }
            )
        for url in args.reference_video_url:
            content.append(
                {
                    "type": "video_url",
                    "video_url": {"url": url},
                    "role": "reference_video",
                }
            )
        for url in args.reference_audio_url:
            content.append(
                {
                    "type": "audio_url",
                    "audio_url": {"url": url},
                    "role": "reference_audio",
                }
            )
        result = client.content_generation.tasks.create(
            model=args.model,
            content=content,
            generate_audio=parse_bool(args.generate_audio),
            ratio=args.ratio,
            resolution=args.resolution,
            duration=args.duration,
            watermark=parse_bool(args.watermark),
            return_last_frame=parse_bool(args.return_last_frame),
        )
        print(json.dumps(to_plain(result)))
        return 0

    if args.command == "get":
        result = client.content_generation.tasks.get(task_id=args.task_id)
        print(json.dumps(to_plain(result)))
        return 0

    parser.print_help()
    return 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # pragma: no cover - CLI surface
        print(json.dumps({"error": str(exc)}), file=sys.stderr)
        raise
