import asyncio
import hashlib
import importlib.util
import io
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import AsyncMock, patch
import wave

from aiohttp import ClientError, ClientSession, web
from aiohttp.test_utils import TestServer
from test_studio import studio


spec = importlib.util.spec_from_file_location("capcut_captions_test", Path(__file__).parents[1] / "captions.py")
captions = importlib.util.module_from_spec(spec)
with patch.dict(sys.modules, {"folder_paths": studio.folder_paths}):
    spec.loader.exec_module(captions)


def wav_bytes():
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as stream:
        stream.setparams((1, 2, 16000, 0, "NONE", "not compressed"))
        stream.writeframes(b"\x01\x00" * 1600)
    return buffer.getvalue()


class CaptionTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        patcher = patch.object(captions.folder_paths, "models_dir", str(self.root), create=True)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.service = captions.CaptionService()
        self.audio = self.root / "audio.wav"
        self.audio.write_bytes(wav_bytes())

    async def test_status_is_local_and_invalid_audio_never_downloads(self):
        with patch.object(captions, "ClientSession", side_effect=AssertionError("network")):
            self.assertFalse(self.service.status()["modelReady"])
            self.audio.write_bytes(b"not a wav" * 10)
            with self.assertRaisesRegex(ValueError, "WAV"):
                await self.service.transcribe(self.audio)
            with self.assertRaises(ValueError):
                await self.service.transcribe(None)
        self.assertFalse(self.service.busy)

    async def test_download_resumes_and_rejects_corrupt_content(self):
        data = b"model-contents" * 1000
        item = {"name": "test.bin", "size": len(data), "sha256": hashlib.sha256(data).hexdigest()}
        requests = []
        async def download(request):
            requests.append(request.headers.get("Range"))
            offset = int(request.headers.get("Range", "bytes=0-")[6:-1])
            return web.Response(body=data[offset:], status=206, headers={"Content-Range": f"bytes {offset}-{len(data)-1}/{len(data)}"})
        app = web.Application()
        app.router.add_get("/model", download)
        server = TestServer(app)
        await server.start_server()
        self.addAsyncCleanup(server.close)
        path = self.root / "test.bin"
        path.with_suffix(".bin.part").write_bytes(data[:100])
        async with ClientSession() as session:
            class LocalSource:
                def get(inner, url, **kwargs):
                    self.assertIn(captions.MODEL["revision"], url)
                    return session.get(server.make_url("/model"), **kwargs)
            await self.service.download_file(LocalSource(), item, path, 0)
            self.assertEqual(requests, ["bytes=100-"])
            self.assertEqual(path.read_bytes(), data)
            self.assertFalse(path.with_suffix(".bin.part").exists())
            with self.assertRaisesRegex(ValueError, "校验失败"):
                await self.service.download_file(LocalSource(), {**item, "sha256": "0" * 64}, path, 0)
            self.assertEqual(path.read_bytes(), data)
            self.assertFalse(path.with_suffix(".bin.part").exists())

    async def test_busy_failure_and_cancellation_allow_retry(self):
        entered = asyncio.Event()
        release = asyncio.Event()
        async def prepare():
            entered.set()
            await release.wait()
        with patch.object(self.service, "ensure_model", side_effect=prepare), patch.object(self.service, "run_worker", new=AsyncMock(return_value={"segments": [{"startTime": 0, "duration": 1, "text": "测试", "speaker": "S01"}]})):
            task = asyncio.create_task(self.service.transcribe(self.audio))
            await entered.wait()
            self.assertTrue(self.service.status()["busy"])
            with self.assertRaisesRegex(ValueError, "正在运行"):
                await self.service.transcribe(self.audio)
            task.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await task
            self.assertFalse(self.service.busy)
            release.set()
            result = await self.service.transcribe(self.audio)
            self.assertEqual(result["segments"][0]["text"], "测试")
            self.assertEqual(self.service.status()["phase"], "complete")
        with patch.object(self.service, "ensure_model", side_effect=ClientError("download interrupted")):
            with self.assertRaises(ClientError):
                await self.service.transcribe(self.audio)
            self.assertEqual(self.service.status()["phase"], "error")
            self.assertFalse(self.service.busy)

    async def test_worker_failure_surfaces_dependency_error_and_cleans_files(self):
        class Process:
            returncode = 1
            stdout = asyncio.StreamReader()
            stdout.feed_eof()
            async def wait(self):
                return 1
        async def create(*args, **kwargs):
            self.assertEqual(kwargs["env"]["HF_HUB_OFFLINE"], "1")
            kwargs["stderr"].write(b"ModuleNotFoundError: No module named 'transformers'")
            return Process()
        with patch.object(captions.asyncio, "create_subprocess_exec", side_effect=create):
            with self.assertRaisesRegex(RuntimeError, "requirements.txt"):
                await self.service.run_worker(self.audio)
        self.assertFalse(self.audio.with_suffix(".captions.log").exists())
        self.assertFalse(self.audio.with_suffix(".captions.json").exists())


if __name__ == "__main__":
    unittest.main()
