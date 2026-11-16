import hashlib
import importlib.util
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import AsyncMock, patch

from aiohttp import ClientSession, web
from aiohttp.test_utils import TestServer
from test_studio import studio


spec = importlib.util.spec_from_file_location("capcut_tracking_test", Path(__file__).parents[1] / "tracking.py")
tracking = importlib.util.module_from_spec(spec)
with patch.dict(sys.modules, {"folder_paths": studio.folder_paths}):
    spec.loader.exec_module(tracking)


class TrackingTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        patcher = patch.object(tracking.folder_paths, "models_dir", str(self.root), create=True)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.service = tracking.TrackingService()
        self.addAsyncCleanup(self.service.close_worker)
        self.frame = self.root / "frame.rgba"
        self.frame.write_bytes(b"\x80\x20\x10\xff" * 16 * 16)
        self.payload = {"width": 16, "height": 16, "mask": bytes([255] * 256)}

    async def test_status_and_invalid_input_do_not_download(self):
        with patch.object(tracking, "ClientSession", side_effect=AssertionError("network")):
            self.assertFalse(self.service.status()["trackingModelReady"])
            for payload, path in [({**self.payload, "width": 17}, self.frame), (self.payload, None), ({**self.payload, "mask": b""}, self.frame), ({**self.payload, "mask": bytes(256)}, self.frame)]:
                with self.subTest(payload=payload), self.assertRaises(ValueError):
                    await self.service.start("owner", payload, path)
        self.assertFalse(self.service.busy)
        self.assertIsNone(self.service.process)

    async def test_download_resume_integrity_and_retry(self):
        data = b"verified-tracker-weights" * 1000
        requests = []
        corrupt = False

        async def download(request):
            offset = int(request.headers.get("Range", "bytes=0-")[6:-1])
            requests.append(offset)
            body = (b"x" * len(data) if corrupt else data)[offset:]
            return web.Response(body=body, status=206, headers={"Content-Range": f"bytes {offset}-{len(data)-1}/{len(data)}"})

        app = web.Application()
        app.router.add_get("/model", download)
        server = TestServer(app)
        await server.start_server()
        self.addAsyncCleanup(server.close)
        path = self.root / "weights.pth"
        partial = path.with_name(path.name + ".part")
        partial.write_bytes(data[:100])
        with patch.object(tracking, "MODEL_BYTES", len(data)), patch.object(tracking, "MODEL_MD5", hashlib.md5(data).hexdigest()):
            async with ClientSession() as session:
                await self.service.download_file(session, server.make_url("/model"), path)
                self.assertEqual(requests, [100])
                self.assertEqual(path.read_bytes(), data)
                corrupt = True
                with self.assertRaisesRegex(ValueError, "校验失败"):
                    await self.service.download_file(session, server.make_url("/model"), path)
                self.assertEqual(path.read_bytes(), data)
                self.assertFalse(partial.exists())
                corrupt = False
                await self.service.download_file(session, server.make_url("/model"), path)
                self.assertEqual(path.read_bytes(), data)

    async def test_worker_lifecycle_owner_isolation_and_idle_cleanup(self):
        worker = self.root / "worker.py"
        worker.write_text('''import base64, json, sys
print(json.dumps({"type":"ready","device":"cpu"}), flush=True)
for line in sys.stdin:
    request = json.loads(line)
    reply = {"id":request["id"],"elapsedSeconds":0.01}
    if request["action"] == "step":
        reply["maskBase64"] = base64.b64encode(bytes([255])*request["width"]*request["height"]).decode()
    print(json.dumps(reply), flush=True)
''', encoding="utf-8")
        with patch.object(tracking, "WORKER", worker), patch.object(self.service, "ensure_model", new=AsyncMock()):
            session = await self.service.start("owner", self.payload, self.frame)
            process = self.service.process
            payload = {**self.payload, "sessionId": session["sessionId"]}
            with self.assertRaises(ValueError):
                await self.service.step("other-owner", payload, self.frame)
            with self.assertRaises(ValueError):
                await self.service.end("other-owner", session["sessionId"])
            with self.assertRaises(ValueError):
                await self.service.start("other-owner", self.payload, self.frame)
            self.assertIsNone(process.returncode)
            result = await self.service.step("owner", payload, self.frame)
            self.assertEqual(result, (bytes([255] * 256), 16, 16, 0.01))
            await self.service.expire("owner", "old-session")
            self.assertIs(self.service.process, process)
            await self.service.expire("owner", session["sessionId"])
            self.assertIsNotNone(process.returncode)
            self.assertIsNone(self.service.process)
            self.assertIsNone(self.service.idle_timer)
            self.assertFalse(self.service.busy)

            session = await self.service.start("owner", self.payload, self.frame)
            process = self.service.process
            with patch.object(self.service, "send_frame", new=AsyncMock(side_effect=RuntimeError("推理失败"))):
                with self.assertRaisesRegex(RuntimeError, "推理失败"):
                    await self.service.step("owner", {**self.payload, "sessionId": session["sessionId"]}, self.frame)
            self.assertIsNotNone(process.returncode)
            self.assertIsNone(self.service.process)
            self.assertFalse(self.service.busy)

    async def test_download_failure_resets_busy_state(self):
        with patch.object(self.service, "ensure_model", new=AsyncMock(side_effect=RuntimeError("下载中断"))):
            with self.assertRaisesRegex(RuntimeError, "下载中断"):
                await self.service.start("owner", self.payload, self.frame)
        self.assertFalse(self.service.busy)
        self.assertEqual(self.service.state["phase"], "error")
        self.assertIsNone(self.service.session_id)
