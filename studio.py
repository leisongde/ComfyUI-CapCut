import asyncio
from datetime import datetime, timezone
import hashlib
import json
import mimetypes
from pathlib import Path
import re
import shutil
from urllib.parse import urljoin, urlsplit
import uuid

from aiohttp import ClientError, ClientSession, ClientTimeout, web

import folder_paths
from server import PromptServer
from . import ai_video
from .api import load_project, media_directory, number, project_path, root, same_origin, save_json
from .captions import CaptionService
from .tracking import MAX_FRAME_BYTES, TrackingService


EDITOR_DIRECTORY = Path(__file__).parent / "editor_dist"
CACHE_KINDS = {"audio", "effects", "transitions", "text-templates", "fonts", "stickers"}
MEDIA_TYPES = {"video", "image", "audio"}
MEDIA_SUFFIXES = {".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".svg", ".mp3", ".wav", ".ogg", ".flac", ".m4a", ".aac"}
ITEM_ID = re.compile(r"[a-zA-Z0-9_-]{1,128}\Z")
media_locks = {}
caption_service = CaptionService()
tracking_service = TrackingService()


def studio_root(request):
    user = request.query.get("user")
    if user and "comfy-user" not in request.headers:
        request = request.clone(headers={**request.headers, "comfy-user": user})
    return root(request)


def project_file(directory, project_id):
    project_path(directory, project_id)
    return directory / "studio" / f"{project_id}.json"


def read_json(path, default=None):
    return json.loads(path.read_text(encoding="utf-8")) if path.is_file() else default


def media_index_path(directory, project_id):
    return project_file(directory, project_id).with_suffix(".media.json")


def validate_document(project):
    if not isinstance(project, dict) or project.get("version") != 3:
        raise ValueError("无效的剪辑工程版本")
    metadata = project.get("metadata", {})
    if not isinstance(metadata, dict) or not isinstance(metadata.get("name"), str):
        raise ValueError("工程名称无效")
    project_path(Path(), metadata.get("id"))
    settings = project.get("settings", {})
    number(settings.get("fps"), "帧率", 1)
    for key in ("width", "height"):
        number(settings.get("canvasSize", {}).get(key), key, 1)
    scenes = project.get("scenes")
    if not isinstance(scenes, list) or not scenes or project.get("currentSceneId") not in {scene.get("id") for scene in scenes if isinstance(scene, dict)}:
        raise ValueError("工程缺少有效场景")
    for scene in scenes:
        if not isinstance(scene, dict) or not isinstance(scene.get("tracks"), list):
            raise ValueError("无效的场景轨道")
        for track in scene["tracks"]:
            if not isinstance(track, dict) or track.get("type") not in {"video", "image", "audio", "text", "sticker"} or not isinstance(track.get("elements"), list):
                raise ValueError("无效的时间线轨道")
            for element in track["elements"]:
                if not isinstance(element, dict):
                    raise ValueError("无效的时间线片段")
                for key in ("duration", "startTime", "trimStart", "trimEnd"):
                    number(element.get(key), key, 0)
    json.dumps(project, allow_nan=False)
    return project


def new_document(name="未命名工程", project_id=None):
    now = datetime.now(timezone.utc).isoformat()
    scene_id = uuid.uuid4().hex
    return {
        "version": 3,
        "metadata": {"id": project_id or uuid.uuid4().hex, "name": name, "duration": 0, "createdAt": now, "updatedAt": now},
        "scenes": [{"id": scene_id, "name": "主场景", "isMain": True, "tracks": [{"id": uuid.uuid4().hex, "name": "主视频", "type": "video", "elements": [], "isMain": True, "muted": False, "hidden": False}], "bookmarks": [], "createdAt": now, "updatedAt": now}],
        "currentSceneId": scene_id,
        "settings": {"fps": 24, "canvasSize": {"width": 1920, "height": 1080}, "originalCanvasSize": None, "background": {"type": "color", "color": "#000000"}},
    }


def convert_legacy(directory, legacy):
    document = new_document(legacy["name"], legacy["id"])
    document["settings"].update(fps=legacy["fps"], canvasSize={"width": legacy["width"], "height": legacy["height"]})
    assets = {asset["id"]: asset for asset in legacy["assets"]}
    index = {}
    media_dir = media_directory(directory, legacy["id"])
    for asset in assets.values():
        path = media_dir / asset["file"]
        if not path.is_file():
            raise FileNotFoundError(f"工程素材不存在：{asset['name']}")
        index[asset["id"]] = {"id": asset["id"], "name": asset["name"], "type": asset["kind"], "fileName": path.name, "duration": asset.get("duration", 5), "width": asset.get("width", 0), "height": asset.get("height", 0), "fps": asset.get("fps", 0), "hasAudio": asset.get("hasAudio", False), "size": path.stat().st_size, "mimeType": mimetypes.guess_type(path.name)[0] or "application/octet-stream", "lastModified": path.stat().st_mtime * 1000}
    tracks = []
    for track_id, name, kind in [("video2", "叠加画面", "video"), ("video1", "主视频", "video"), ("audio1", "音频", "audio")]:
        track = {"id": track_id, "name": name, "type": kind, "elements": [], "isMain": track_id == "video1", **legacy.get("tracks", {}).get(track_id, {})}
        for clip in legacy["clips"]:
            if clip["track"] != track_id:
                continue
            asset = assets[clip["assetId"]]
            element = {"id": clip["id"], "name": asset["name"], "type": "audio" if kind == "audio" else asset["kind"], "mediaId": asset["id"], "startTime": clip["start"], "duration": clip["duration"], "trimStart": clip["in"], "trimEnd": max(0, asset.get("duration", 5) - clip["in"] - clip["duration"] * clip["speed"]), "playbackRate": clip["speed"], "volume": clip["volume"], "muted": False}
            if kind == "audio":
                element["sourceType"] = "upload"
            else:
                element.update(opacity=clip["opacity"], transform={"scale": clip["scale"], "position": {"x": clip["x"], "y": clip["y"]}, "rotate": 0})
            track["elements"].append(element)
        tracks.append(track)
    document["scenes"][0]["tracks"] = tracks
    document["metadata"]["duration"] = max([0] + [clip["start"] + clip["duration"] for clip in legacy["clips"]])
    save_json(media_index_path(directory, legacy["id"]), index)
    return document


def open_document(directory, project_id=None, name="未命名工程"):
    if project_id:
        path = project_file(directory, project_id)
        if path.is_file():
            return validate_document(read_json(path))
        legacy_path = project_path(directory, project_id)
        if legacy_path.is_file():
            document = convert_legacy(directory, load_project(directory, project_id))
        else:
            raise FileNotFoundError("工程不存在")
    else:
        document = new_document(name)
    save_json(project_file(directory, document["metadata"]["id"]), document)
    return document


def allowed_download(url):
    parsed = urlsplit(url)
    if parsed.scheme != "https" or parsed.username or parsed.password or parsed.port not in (None, 443):
        raise ValueError("不支持此素材下载地址")
    allowed = {
        "modelscope.cn": ("/models/leisongde/", "/api/v1/models/leisongde/"),
        "www.modelscope.cn": ("/models/leisongde/",),
        "cdn-lfs-cn-1.modelscope.cn": ("/",),
        "cdn-lfs-cn-2.modelscope.cn": ("/",),
        "raw.githubusercontent.com": ("/google/fonts/", "/notofonts/", "/adobe-fonts/"),
        "github.com": ("/google/fonts/", "/notofonts/", "/adobe-fonts/"),
        "fonts.gstatic.com": ("/s/",),
    }
    if parsed.hostname not in allowed or not parsed.path.startswith(allowed[parsed.hostname]):
        raise ValueError("仅支持内置资源库的下载地址")
    return url


async def fetch_resource(url):
    async with ClientSession(timeout=ClientTimeout(total=120)) as session:
        for _ in range(6):
            allowed_download(url)
            async with session.get(url, allow_redirects=False) as response:
                if response.status in (301, 302, 303, 307, 308):
                    url = urljoin(str(response.url), response.headers["Location"])
                    continue
                if response.status != 200:
                    raise ValueError(f"资源下载失败（{response.status}）")
                return await response.read(), response.headers.get("Content-Type", "application/octet-stream")
    raise ValueError("资源下载重定向次数过多")


def cache_path(directory, kind, item_id):
    if kind not in CACHE_KINDS or not isinstance(item_id, str) or not item_id:
        raise ValueError("无效的资源类型或 ID")
    return directory / "resources" / kind / hashlib.sha256(item_id.encode()).hexdigest()


def media_record(directory, project_id, item_id):
    index = read_json(media_index_path(directory, project_id), {})
    metadata = index.get(item_id)
    if not metadata:
        raise FileNotFoundError("素材不存在")
    name = metadata["fileName"]
    if Path(name).name != name or Path(name).suffix not in MEDIA_SUFFIXES:
        raise ValueError("无效的素材文件名")
    base = media_directory(directory, project_id)
    path = (base / name).resolve()
    if not path.is_relative_to(base.resolve()):
        raise ValueError("素材路径无效")
    return metadata, path


async def perform_operation(request, operation, payload, uploaded):
    directory = studio_root(request)
    if operation in {"capcut:minimax-key:get", "capcut:motion-transfer-key:get"}:
        filename = "motion-transfer-key.json" if operation == "capcut:motion-transfer-key:get" else "minimax-key.json"
        settings = await asyncio.to_thread(read_json, directory / filename, {})
        return {"key": settings.get("prompt_api_key", "")}
    if operation in {"capcut:minimax-key:set", "capcut:motion-transfer-key:set"}:
        key = payload["key"]
        if not isinstance(key, str):
            raise ValueError("API Key 需要是文本")
        key = key.strip()
        filename = "motion-transfer-key.json" if operation == "capcut:motion-transfer-key:set" else "minimax-key.json"
        path = directory / filename
        if key:
            await asyncio.to_thread(save_json, path, {"prompt_api_key": key})
        else:
            await asyncio.to_thread(path.unlink, missing_ok=True)
        return {"saved": bool(key)}
    if operation == "capcut:concat-ai-shots":
        return await asyncio.to_thread(ai_video.concatenate_shots, payload["files"])
    if operation == "capcut:shot-guide-file":
        project_id = payload["projectId"]
        asset = read_json(media_index_path(directory, project_id), {}).get(payload["assetId"])
        if not asset or asset["type"] != "video":
            return None
        file = {"filename": asset["fileName"], "subfolder": f"CapCut/{directory.parent.name}/{project_id}", "type": "input"}
        try:
            ai_video.video_path(file, ("input",))
        except ValueError:
            return None
        return file
    if operation == "projects:load":
        return await asyncio.to_thread(open_document, directory, payload["id"])
    if operation == "projects:create":
        return await asyncio.to_thread(open_document, directory, None, payload.get("name", "未命名工程"))
    if operation == "projects:save":
        project = validate_document(payload["project"])
        await asyncio.to_thread(save_json, project_file(directory, project["metadata"]["id"]), project)
        return {"saved": True}
    if operation == "projects:remove":
        project_id = payload["id"]
        for path in (project_file(directory, project_id), project_path(directory, project_id), media_index_path(directory, project_id)):
            await asyncio.to_thread(path.unlink, missing_ok=True)
        return {"removed": True}
    if operation == "projects:list":
        items = {}
        for path in (directory / "studio").glob("*.json"):
            if path.name.endswith(".media.json"):
                continue
            project = await asyncio.to_thread(read_json, path)
            items[path.stem] = project["metadata"]
        for path in (directory / "projects").glob("*.json"):
            if path.stem not in items:
                value = await asyncio.to_thread(read_json, path)
                timestamp = datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).isoformat()
                items[path.stem] = {"id": path.stem, "name": value["name"], "duration": 0, "createdAt": timestamp, "updatedAt": timestamp}
        return sorted(items.values(), key=lambda item: item["updatedAt"], reverse=True)
    if operation.startswith("media:") and operation not in {"media:fetch-url", "media:import-canvas-asset"}:
        project_id = payload["projectId"]
        index_path = media_index_path(directory, project_id)
        index = read_json(index_path, {})
        if operation == "media:list":
            return list(index.values())
        if operation == "media:save":
            metadata = payload["metadata"]
            if metadata.get("type") not in MEDIA_TYPES or not ITEM_ID.fullmatch(metadata.get("id", "")):
                raise ValueError("素材类型或 ID 无效")
            suffix = Path(metadata["name"]).suffix.lower()
            if suffix not in MEDIA_SUFFIXES:
                mime_type = metadata.get("mimeType", "").split(";")[0]
                suffix = ".ogg" if mime_type == "audio/ogg" else mimetypes.guess_extension(mime_type) or ""
            if suffix not in MEDIA_SUFFIXES or uploaded is None:
                raise ValueError("素材格式不受支持或缺少文件内容")
            old = index.get(metadata["id"])
            name = old["fileName"] if old else uuid.uuid4().hex + suffix
            destination = media_directory(directory, project_id) / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            await asyncio.to_thread(shutil.copyfile, uploaded, destination)
            index[metadata["id"]] = {**metadata, "fileName": name, "size": destination.stat().st_size}
        elif operation == "media:update-metadata":
            if payload["id"] not in index:
                raise ValueError("素材不存在")
            patch = {key: value for key, value in payload["patch"].items() if key in {"thumbnailUrl", "duration", "width", "height", "name", "fps", "hasAudio"}}
            index[payload["id"]].update(patch)
        elif operation == "media:remove":
            index.pop(payload["id"], None)
        elif operation == "media:read":
            metadata, _ = media_record(directory, project_id, payload["id"])
            return {"metadata": metadata, "fileUrl": f"/capcut/studio/media/{project_id}/{payload['id']}"}
        else:
            raise ValueError("不支持此素材操作")
        await asyncio.to_thread(save_json, index_path, index)
        return {"saved": True}
    if operation in {"media:fetch-url", "fonts:fetch-url"}:
        data, mime_type = await fetch_resource(payload["url"])
        return web.Response(body=data, content_type=mime_type.split(";")[0])
    kind, _, action = operation.partition(":")
    if kind in CACHE_KINDS:
        if action == "list":
            return [read_json(path) for path in (directory / "resources" / kind).glob("*.json")]
        metadata = payload.get("metadata", {})
        item_id = metadata.get("id") if action == "save" else payload.get("id")
        path = cache_path(directory, kind, item_id)
        if action == "read":
            if not path.is_file() or not path.with_suffix(".json").is_file():
                return None
            return {"metadata": read_json(path.with_suffix(".json")), "fileUrl": f"/capcut/studio/resource/{kind}/{path.name}"}
        if action == "save" and uploaded is not None:
            path.parent.mkdir(parents=True, exist_ok=True)
            await asyncio.to_thread(shutil.copyfile, uploaded, path)
            save_json(path.with_suffix(".json"), metadata)
            return {"saved": True}
        if action == "remove":
            path.unlink(missing_ok=True)
            path.with_suffix(".json").unlink(missing_ok=True)
            return {"removed": True}
    if operation == "export:save":
        extension = payload.get("format")
        if extension not in {"mp4", "webm"} or uploaded is None:
            raise ValueError("导出格式无效")
        path = directory / "exports" / f"{uuid.uuid4().hex}.{extension}"
        path.parent.mkdir(parents=True, exist_ok=True)
        await asyncio.to_thread(shutil.copyfile, uploaded, path)
        return {"canceled": False, "name": payload.get("name", "成片") + "." + extension, "downloadUrl": f"/capcut/studio/export/{path.name}"}
    if operation == "captions:status":
        return caption_service.status()
    if operation == "captions:transcribe":
        return await caption_service.transcribe(uploaded)
    if operation == "custom-cutout:status":
        return tracking_service.status()
    if operation == "custom-cutout:track:start":
        return await tracking_service.start(str(directory), payload, uploaded)
    if operation == "custom-cutout:track:step":
        mask, width, height, elapsed = await tracking_service.step(str(directory), payload, uploaded)
        return web.Response(body=mask, content_type="application/octet-stream", headers={"X-CapCut-Width": str(width), "X-CapCut-Height": str(height), "X-CapCut-Elapsed": str(elapsed)})
    if operation == "custom-cutout:track:end":
        return await tracking_service.end(str(directory), payload.get("sessionId"))
    raise ValueError("此功能需要接入对应的 ComfyUI 工作流")


def register_studio_routes():
    routes = PromptServer.instance.routes

    @routes.get("/capcut/editor/{path:.*}")
    async def read_editor(request):
        relative = request.match_info["path"] or "index.html"
        path = (EDITOR_DIRECTORY / relative).resolve()
        if not path.is_relative_to(EDITOR_DIRECTORY.resolve()) or not path.is_file():
            raise web.HTTPNotFound()
        return web.FileResponse(path, headers={"Cache-Control": "no-cache"})

    @routes.post("/capcut/studio/open")
    async def open_editor(request):
        same_origin(request)
        try:
            payload = await request.json()
            directory = root(request)
            project_id = payload.get("project_id")
            if project_id and not project_file(directory, project_id).is_file() and not project_path(directory, project_id).is_file():
                project_id = None
            project = await asyncio.to_thread(open_document, directory, project_id, payload.get("name", "未命名工程"))
            return web.json_response(project["metadata"])
        except (ValueError, KeyError, OSError) as error:
            raise web.HTTPBadRequest(text=str(error))

    @routes.post("/capcut/studio/op/{operation}")
    async def operation(request):
        same_origin(request)
        temporary = None
        try:
            name = request.match_info["operation"]
            if request.content_type == "multipart/form-data":
                reader = await request.multipart()
                part = await reader.next()
                if part is None or part.name != "payload":
                    raise ValueError("缺少操作参数")
                payload = json.loads(await part.text())
                if not isinstance(payload, dict):
                    raise ValueError("无效的操作参数")
                while part := await reader.next():
                    if part.name == "bytes" and temporary is None:
                        temporary = root(request) / "studio" / f"{uuid.uuid4().hex}.tmp"
                        temporary.parent.mkdir(parents=True, exist_ok=True)
                        size = 0
                        with temporary.open("wb") as stream:
                            while chunk := await part.read_chunk(1024 * 1024):
                                size += len(chunk)
                                if name.startswith("custom-cutout:track:") and size > MAX_FRAME_BYTES:
                                    raise ValueError("跟踪画面数据过大")
                                await asyncio.to_thread(stream.write, chunk)
                    elif part.name == "mask" and name == "custom-cutout:track:start" and "mask" not in payload:
                        mask = bytearray()
                        while chunk := await part.read_chunk(1024 * 1024):
                            mask.extend(chunk)
                            if len(mask) > MAX_FRAME_BYTES // 4:
                                raise ValueError("跟踪种子蒙版数据过大")
                        payload["mask"] = bytes(mask)
                    else:
                        raise ValueError("无效或重复的上传数据")
            else:
                payload = await request.json()
            if name in {"media:save", "media:update-metadata", "media:remove"}:
                key = str(media_index_path(studio_root(request), payload["projectId"]))
                async with media_locks.setdefault(key, asyncio.Lock()):
                    result = await perform_operation(request, name, payload, temporary)
            else:
                result = await perform_operation(request, name, payload, temporary)
            return result if isinstance(result, web.StreamResponse) else web.json_response(result)
        except (ValueError, TypeError, KeyError, RuntimeError, OSError, ClientError, asyncio.TimeoutError) as error:
            raise web.HTTPBadRequest(text=str(error))
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)

    @routes.get("/capcut/studio/media/{project}/{id}")
    async def read_media(request):
        try:
            metadata, path = media_record(studio_root(request), request.match_info["project"], request.match_info["id"])
        except FileNotFoundError:
            raise web.HTTPNotFound()
        except ValueError as error:
            raise web.HTTPBadRequest(text=str(error))
        return web.FileResponse(path, headers={"Content-Type": metadata.get("mimeType", "application/octet-stream")})

    @routes.get("/capcut/studio/resource/{kind}/{hash}")
    async def read_resource(request):
        kind, digest = request.match_info["kind"], request.match_info["hash"]
        if kind not in CACHE_KINDS or not re.fullmatch(r"[a-f0-9]{64}", digest):
            raise web.HTTPBadRequest()
        path = studio_root(request) / "resources" / kind / digest
        if not path.is_file():
            raise web.HTTPNotFound()
        return web.FileResponse(path)

    @routes.get("/capcut/studio/export/{name}")
    async def read_export(request):
        name = request.match_info["name"]
        if not re.fullmatch(r"[a-f0-9]{32}\.(mp4|webm)", name):
            raise web.HTTPBadRequest()
        path = studio_root(request) / "exports" / name
        if not path.is_file():
            raise web.HTTPNotFound()
        return web.FileResponse(path)
