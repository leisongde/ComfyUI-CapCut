import asyncio
import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import time
from urllib.parse import urlsplit
import uuid

import av
from aiohttp import web
from PIL import Image

import folder_paths
from server import PromptServer


EXTENSIONS = {
    ".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi",
    ".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif",
    ".mp3", ".wav", ".m4a", ".ogg", ".flac", ".aac",
}
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif"}
FILE_NAME = re.compile(r"[a-f0-9]{32}\.[a-z0-9]+\Z")
PROJECT_ID = re.compile(r"[a-f0-9]{32}\Z")


def same_origin(request):
    origin = request.headers.get("Origin")
    if request.headers.get("Sec-Fetch-Site") == "cross-site" or (origin and urlsplit(origin).netloc.lower() != request.host.lower()):
        raise web.HTTPForbidden(text="不允许跨站请求")


def root(request):
    path = PromptServer.instance.user_manager.get_request_user_filepath(request, "capcut/.keep")
    if path is None:
        raise web.HTTPForbidden(text="无法访问当前用户的工程目录")
    return Path(path).parent


def media_path(directory, name):
    if not isinstance(name, str) or not FILE_NAME.fullmatch(name) or Path(name).suffix not in EXTENSIONS:
        raise ValueError("无效的素材文件名")
    result = (directory / name).resolve()
    if not result.is_relative_to(directory.resolve()):
        raise ValueError("素材路径超出工程目录")
    return result


def project_path(directory, project_id):
    if not isinstance(project_id, str) or not PROJECT_ID.fullmatch(project_id):
        raise ValueError("无效的工程 ID")
    return directory / "projects" / f"{project_id}.json"


def media_directory(directory, project_id):
    project_path(directory, project_id)
    input_directory = Path(folder_paths.get_input_directory()).resolve()
    result = (input_directory / "CapCut" / directory.parent.name / project_id).resolve()
    if not result.is_relative_to(input_directory):
        raise ValueError("素材路径超出 input 目录")
    return result


def number(value, name, minimum=None):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(f"{name} 必须是有限数值")
    if minimum is not None and value < minimum:
        raise ValueError(f"{name} 不能小于 {minimum}")
    return value


def validate_project(project):
    if not isinstance(project, dict) or project.get("version") != 1:
        raise ValueError("仅支持版本 1 的剪辑工程")
    if not isinstance(project.get("id"), str) or not PROJECT_ID.fullmatch(project["id"]):
        raise ValueError("无效的工程 ID")
    if not isinstance(project.get("name"), str):
        raise ValueError("工程名称必须是文本")
    if not isinstance(project.get("assets"), list) or not isinstance(project.get("clips"), list):
        raise ValueError("工程缺少素材或时间线")
    tracks = project.get("tracks", {})
    if not isinstance(tracks, dict) or any(not isinstance(settings, dict) for settings in tracks.values()):
        raise ValueError("无效的轨道设置")
    if any(not isinstance(value, bool) for settings in tracks.values() for key, value in settings.items() if key in ("muted", "hidden")):
        raise ValueError("轨道静音和隐藏设置必须是布尔值")
    for key in ("width", "height", "fps"):
        if number(project.get(key), key, 0) <= 0:
            raise ValueError(f"{key} 必须大于零")
    assets = {}
    for asset in project["assets"]:
        if not isinstance(asset, dict) or asset.get("kind") not in ("video", "image", "audio"):
            raise ValueError("无效的素材类型")
        if not isinstance(asset.get("file"), str) or not FILE_NAME.fullmatch(asset["file"]) or Path(asset["file"]).suffix not in EXTENSIONS:
            raise ValueError("无效的素材文件名")
        if not isinstance(asset.get("id"), str) or asset["id"] in assets:
            raise ValueError("素材 ID 缺失或重复")
        assets[asset["id"]] = asset
    clip_ids = set()
    for clip in project["clips"]:
        if not isinstance(clip, dict) or not isinstance(clip.get("id"), str) or clip["id"] in clip_ids:
            raise ValueError("片段 ID 缺失或重复")
        clip_ids.add(clip["id"])
        if clip.get("assetId") not in assets or clip.get("track") not in ("video1", "video2", "audio1"):
            raise ValueError("片段引用了无效的素材或轨道")
        if clip["track"] == "audio1" and assets[clip["assetId"]]["kind"] == "image":
            raise ValueError("图片不能添加到音频轨道")
        if clip["track"] != "audio1" and assets[clip["assetId"]]["kind"] == "audio":
            raise ValueError("音频素材需要放在音频轨道")
        for key in ("start", "in", "duration", "speed", "volume", "opacity", "scale"):
            number(clip.get(key), key, 0)
        if clip["duration"] <= 0 or clip["speed"] <= 0 or clip["scale"] <= 0 or clip["opacity"] > 1:
            raise ValueError("片段的时长、速度、缩放或透明度无效")
        number(clip.get("x"), "x")
        number(clip.get("y"), "y")
    return project


def probe(path, name):
    if path.suffix.lower() in IMAGE_EXTENSIONS:
        with Image.open(path) as image:
            info = {"kind": "image", "width": image.width, "height": image.height, "duration": 5, "hasAudio": False}
    else:
        with av.open(str(path), options={"protocol_whitelist": "file,pipe"}) as container:
            video = next(iter(container.streams.video), None)
            audio = next(iter(container.streams.audio), None)
            duration = container.duration / av.time_base if container.duration is not None else 0
            if duration <= 0:
                stream = video or audio
                duration = float(stream.duration * stream.time_base) if stream and stream.duration else 0
            if not video and not audio:
                raise ValueError("素材不包含可读取的视频或音频")
            if duration <= 0:
                raise ValueError("无法读取素材时长")
            info = {
                "kind": "video" if video else "audio", "duration": duration,
                "width": video.width if video else 0, "height": video.height if video else 0,
                "fps": float(video.average_rate or 0) if video else 0, "hasAudio": audio is not None,
            }
    return {"id": path.stem, "file": path.name, "name": name, "source": "import", **info}


def save_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(f".{uuid.uuid4().hex}.tmp")
    try:
        temporary.write_text(json.dumps(data, ensure_ascii=False, allow_nan=False), encoding="utf-8")
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def prepare_project_media(directory, project, source_id=None):
    destination = media_directory(directory, project["id"])
    if source_id is not None and project["assets"]:
        source = load_project(directory, source_id)
        source_directory = media_directory(directory, source["id"])
    elif project.get("mediaStorage") != "input":
        source_directory = directory / "media"
    else:
        return destination
    destination.mkdir(parents=True, exist_ok=True)
    for asset in project["assets"]:
        target = media_path(destination, asset["file"])
        if target.is_file():
            continue
        original = media_path(source_directory, asset["file"])
        if not original.is_file():
            raise ValueError(f"找不到工程素材：{asset.get('name', asset['file'])}。工程 JSON 不包含素材文件")
        temporary = target.with_suffix(f".{uuid.uuid4().hex}.tmp")
        try:
            shutil.copy2(original, temporary)
            os.replace(temporary, target)
        finally:
            temporary.unlink(missing_ok=True)
    project["mediaStorage"] = "input"
    return destination


def load_project(directory, project_id):
    path = project_path(directory, project_id)
    if not path.is_file():
        raise FileNotFoundError("工程不存在")
    project = validate_project(json.loads(path.read_text(encoding="utf-8")))
    if project["id"] != project_id:
        raise ValueError("工程 ID 与保存位置不一致")
    if project.get("mediaStorage") != "input":
        prepare_project_media(directory, project)
        save_json(path, project)
    return project


def export_command(project, directory, destination, executable):
    validate_project(project)
    if not project["clips"]:
        raise ValueError("时间线为空，请先添加素材")
    width, height = int(project["width"]), int(project["height"])
    if width % 2 or height % 2:
        raise ValueError("MP4 导出的宽度和高度需要是偶数")
    fps = project["fps"]
    duration = max(clip["start"] + clip["duration"] for clip in project["clips"])
    assets = {asset["id"]: asset for asset in project["assets"]}
    tracks = project.get("tracks", {})
    command = [executable, "-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-filter_complex_threads", "1"]
    clips = sorted(project["clips"], key=lambda clip: (clip["track"] == "video2", clip["start"]))
    for clip in clips:
        asset = assets[clip["assetId"]]
        path = media_path(directory, asset["file"])
        if not path.is_file():
            raise ValueError(f"素材文件不存在：{asset.get('name', asset['file'])}")
        if asset["kind"] == "image":
            command += ["-loop", "1", "-framerate", str(fps)]
        command += ["-protocol_whitelist", "file,pipe", "-i", str(path)]
    filters = [f"color=c=black:s={width}x{height}:r={fps}:d={duration},format=rgba[base]"]
    visual = "base"
    audio_labels = []
    for index, clip in enumerate(clips):
        asset = assets[clip["assetId"]]
        actual = probe(media_path(directory, asset["file"]), asset.get("name", ""))
        start, length, offset, speed = clip["start"], clip["duration"], clip["in"], clip["speed"]
        track = tracks.get(clip["track"], {})
        source_end = offset + length * speed
        if actual["kind"] != "image" and source_end > actual["duration"] + 1 / fps:
            raise ValueError(f"片段超出素材时长：{asset.get('name', asset['file'])}")
        if clip["track"] != "audio1" and not track.get("hidden", False):
            scaled_width = max(2, round(width * clip["scale"] / 2) * 2)
            scaled_height = max(2, round(height * clip["scale"] / 2) * 2)
            filters.append(
                f"[{index}:v]trim=start={offset}:end={source_end},setpts=(PTS-STARTPTS)/{speed}+{start}/TB,"
                f"scale={scaled_width}:{scaled_height}:force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1,"
                f"format=rgba,colorchannelmixer=aa={clip['opacity']}[v{index}]"
            )
            filters.append(
                f"[{visual}][v{index}]overlay=x=(W-w)/2+{clip['x']}:y=(H-h)/2+{clip['y']}:"
                f"enable='gte(t,{start})*lt(t,{start + length})':eof_action=pass:repeatlast=0[m{index}]"
            )
            visual = f"m{index}"
        if actual["hasAudio"] and not track.get("muted", False) and clip["volume"] > 0:
            factors = []
            remainder = speed
            while remainder > 2:
                factors.append(2)
                remainder /= 2
            while remainder < 0.5:
                factors.append(0.5)
                remainder /= 0.5
            factors.append(remainder)
            tempo = ",".join(f"atempo={value}" for value in factors)
            filters.append(
                f"[{index}:a]atrim=start={offset}:end={source_end},asetpts=PTS-STARTPTS,{tempo},"
                f"volume={clip['volume']},adelay={round(start * 1000)}:all=1[a{index}]"
            )
            audio_labels.append(f"[a{index}]")
    filters.append(f"[{visual}]format=yuv420p[outv]")
    if audio_labels:
        filters.append(f"{''.join(audio_labels)}amix=inputs={len(audio_labels)}:duration=longest:normalize=0,apad,atrim=duration={duration}[outa]")
    command += ["-filter_complex", ";".join(filters), "-map", "[outv]"]
    if audio_labels:
        command += ["-map", "[outa]", "-c:a", "aac", "-b:a", "192k"]
    command += ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-r", str(fps), "-t", str(duration), "-movflags", "+faststart", str(destination)]
    return command


def register_routes():
    routes = PromptServer.instance.routes

    @routes.get("/capcut/status")
    async def status(request):
        return web.json_response({"version": 1, "ffmpeg": shutil.which("ffmpeg") is not None})

    @routes.get("/capcut/projects")
    async def projects(request):
        directory = root(request) / "projects"
        result = []
        for path in directory.glob("*.json"):
            try:
                project = json.loads(await asyncio.to_thread(path.read_text, encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            result.append({"id": path.stem, "name": project.get("name", "未命名工程"), "updated": path.stat().st_mtime})
        return web.json_response(sorted(result, key=lambda project: project["updated"], reverse=True))

    @routes.get("/capcut/projects/{id}")
    async def read_project(request):
        try:
            project = await asyncio.to_thread(load_project, root(request), request.match_info["id"])
        except FileNotFoundError as error:
            raise web.HTTPNotFound(text=str(error))
        except (ValueError, OSError) as error:
            raise web.HTTPBadRequest(text=str(error))
        return web.json_response(project, headers={"Cache-Control": "no-store"})

    @routes.put("/capcut/projects/{id}")
    async def write_project(request):
        same_origin(request)
        try:
            project = validate_project(await request.json())
            directory = root(request)
            path = project_path(directory, request.match_info["id"])
            if project.get("id") != path.stem:
                raise ValueError("工程 ID 与保存位置不一致")
            source_id = request.query.get("source_project")
            if source_id == project["id"]:
                raise ValueError("导入工程需要使用新的工程 ID")
            await asyncio.to_thread(prepare_project_media, directory, project, source_id)
            await asyncio.to_thread(save_json, path, project)
        except (ValueError, TypeError, OSError) as error:
            raise web.HTTPBadRequest(text=str(error))
        return web.json_response({"saved": True, "updated": time.time()})

    @routes.post("/capcut/media")
    async def upload(request):
        same_origin(request)
        try:
            directory = media_directory(root(request), request.query.get("project_id"))
        except ValueError as error:
            raise web.HTTPBadRequest(text=str(error))
        reader = await request.multipart()
        part = await reader.next()
        if part is None or part.name != "file" or not part.filename:
            raise web.HTTPBadRequest(text="请选择需要导入的素材")
        extension = Path(part.filename).suffix.lower()
        if extension not in EXTENSIONS:
            raise web.HTTPBadRequest(text="不支持此素材文件类型")
        path = media_path(directory, uuid.uuid4().hex + extension)
        path.parent.mkdir(parents=True, exist_ok=True)
        try:
            with path.open("wb") as stream:
                while chunk := await part.read_chunk(1024 * 1024):
                    await asyncio.to_thread(stream.write, chunk)
            asset = await asyncio.to_thread(probe, path, Path(part.filename.replace("\\", "/")).name)
        except (av.error.FFmpegError, OSError, ValueError) as error:
            path.unlink(missing_ok=True)
            raise web.HTTPBadRequest(text=f"无法读取素材：{error}")
        return web.json_response(asset)

    @routes.post("/capcut/media/from-comfy")
    async def import_comfy(request):
        same_origin(request)
        try:
            directory = media_directory(root(request), request.query.get("project_id"))
            data = await request.json()
            folder = folder_paths.get_directory_by_type(data.get("type", "output"))
            if folder is None:
                raise ValueError("不支持此 ComfyUI 素材目录")
            source = (Path(folder) / data.get("subfolder", "") / data["filename"]).resolve()
            if not source.is_relative_to(Path(folder).resolve()) or source.suffix.lower() not in EXTENSIONS or not source.is_file():
                raise ValueError("ComfyUI 素材不存在或路径无效")
            destination = media_path(directory, uuid.uuid4().hex + source.suffix.lower())
            destination.parent.mkdir(parents=True, exist_ok=True)
            await asyncio.to_thread(shutil.copyfile, source, destination)
            try:
                asset = await asyncio.to_thread(probe, destination, source.name)
            except (av.error.FFmpegError, OSError, ValueError):
                destination.unlink(missing_ok=True)
                raise
            asset["source"] = "generated"
        except (av.error.FFmpegError, OSError, ValueError, KeyError, TypeError) as error:
            raise web.HTTPBadRequest(text=f"无法导入生成结果：{error}")
        return web.json_response(asset)

    @routes.get("/capcut/media/{name}")
    async def read_media(request):
        try:
            directory = media_directory(root(request), request.query.get("project_id"))
            path = media_path(directory, request.match_info["name"])
        except ValueError as error:
            raise web.HTTPBadRequest(text=str(error))
        if not path.is_file():
            raise web.HTTPNotFound(text="素材文件不存在")
        return web.FileResponse(path)

    @routes.post("/capcut/export")
    async def export(request):
        same_origin(request)
        executable = shutil.which("ffmpeg")
        if executable is None:
            raise web.HTTPBadRequest(text="未找到 FFmpeg，请将其添加到 PATH 后重启 ComfyUI")
        directory = root(request)
        destination = directory / "exports" / f"{uuid.uuid4().hex}.mp4"
        destination.parent.mkdir(parents=True, exist_ok=True)
        try:
            project = validate_project(await request.json())
            media = await asyncio.to_thread(prepare_project_media, directory, project)
            command = await asyncio.to_thread(export_command, project, media, destination, executable)
        except (ValueError, TypeError, av.error.FFmpegError, OSError) as error:
            raise web.HTTPBadRequest(text=str(error))
        process = await asyncio.create_subprocess_exec(*command, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        try:
            _, errors = await process.communicate()
        except asyncio.CancelledError:
            process.kill()
            await process.wait()
            destination.unlink(missing_ok=True)
            raise
        if process.returncode:
            destination.unlink(missing_ok=True)
            raise web.HTTPBadRequest(text="导出失败：" + errors.decode("utf-8", errors="replace")[-1800:])
        return web.json_response({"file": destination.name, "name": project["name"] + ".mp4"})

    @routes.get("/capcut/exports/{name}")
    async def read_export(request):
        name = request.match_info["name"]
        if not FILE_NAME.fullmatch(name) or not name.endswith(".mp4"):
            raise web.HTTPBadRequest(text="无效的导出文件名")
        path = root(request) / "exports" / name
        if not path.is_file():
            raise web.HTTPNotFound(text="导出文件不存在")
        return web.FileResponse(path)
