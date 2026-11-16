import asyncio
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time

from aiohttp import ClientError, ClientSession, ClientTimeout

import folder_paths


MODEL = json.loads((Path(__file__).parent / "caption_model.json").read_text(encoding="utf-8"))
TOTAL_BYTES = sum(item["size"] for item in MODEL["files"])


def file_digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def validate_audio(path):
    if path is None or path.stat().st_size <= 44:
        raise ValueError("缺少可识别的轨道音频")
    with path.open("rb") as stream:
        header = stream.read(12)
    if header[:4] != b"RIFF" or header[8:12] != b"WAVE":
        raise ValueError("字幕识别需要 WAV 轨道音频")


class CaptionService:
    def __init__(self):
        self.busy = False
        self.state = {"phase": "idle"}

    @property
    def model_directory(self):
        return Path(folder_paths.models_dir) / "moss-transcribe-diarize"

    def status(self):
        ready = all((self.model_directory / item["name"]).is_file() and (self.model_directory / item["name"]).stat().st_size == item["size"] for item in MODEL["files"])
        return {**self.state, "modelReady": ready, "busy": self.busy}

    async def ensure_model(self):
        self.model_directory.mkdir(parents=True, exist_ok=True)
        self.state = {"phase": "preparing-model", "detail": "正在校验字幕模型"}
        completed = 0
        async with ClientSession(timeout=ClientTimeout(total=None, connect=30, sock_read=120)) as session:
            for item in MODEL["files"]:
                path = self.model_directory / item["name"]
                if path.is_file() and path.stat().st_size == item["size"] and await asyncio.to_thread(file_digest, path) == item["sha256"]:
                    completed += item["size"]
                    continue
                await self.download_file(session, item, path, completed)
                completed += item["size"]

    async def download_file(self, session, item, path, completed):
        partial = path.with_name(path.name + ".part")
        offset = partial.stat().st_size if partial.is_file() else 0
        if offset == item["size"] and await asyncio.to_thread(file_digest, partial) == item["sha256"]:
            partial.replace(path)
            return
        if offset >= item["size"]:
            partial.unlink()
            offset = 0
        url = f"https://modelscope.cn/models/{MODEL['repository']}/resolve/{MODEL['revision']}/{item['name']}"
        self.state = {"phase": "downloading-model", "detail": "正在连接字幕模型下载源（约 1.83 GB）", "progress": round((completed + offset) / TOTAL_BYTES * 100, 1), "transferredBytes": completed + offset, "totalBytes": TOTAL_BYTES}
        async with session.get(url, headers={"Range": f"bytes={offset}-"} if offset else {}) as response:
            response.raise_for_status()
            if response.status == 206:
                if not response.headers.get("Content-Range", "").startswith(f"bytes {offset}-"):
                    raise ValueError("字幕模型下载断点无效，请重试")
            elif response.status == 200:
                offset = 0
            else:
                raise ValueError(f"字幕模型下载失败（{response.status}）")
            with partial.open("ab" if offset else "wb") as stream:
                async for chunk in response.content.iter_chunked(1024 * 1024):
                    if offset + len(chunk) > item["size"]:
                        raise ValueError("字幕模型下载大小不符，请重试")
                    await asyncio.to_thread(stream.write, chunk)
                    offset += len(chunk)
                    transferred = completed + offset
                    progress = round(transferred / TOTAL_BYTES * 100, 1)
                    self.state = {"phase": "downloading-model", "detail": f"正在下载字幕模型 {progress}%（约 1.83 GB）", "progress": progress, "transferredBytes": transferred, "totalBytes": TOTAL_BYTES}
        if offset != item["size"]:
            raise ValueError("字幕模型未下载完整，请重试以继续下载")
        if await asyncio.to_thread(file_digest, partial) != item["sha256"]:
            partial.unlink()
            raise ValueError("字幕模型校验失败，请重试")
        partial.replace(path)

    async def transcribe(self, audio_path):
        validate_audio(audio_path)
        if self.busy:
            raise ValueError("已有字幕识别任务正在运行，请稍后重试")
        self.busy = True
        started = time.monotonic()
        try:
            await self.ensure_model()
            result = await self.run_worker(audio_path)
            self.state = {"phase": "complete", "detail": "字幕识别完成", "progress": 100}
            return {"segments": result["segments"], "elapsedSeconds": round(time.monotonic() - started, 2)}
        except (ValueError, RuntimeError, OSError, ClientError, asyncio.TimeoutError) as error:
            self.state = {"phase": "error", "detail": str(error)}
            raise
        except asyncio.CancelledError:
            self.state = {"phase": "idle", "detail": "字幕识别已取消，可重新识别"}
            raise
        finally:
            self.busy = False

    async def run_worker(self, audio_path):
        self.state = {"phase": "loading-model", "detail": "正在加载字幕模型（CPU）"}
        environment = {**os.environ, "HF_HUB_OFFLINE": "1", "TRANSFORMERS_OFFLINE": "1", "HF_HUB_DISABLE_TELEMETRY": "1", "HF_HUB_DISABLE_PROGRESS_BARS": "1", "TOKENIZERS_PARALLELISM": "false", "PYTHONIOENCODING": "utf-8"}
        result_path = audio_path.with_suffix(".captions.json")
        log_path = audio_path.with_suffix(".captions.log")
        process = None
        try:
            with log_path.open("wb") as log:
                process = await asyncio.create_subprocess_exec(sys.executable, "-u", str(Path(__file__).parent / "caption_worker.py"), str(self.model_directory), str(audio_path), str(result_path), stdout=asyncio.subprocess.PIPE, stderr=log, env=environment, creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0)
                async for line in process.stdout:
                    event = json.loads(line)
                    self.state = {"phase": event["phase"], "detail": event["detail"]}
                code = await process.wait()
            if code:
                with log_path.open("rb") as log:
                    log.seek(max(0, log_path.stat().st_size - 4000))
                    diagnostic = log.read().decode("utf-8", errors="replace").strip()
                if "ModuleNotFoundError" in diagnostic or "ImportError" in diagnostic:
                    raise RuntimeError("字幕依赖缺失或版本不符，请用 ComfyUI 的 Python 安装插件 requirements.txt。")
                raise RuntimeError("字幕识别失败：" + (diagnostic.splitlines()[-1] if diagnostic else f"进程退出码 {code}"))
            return json.loads(result_path.read_text(encoding="utf-8"))
        finally:
            if process is not None and process.returncode is None:
                process.terminate()
                await process.wait()
            result_path.unlink(missing_ok=True)
            log_path.unlink(missing_ok=True)
