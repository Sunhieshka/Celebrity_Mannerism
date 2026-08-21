# Stages 2–3 reference — BytePlus asset sync + Seedance generation

These stages call **BytePlus Ark** and need credentials. Set them as environment
variables before running `asset_runtime.py` or `seedance_runtime.py`. Nothing here
is needed for Stage 1 (`pose_drive.py`).

## Environment variables

| Variable | Used by | Required for | Notes |
| --- | --- | --- | --- |
| `BYTEPLUS_AK` / `BYTEPLUS_SK` | asset | Asset sync | Access key / secret. `BYTEPLUS_ACCESSKEY` / `BYTEPLUS_SECRETKEY` are accepted aliases. |
| `BYTEPLUS_REGION` | asset | Asset sync | Defaults to `ap-southeast-1`. |
| `TOS_REGION` | asset | Asset sync | Defaults to `BYTEPLUS_REGION`. |
| `TOS_BUCKET_NAME` | asset | Asset sync | TOS bucket for uploads. **Required.** |
| `TOS_ENDPOINT` | asset | Asset sync | Defaults to `https://tos-<region>.bytepluses.com`. |
| `TOS_PREFIX` | asset | Asset sync | Object key prefix, defaults to `ark-assets`. |
| `TOS_PUBLIC_URL_PREFIX` | asset | Asset sync | Public URL base for uploaded objects. Defaults to `<endpoint>/<bucket>`. |
| `ARK_PROJECT` | asset | Asset sync | Ark project name, defaults to `default` (alias `ARK_PROJECT_NAME`). |
| `ARK_API_KEY` | seedance | Generation | Ark API key. **Required for Stage 3.** |
| `ARK_BASE_URL` | seedance | Generation | Defaults to `https://ark.ap-southeast.bytepluses.com/api/v3`. |
| `SEEDANCE_MODEL` | (caller) | Generation | Model id passed to `create --model`, e.g. `dreamina-seedance-2-5-260628`. |

## `asset_runtime.py`

Two subcommands; each prints one JSON object to stdout, or `{"error": "..."}` to
stderr with a non-zero exit.

### `create-asset-from-file` — register an Ark asset (use for the character sheet)

```
python asset_runtime.py create-asset-from-file --file-path PATH
       [--group-id ID] [--group-name NAME] [--group-desc DESC]
       [--key-hint asset] [--asset-type Image]
```

Uploads the file to TOS, then calls `CreateAsset`. If `--group-id` is omitted it
first calls `CreateAssetGroup` (using `--group-name` / `--group-desc`) and uses
the new group. Output:

```json
{"group_id": "...", "asset_id": "...", "asset_url": "https://.../object", "object_key": "..."}
```

`asset_url` is what Stage 3 takes as `--image-asset-uri`. Reuse the returned
`group_id` for subsequent uploads that belong to the same character.

### `upload-file` — upload media and get a public URL (use for drive videos)

```
python asset_runtime.py upload-file --file-path PATH
       [--key-hint media] [--group-id ID] [--folder NAME]
```

Uploads without registering an Ark asset. Output:

```json
{"object_key": "...", "url": "https://.../object", "content_type": "video/mp4"}
```

`url` is what Stage 3 takes as `--body-reference-video-url` /
`--facial-reference-video-url`. Object keys are namespaced by `--group-id` if
given, else `--folder`, else the bare prefix, and are always made unique with a
timestamp + UUID.

## `seedance_runtime.py`

Wraps the Ark `content_generation.tasks` API. Needs `ARK_API_KEY`.

### `create` — start a generation task

```
python seedance_runtime.py create
       --model MODEL --prompt TEXT
       --image-asset-uri URL
       --body-reference-video-url URL
       --facial-reference-video-url URL
       [--ratio 9:16] [--resolution 720p] [--duration 10]
       [--generate-audio true] [--watermark true] [--return-last-frame true]
       [--reference-image-url URL ...]   # repeatable
       [--reference-video-url URL ...]   # repeatable
       [--reference-audio-url URL ...]   # repeatable
```

The four required inputs become the task `content`: the prompt text, the image
(`role: reference_image`), and the body and facial videos (each
`role: reference_video`). Extra `--reference-*` flags append more references in
their respective roles. Boolean flags accept `true/false/1/0/yes/no/on/off`.
Output is the task-creation JSON (contains the task id).

| Flag | Default | Notes |
| --- | --- | --- |
| `--ratio` | `9:16` | Aspect ratio, e.g. `9:16`, `16:9`, `1:1`. |
| `--resolution` | `720p` | Output resolution. |
| `--duration` | `10` | Seconds. Start short to keep the first pass cheap. |
| `--generate-audio` | `true` | Whether to synthesize audio. |
| `--watermark` | `true` | Whether to watermark the output. |
| `--return-last-frame` | `true` | Return the final frame in the result. |

### `get` — poll a task

```
python seedance_runtime.py get --task-id ID
```

Prints the task JSON, including status. Poll on an interval (a few seconds)
until the status indicates completion, then read the generated video URL from
the result. Don't busy-wait tightly — space the calls out.

## End-to-end order

1. `pose_drive.py` on the footage → `body-skeleton.mp4` (+ optional
   `facial-skeleton.mp4`).
2. `asset_runtime.py create-asset-from-file` on the character sheet → `asset_url`
   + `group_id`.
3. `asset_runtime.py upload-file` on each skeleton video (reusing `group_id`) →
   public `url`s.
4. `seedance_runtime.py create` with the asset_url + skeleton URLs → task id.
5. `seedance_runtime.py get` until done → generated video URL.
