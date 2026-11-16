import asyncio
import base64
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import uuid

from aiohttp import ClientError, ClientSession, ClientTimeout

import folder_paths


MODEL_NAME = "cutie-base-mega.pth"
MODEL_BYTES = 140_443_788
MODEL_MD5 = "a6071de6136982e396851903ab4c083a"
MODEL_URLS = (
    f"https://modelscope.cn/models/leisongde/Raccoon_dataset/resolve/master/{MODEL_NAME}?view=false",
    f"https://github.com/hkchengrex/Cutie/releases/download/v1.0/{MODEL_NAME}",
)
MAX_FRAME_BYTES = 2560 * 2560 * 4
IDLE_SECONDS = 120
WORKER = Path(__file__).parent / "vendor" / "custom-cutout" / "vos_runner.py"


def model_matches(path):
    if not path.is_file() or path.stat().st_size != MODEL_BYTES:
        return False
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "md5").hexdigest() == MODEL_MD5


def validate_frame(payload, path, expected=None):
    width, height = payload.get("width"), payload.get("height")
    if type(width) is not int or type(height) is not int or not (16 <= width <= 2560 and 16 <= height <= 2560):
        raise ValueError("视频对象跟踪画面尺寸无效")
    if path is None or path.stat().st_size != width * height * 4:
        raise ValueError("视频对象跟踪画面数据无效")
    if expected is not None and (width, height) != expected:
        raise ValueError("跟踪画面尺寸发生变化，请重新选择目标")
    return width, height


class TrackingService:
    def __init__(self):
        self.busy = False
        self.state = {"phase": "idle", "detail": "首次开始跟踪时下载 Cutie 模型（约 134 MB）"}
        self.process = None
        self.log = None
        self.session_id = None
        self.owner = None
        self.size = None
        self.idle_timer = None

    @property
    def model_path(self):
        return Path(folder_paths.models_dir) / "custom-cutout" / MODEL_NAME

    def status(self):
        path = self.model_path
        ready = path.is_file() and path.stat().st_size == MODEL_BYTES
        return {**self.state, "modelReady": False, "trackingModelReady": ready, "busy": self.busy}

    async def ensure_model(self):
        self.state = {"phase": "loading-tracker", "detail": "正在校验视频对象跟踪模型"}
        path = self.model_path
        if await asyncio.to_thread(model_matches, path):
            return
        path.parent.mkdir(parents=True, exist_ok=True)
        async with ClientSession(timeout=ClientTimeout(total=None, connect=30, sock_read=120)) as session:
            for index, url in enumerate(MODEL_URLS):
                try:
                    await self.download_file(session, url, path)
                    return
                except (ValueError, OSError, ClientError, asyncio.TimeoutError):
                    if index == len(MODEL_URLS) - 1:
                        raise

    async def download_file(self, session, url, path):
        partial = path.with_name(path.name + ".part")
        if await asyncio.to_thread(model_matches, partial):
            partial.replace(path)
            return
        offset = partial.stat().st_size if partial.is_file() else 0
        if offset >= MODEL_BYTES:
            partial.unlink()
            offset = 0
        self.state = {"phase": "downloading-tracker", "detail": "正在下载 Cutie 跟踪模型（约 134 MB）", "progress": round(offset / MODEL_BYTES * 100, 1)}
        async with session.get(url, headers={"Range": f"bytes={offset}-"} if offset else {}) as response:
            response.raise_for_status()
            if response.status == 206:
                if not response.headers.get("Content-Range", "").startswith(f"bytes {offset}-"):
                    raise ValueError("跟踪模型下载断点无效，请重试")
            elif response.status == 200:
                offset = 0
            else:
                raise ValueError(f"跟踪模型下载失败（{response.status}）")
            with partial.open("ab" if offset else "wb") as stream:
                async for chunk in response.content.iter_chunked(1024 * 1024):
                    if offset + len(chunk) > MODEL_BYTES:
                        raise ValueError("跟踪模型文件大小异常，请重试")
                    await asyncio.to_thread(stream.write, chunk)
                    offset += len(chunk)
                    self.state["progress"] = round(offset / MODEL_BYTES * 100, 1)
        if offset != MODEL_BYTES:
            raise ValueError("跟踪模型尚未下载完整，请重试以继续下载")
        if not await asyncio.to_thread(model_matches, partial):
            partial.unlink()
            raise ValueError("跟踪模型校验失败，请重试")
        partial.replace(path)

    def check_session(self, owner, session_id):
        if not self.session_id or self.owner != owner or self.session_id != session_id:
            raise ValueError("视频对象跟踪会话无效或已结束，请重新选择目标")
        if self.busy:
            raise ValueError("跟踪正在处理，请稍后重试")

    def cancel_expiry(self):
        if self.idle_timer is not None:
            self.idle_timer.cancel()
            self.idle_timer = None

    def schedule_expiry(self):
        self.cancel_expiry()
        owner, session_id = self.owner, self.session_id
        self.idle_timer = asyncio.get_running_loop().call_later(IDLE_SECONDS, lambda: asyncio.create_task(self.expire(owner, session_id)))

    async def expire(self, owner, session_id):
        if self.session_id == session_id and self.owner == owner and not self.busy:
            await self.end(owner, session_id)

    async def close_worker(self):
        self.cancel_expiry()
        process, self.process = self.process, None
        self.session_id = self.owner = self.size = None
        try:
            if process is not None and process.returncode is None:
                process.terminate()
                try:
                    await asyncio.wait_for(process.wait(), 5)
                except asyncio.TimeoutError:
                    process.kill()
                    await process.wait()
        finally:
            if self.log is not None:
                self.log.close()
                self.log = None

    async def read_message(self):
        try:
            line = await asyncio.wait_for(self.process.stdout.readline(), 180)
        except asyncio.TimeoutError as error:
            raise RuntimeError("视频对象跟踪处理超时，请重新选择目标后重试") from error
        if not line:
            self.log.seek(0, os.SEEK_END)
            self.log.seek(max(0, self.log.tell() - 4000))
            diagnostic = self.log.read().decode("utf-8", errors="replace").strip()
            raise RuntimeError("视频对象跟踪进程退出：" + (diagnostic.splitlines()[-1] if diagnostic else "无返回数据"))
        result = json.loads(line)
        if result.get("error"):
            raise RuntimeError("视频对象跟踪失败：" + result["error"])
        return result

    async def send_frame(self, action, payload, path):
        message = {"id": uuid.uuid4().hex, "action": action, "width": payload["width"], "height": payload["height"], "rgbaBase64": base64.b64encode(await asyncio.to_thread(path.read_bytes)).decode("ascii")}
        if action == "start":
            message["maskBase64"] = base64.b64encode(payload["mask"]).decode("ascii")
        self.process.stdin.write((json.dumps(message) + "\n").encode("utf-8"))
        await self.process.stdin.drain()
        result = await self.read_message()
        if result.get("id") != message["id"]:
            raise RuntimeError("跟踪进程返回的帧序号不符")
        return result

    async def start(self, owner, payload, path):
        size = validate_frame(payload, path)
        mask = payload.get("mask")
        if not isinstance(mask, bytes) or len(mask) != size[0] * size[1] or not any(value >= 128 for value in mask):
            raise ValueError("视频对象跟踪种子蒙版无效")
        if self.busy or (self.session_id and self.owner != owner):
            raise ValueError("已有跟踪任务正在运行，请稍后重试")
        self.busy = True
        try:
            await self.close_worker()
            await self.ensure_model()
            self.state = {"phase": "loading-tracker", "detail": "正在加载 Cutie 跟踪模型"}
            self.log = tempfile.TemporaryFile()
            device = "cpu" if "--cpu" in sys.argv else "auto"
            self.process = await asyncio.create_subprocess_exec(sys.executable, "-u", str(WORKER), "--model", str(self.model_path), "--device", device, stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=self.log, limit=MAX_FRAME_BYTES * 2, env={**os.environ, "PYTHONIOENCODING": "utf-8"}, creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0)
            ready = await self.read_message()
            if ready.get("type") != "ready":
                raise RuntimeError("跟踪进程未能加载模型")
            result = await self.send_frame("start", payload, path)
            self.session_id = uuid.uuid4().hex
            self.owner, self.size = owner, size
            self.state = {"phase": "ready", "detail": f"Cutie 跟踪已就绪（{ready['device']}）"}
            self.schedule_expiry()
            return {"sessionId": self.session_id, "elapsedSeconds": result["elapsedSeconds"]}
        except (ValueError, RuntimeError, OSError, ClientError, asyncio.TimeoutError, asyncio.CancelledError) as error:
            await self.close_worker()
            self.state = {"phase": "error", "detail": str(error) or "跟踪已取消"}
            raise
        finally:
            self.busy = False

    async def step(self, owner, payload, path):
        self.check_session(owner, payload.get("sessionId"))
        width, height = validate_frame(payload, path, self.size)
        self.busy = True
        self.cancel_expiry()
        try:
            self.state = {"phase": "tracking", "detail": "正在跟踪视频中的对象"}
            result = await self.send_frame("step", payload, path)
            mask = base64.b64decode(result["maskBase64"], validate=True)
            if len(mask) != width * height:
                raise RuntimeError("跟踪模型返回的蒙版尺寸无效")
            self.state = {"phase": "ready", "detail": "视频对象跟踪完成一帧"}
            self.schedule_expiry()
            return mask, width, height, result["elapsedSeconds"]
        except (ValueError, RuntimeError, OSError, asyncio.TimeoutError, asyncio.CancelledError) as error:
            await self.close_worker()
            self.state = {"phase": "error", "detail": str(error) or "跟踪已取消"}
            raise
        finally:
            self.busy = False

    async def end(self, owner, session_id):
        if self.session_id is None:
            return
        self.check_session(owner, session_id)
        self.busy = True
        try:
            await self.close_worker()
            self.state = {"phase": "ready", "detail": "跟踪已结束，推理资源已释放"}
        finally:
            self.busy = False
