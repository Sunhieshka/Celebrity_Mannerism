#!/usr/bin/env python3
"""Upload local media to TOS and optionally register Ark assets."""

import argparse
import json
import mimetypes
import os
import sys
import time
import uuid
from dataclasses import dataclass
from typing import Optional

import tos
from byteplussdkcore.api_client import ApiClient
from byteplussdkcore.configuration import Configuration
from byteplussdkcore.universal import UniversalApi, UniversalInfo


@dataclass
class AssetEnv:
    region: str
    project_name: str
    tos_region: str
    tos_bucket: str
    tos_endpoint: str
    tos_public_url_prefix: str
    tos_prefix: str


def _get_env_any(*names: str) -> str:
    for name in names:
        value = os.environ.get(name) or ""
        if value.strip():
            return value.strip()
    return ""


def _require_env_any(*names: str) -> str:
    value = _get_env_any(*names)
    if not value:
        raise RuntimeError(f"Missing required env var: {', '.join(names)}")
    return value


def load_asset_env() -> AssetEnv:
    ak = _require_env_any("BYTEPLUS_AK", "BYTEPLUS_ACCESSKEY")
    sk = _require_env_any("BYTEPLUS_SK", "BYTEPLUS_SECRETKEY")
    os.environ["BYTEPLUS_ACCESSKEY"] = ak
    os.environ["BYTEPLUS_SECRETKEY"] = sk

    region = (_get_env_any("BYTEPLUS_REGION", "TOS_REGION") or "ap-southeast-1").strip()
    project_name = (_get_env_any("ARK_PROJECT", "ARK_PROJECT_NAME") or "default").strip()

    tos_region = (_get_env_any("TOS_REGION") or region).strip()
    tos_bucket = _require_env_any("TOS_BUCKET_NAME")
    tos_endpoint = _get_env_any("TOS_ENDPOINT")
    if not tos_endpoint:
        tos_endpoint = f"https://tos-{tos_region}.bytepluses.com"
    tos_prefix = (_get_env_any("TOS_PREFIX") or "ark-assets").strip().strip("/")

    tos_public_url_prefix = (_get_env_any("TOS_PUBLIC_URL_PREFIX") or "").strip().rstrip("/")
    if not tos_public_url_prefix:
        tos_public_url_prefix = tos_endpoint.rstrip("/") + "/" + tos_bucket

    return AssetEnv(
        region=region,
        project_name=project_name,
        tos_region=tos_region,
        tos_bucket=tos_bucket,
        tos_endpoint=tos_endpoint,
        tos_public_url_prefix=tos_public_url_prefix,
        tos_prefix=tos_prefix,
    )


def _new_universal_api(region: str) -> UniversalApi:
    cfg = Configuration()
    cfg.region = region
    client = ApiClient(cfg)
    return UniversalApi(client)


def _new_tos_client(env: AssetEnv) -> tos.TosClientV2:
    return tos.TosClientV2(
        _require_env_any("BYTEPLUS_ACCESSKEY", "BYTEPLUS_AK"),
        _require_env_any("BYTEPLUS_SECRETKEY", "BYTEPLUS_SK"),
        env.tos_endpoint,
        env.tos_region,
    )


def ensure_group_folder(*, env: AssetEnv, group_id: str) -> str:
    folder_key = f"{env.tos_prefix}/{group_id}/".lstrip("/")
    client = _new_tos_client(env)
    client.put_object(env.tos_bucket, folder_key, content=b"")
    return folder_key


def create_asset_group(*, name: str, description: str, region: str, project_name: str) -> str:
    env = load_asset_env()
    api = _new_universal_api(region)
    info = UniversalInfo(
        method="POST",
        service="ark",
        version="2024-01-01",
        action="CreateAssetGroup",
        content_type="application/json",
    )
    resp = api.do_call(
        info,
        {
            "Name": name,
            "Description": description,
            "ProjectName": project_name,
        },
    )
    group_id = (resp or {}).get("Id") or ""
    if not group_id:
        raise RuntimeError(f"CreateAssetGroup returned no Id: {resp}")
    ensure_group_folder(env=env, group_id=group_id)
    return group_id


def create_asset(*, group_id: str, url: str, asset_type: str, region: str, project_name: str) -> str:
    api = _new_universal_api(region)
    info = UniversalInfo(
        method="POST",
        service="ark",
        version="2024-01-01",
        action="CreateAsset",
        content_type="application/json",
    )
    resp = api.do_call(
        info,
        {
            "GroupId": group_id,
            "URL": url,
            "AssetType": asset_type,
            "Moderation": {"Strategy": "Skip"},
            "ProjectName": project_name,
        },
    )
    asset_id = (resp or {}).get("Id") or ""
    if not asset_id:
        raise RuntimeError(f"CreateAsset returned no Id: {resp}")
    return asset_id


def _safe_ext_from_path(file_path: str) -> str:
    ext = os.path.splitext(file_path)[1]
    return ext or ".bin"


def _detect_content_type(file_path: str) -> str:
    mime, _ = mimetypes.guess_type(file_path)
    return mime or "application/octet-stream"


def upload_file_to_tos(
    *,
    file_path: str,
    env: AssetEnv,
    key_hint: str,
    group_id: Optional[str] = None,
    folder: Optional[str] = None,
) -> dict:
    with open(file_path, "rb") as f:
        raw = f.read()

    mime = _detect_content_type(file_path)
    ext = _safe_ext_from_path(file_path)
    ts = time.strftime("%Y%m%d-%H%M%S")

    if group_id:
        obj_key = f"{env.tos_prefix}/{group_id}/{ts}-{uuid.uuid4().hex}-{key_hint}{ext}"
    elif folder:
        clean_folder = folder.strip().strip("/")
        obj_key = f"{env.tos_prefix}/{clean_folder}/{ts}-{uuid.uuid4().hex}-{key_hint}{ext}"
    else:
        obj_key = f"{env.tos_prefix}/{ts}-{uuid.uuid4().hex}-{key_hint}{ext}"
    obj_key = obj_key.lstrip("/")

    client = _new_tos_client(env)
    client.put_object(env.tos_bucket, obj_key, content=raw, content_type=mime)

    return {
        "object_key": obj_key,
        "url": f"{env.tos_public_url_prefix}/{obj_key}",
        "content_type": mime,
    }


def command_create_asset_from_file(args: argparse.Namespace) -> dict:
    env = load_asset_env()
    group_id = (args.group_id or "").strip()
    if not group_id:
        group_id = create_asset_group(
            name=args.group_name,
            description=args.group_desc,
            region=env.region,
            project_name=env.project_name,
        )
    else:
        ensure_group_folder(env=env, group_id=group_id)

    upload_result = upload_file_to_tos(
        file_path=args.file_path,
        env=env,
        key_hint=args.key_hint,
        group_id=group_id,
    )
    asset_id = create_asset(
        group_id=group_id,
        url=upload_result["url"],
        asset_type=args.asset_type,
        region=env.region,
        project_name=env.project_name,
    )
    return {
        "group_id": group_id,
        "asset_id": asset_id,
        "asset_url": upload_result["url"],
        "object_key": upload_result["object_key"],
    }


def command_upload_file(args: argparse.Namespace) -> dict:
    env = load_asset_env()
    upload_result = upload_file_to_tos(
        file_path=args.file_path,
        env=env,
        key_hint=args.key_hint,
        group_id=(args.group_id or "").strip() or None,
        folder=(args.folder or "").strip() or None,
    )
    return upload_result


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Asset/TOS helper")
    subparsers = parser.add_subparsers(dest="command", required=True)

    create_parser = subparsers.add_parser("create-asset-from-file")
    create_parser.add_argument("--file-path", required=True)
    create_parser.add_argument("--group-id", default="")
    create_parser.add_argument("--group-name", default="")
    create_parser.add_argument("--group-desc", default="")
    create_parser.add_argument("--key-hint", default="asset")
    create_parser.add_argument("--asset-type", default="Image")

    upload_parser = subparsers.add_parser("upload-file")
    upload_parser.add_argument("--file-path", required=True)
    upload_parser.add_argument("--key-hint", default="media")
    upload_parser.add_argument("--group-id", default="")
    upload_parser.add_argument("--folder", default="")

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    if args.command == "create-asset-from-file":
        result = command_create_asset_from_file(args)
    elif args.command == "upload-file":
        result = command_upload_file(args)
    else:
        raise RuntimeError(f"Unsupported command: {args.command}")

    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # pragma: no cover - CLI entry
        print(json.dumps({"error": str(exc)}), file=sys.stderr)
        raise
