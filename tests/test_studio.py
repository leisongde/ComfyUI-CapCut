import asyncio
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import AsyncMock, patch

from aiohttp import FormData, web
from aiohttp.test_utils import TestClient, TestServer
from test_api import api, project


package = types.ModuleType("capcut_studio_test")
package.__path__ = [str(Path(__file__).parents[1])]
spec = importlib.util.spec_from_file_location("capcut_studio_test.studio", Path(__file__).parents[1] / "studio.py")
studio = importlib.util.module_from_spec(spec)
with patch.dict(sys.modules, {"capcut_studio_test": package, "capcut_studio_test.api": api, "folder_paths": api.folder_paths, "server": types.SimpleNamespace(PromptServer=None)}):
    spec.loader.exec_module(studio)


class StudioTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.directory = Path(temporary.name)
        self.input = self.directory / "input"
        manager = types.SimpleNamespace(get_request_user_filepath=lambda request, filename: str(self.directory / "user" / request.headers.get("comfy-user", "default") / filename))
        routes = web.RouteTableDef()
        server = types.SimpleNamespace(instance=types.SimpleNamespace(routes=routes, user_manager=manager))
        for patcher in [patch.object(api.folder_paths, "get_input_directory", return_value=str(self.input), create=True), patch.object(api, "PromptServer", server), patch.object(studio, "PromptServer", server)]:
            patcher.start()
            self.addCleanup(patcher.stop)
        studio.register_studio_routes()
        app = web.Application()
        app.add_routes(routes)
        self.client = TestClient(TestServer(app))
        await self.client.start_server()
        self.addAsyncCleanup(self.client.close)
        self.doc = await self.op("projects:create", {})
        self.id = self.doc["metadata"]["id"]

    async def op(self, name, payload, data=None, user="default"):
        options = {"json": payload} if data is None else {"data": self.form(payload, data)}
        response = await self.client.post("/capcut/studio/op/" + name, headers={"comfy-user": user}, **options)
        self.assertEqual(response.status, 200, await response.text())
        return await response.json()

    def form(self, payload, data):
        form = FormData()
        form.add_field("payload", json.dumps(payload))
        form.add_field("bytes", data, filename="resource.bin")
        return form

    async def test_minimax_key_persists_per_user_outside_projects_and_can_be_cleared(self):
        self.assertEqual(await self.op("capcut:minimax-key:get", {}), {"key": ""})
        saved = await self.op("capcut:minimax-key:set", {"key": "  local-test-key  "})
        self.assertEqual(saved, {"saved": True})
        self.assertEqual(await self.op("capcut:minimax-key:get", {}), {"key": "local-test-key"})
        self.assertEqual(await self.op("capcut:minimax-key:get", {}, user="another-user"), {"key": ""})
        self.assertNotIn("local-test-key", json.dumps(await self.op("projects:load", {"id": self.id})))
        path = self.directory / "user" / "default" / "capcut" / "minimax-key.json"
        self.assertEqual(json.loads(path.read_text(encoding="utf-8")), {"prompt_api_key": "local-test-key"})
        self.assertEqual(await self.op("capcut:minimax-key:set", {"key": ""}), {"saved": False})
        self.assertEqual(await self.op("capcut:minimax-key:get", {}), {"key": ""})
        self.assertFalse(path.exists())

    async def test_motion_transfer_key_is_separate_per_user_and_not_stored_in_projects(self):
        await self.op("capcut:minimax-key:set", {"key": "other-provider-key"})
        self.assertEqual(await self.op("capcut:motion-transfer-key:get", {}), {"key": ""})
        self.assertEqual(await self.op("capcut:motion-transfer-key:set", {"key": "  motion-test-key  "}), {"saved": True})
        self.assertEqual(await self.op("capcut:motion-transfer-key:get", {}), {"key": "motion-test-key"})
        self.assertEqual(await self.op("capcut:motion-transfer-key:get", {}, user="another-user"), {"key": ""})
        self.assertEqual(await self.op("capcut:minimax-key:get", {}), {"key": "other-provider-key"})
        self.assertNotIn("motion-test-key", json.dumps(await self.op("projects:load", {"id": self.id})))
        path = self.directory / "user" / "default" / "capcut" / "motion-transfer-key.json"
        self.assertEqual(json.loads(path.read_text(encoding="utf-8")), {"prompt_api_key": "motion-test-key"})
        self.assertEqual(await self.op("capcut:motion-transfer-key:set", {"key": ""}), {"saved": False})
        self.assertEqual(await self.op("capcut:motion-transfer-key:get", {}), {"key": ""})
        self.assertFalse(path.exists())
        self.assertEqual(await self.op("capcut:minimax-key:get", {}), {"key": "other-provider-key"})

    async def test_delete_project_removes_documents_and_index_but_keeps_media_and_exports(self):
        other = await self.op("projects:create", {"name": "保留的工程"})
        await self.op("media:save", {"projectId": self.id, "metadata": {"id": "clip", "type": "video", "name": "sample.mp4"}}, b"video")
        directory = self.directory / "user" / "default" / "capcut"
        legacy = project()
        legacy["id"] = self.id
        api.save_json(api.project_path(directory, self.id), legacy)
        exported = directory / "exports" / "saved.mp4"
        exported.parent.mkdir(parents=True)
        exported.write_bytes(b"exported")
        media = list((self.input / "CapCut" / "default" / self.id).iterdir())

        self.assertEqual(await self.op("projects:remove", {"id": self.id}), {"removed": True})
        self.assertEqual([item["id"] for item in await self.op("projects:list", {})], [other["metadata"]["id"]])
        self.assertFalse(studio.project_file(directory, self.id).exists())
        self.assertFalse(studio.media_index_path(directory, self.id).exists())
        self.assertFalse(api.project_path(directory, self.id).exists())
        self.assertEqual(media[0].read_bytes(), b"video")
        self.assertEqual(exported.read_bytes(), b"exported")
        self.assertEqual(await self.op("projects:load", {"id": other["metadata"]["id"]}), other)
        response = await self.client.post("/capcut/studio/op/projects:load", json={"id": self.id})
        self.assertEqual(response.status, 400)
        self.assertEqual(await self.op("projects:remove", {"id": self.id}), {"removed": True})

    async def test_console_open_creates_a_project_when_the_saved_project_was_deleted(self):
        await self.op("projects:remove", {"id": self.id})
        response = await self.client.post("/capcut/studio/open", json={"project_id": self.id, "name": "新剪辑工程"})
        self.assertEqual(response.status, 200, await response.text())
        metadata = await response.json()
        self.assertNotEqual(metadata["id"], self.id)
        self.assertEqual(metadata["name"], "新剪辑工程")
        document = await self.op("projects:load", {"id": metadata["id"]})
        self.assertEqual(document["metadata"], metadata)
        self.assertEqual(document["scenes"][0]["tracks"][0]["elements"], [])
        response = await self.client.post("/capcut/studio/open", json={"project_id": metadata["id"]})
        self.assertEqual(response.status, 200, await response.text())
        self.assertEqual((await response.json())["id"], metadata["id"])
        self.assertEqual([item["id"] for item in await self.op("projects:list", {})], [metadata["id"]])

    async def test_console_open_creates_without_an_id_but_does_not_hide_invalid_projects(self):
        response = await self.client.post("/capcut/studio/open", json={})
        self.assertEqual(response.status, 200, await response.text())
        metadata = await response.json()
        self.assertNotEqual(metadata["id"], self.id)
        self.assertEqual(metadata["name"], "未命名工程")
        directory = self.directory / "user" / "default" / "capcut"
        path = studio.project_file(directory, self.id)
        path.write_text("invalid-json", encoding="utf-8")
        for value in ["../escape", self.id]:
            response = await self.client.post("/capcut/studio/open", json={"project_id": value})
            self.assertEqual(response.status, 400)
        self.assertEqual(path.read_text(encoding="utf-8"), "invalid-json")
        self.assertEqual(len(list((directory / "studio").glob("*.json"))), 2)

    async def test_delete_project_rejects_unsafe_ids_and_isolates_users(self):
        await self.op("projects:save", {"project": self.doc}, user="another")
        await self.op("projects:remove", {"id": self.id}, user="another")
        self.assertEqual(await self.op("projects:load", {"id": self.id}), self.doc)
        self.assertEqual(await self.op("projects:list", {}, user="another"), [])
        for value in ["../escape", "", "a" * 32 + ".json", None]:
            response = await self.client.post("/capcut/studio/op/projects:remove", json={"id": value})
            self.assertEqual(response.status, 400)
        response = await self.client.post("/capcut/studio/op/projects:remove", headers={"Origin": "https://other.example"}, json={"id": self.id})
        self.assertEqual(response.status, 403)
        self.assertEqual(await self.op("projects:load", {"id": self.id}), self.doc)

    async def test_concurrent_uploads_ranges_and_user_isolation(self):
        async def upload(index):
            await self.op("media:save", {"projectId": self.id, "metadata": {"id": f"clip-{index}", "type": "video", "name": "片段.mp4", "mimeType": "video/mp4"}}, b"0123456789")
        await asyncio.gather(*(upload(index) for index in range(8)))
        records = await self.op("media:list", {"projectId": self.id})
        self.assertEqual(len(records), 8)
        await self.op("media:save", {"projectId": self.id, "metadata": {"id": "sound", "type": "audio", "name": "扇开纸牌", "mimeType": "audio/ogg"}}, b"OggS-audio")
        sound = await self.op("media:read", {"projectId": self.id, "id": "sound"})
        self.assertTrue(sound["metadata"]["fileName"].endswith(".ogg"))
        await self.op("media:remove", {"projectId": self.id, "id": "sound"})
        self.assertEqual(len(list((self.input / "CapCut" / "default" / self.id).glob("*.mp4"))), 8)
        url = f"/capcut/studio/media/{self.id}/clip-0"
        response = await self.client.get(url, headers={"Range": "bytes=2-5"})
        self.assertEqual(response.status, 206)
        self.assertEqual(await response.read(), b"2345")
        response = await self.client.get(url + "?user=another")
        self.assertEqual(response.status, 404)
        await self.op("media:remove", {"projectId": self.id, "id": "clip-0"})
        self.assertEqual(len(await self.op("media:list", {"projectId": self.id})), 7)
        self.assertEqual(len(list((self.input / "CapCut" / "default" / self.id).glob("*.mp4"))), 8)

    async def test_document_resource_and_export_roundtrip(self):
        self.doc["metadata"]["name"] = "中文工程"
        self.doc["scenes"][0]["tracks"][0]["elements"] = [{"id": "text", "type": "text", "content": "字幕", "duration": 2, "startTime": 1, "trimStart": 0, "trimEnd": 0}]
        await self.op("projects:save", {"project": self.doc})
        self.assertEqual(await self.op("projects:load", {"id": self.id}), self.doc)
        await self.op("effects:save", {"metadata": {"id": "test/effect", "name": "测试特效"}}, b"shader-data")
        cached = await self.op("effects:read", {"id": "test/effect"})
        response = await self.client.get(cached["fileUrl"])
        self.assertEqual(await response.read(), b"shader-data")
        self.assertEqual(await self.op("effects:read", {"id": "test/effect"}, user="another"), None)
        exported = await self.op("export:save", {"format": "mp4", "name": "中文工程"}, b"export-data")
        response = await self.client.get(exported["downloadUrl"])
        self.assertEqual(await response.read(), b"export-data")
        self.assertEqual(exported["name"], "中文工程.mp4")
        self.assertFalse(list((self.directory / "user").rglob("*.tmp")))

    async def test_legacy_conversion_keeps_source_offsets_and_originals(self):
        directory = self.directory / "user/default/capcut"
        legacy = project()
        legacy["mediaStorage"] = "input"
        legacy["assets"][0].update(duration=10, hasAudio=True)
        legacy["clips"][0].update({"start": 3, "in": 1, "duration": 2, "speed": 2, "scale": 0.8, "volume": 0.6, "x": 4})
        path = api.media_directory(directory, legacy["id"]) / legacy["assets"][0]["file"]
        path.parent.mkdir(parents=True)
        path.write_bytes(b"original-video")
        api.save_json(api.project_path(directory, legacy["id"]), legacy)
        doc = studio.open_document(directory, legacy["id"])
        element = doc["scenes"][0]["tracks"][1]["elements"][0]
        self.assertEqual((element["startTime"], element["trimStart"], element["duration"], element["trimEnd"], element["playbackRate"]), (3, 1, 2, 5, 2))
        self.assertEqual(element["transform"]["position"]["x"], 4)
        self.assertEqual(element["volume"], 0.6)
        self.assertEqual(json.loads(api.project_path(directory, legacy["id"]).read_text(encoding="utf-8")), legacy)
        self.assertEqual(path.read_bytes(), b"original-video")

    async def test_rejects_unsafe_paths_network_and_cross_origin_writes(self):
        for url in ["http://modelscope.cn/models/leisongde/test", "https://127.0.0.1/file", "https://modelscope.cn@localhost/file", "https://modelscope.cn:8188/models/leisongde/file", "https://modelscope.cn/models/other/file"]:
            with self.subTest(url=url), self.assertRaises(ValueError):
                studio.allowed_download(url)
        response = await self.client.post("/capcut/studio/op/projects:save", headers={"Origin": "https://other.example"}, json={"project": self.doc})
        self.assertEqual(response.status, 403)
        response = await self.client.post("/capcut/studio/op/projects:load", json={"id": "../escape"})
        self.assertEqual(response.status, 400)
        response = await self.client.get("/capcut/editor/%2e%2e/studio.py")
        self.assertIn(response.status, (400, 404))

    async def test_caption_routes_return_status_and_clean_uploads(self):
        status = {"modelReady": False, "busy": False, "phase": "idle"}
        async def transcribe(path):
            self.assertEqual(path.read_bytes(), b"timeline-audio")
            return {"segments": [{"startTime": 0, "duration": 1, "text": "测试", "speaker": "S01"}], "elapsedSeconds": 1}
        with patch.object(studio.caption_service, "status", return_value=status), patch.object(studio.caption_service, "transcribe", side_effect=transcribe):
            self.assertEqual(await self.op("captions:status", {}), status)
            result = await self.op("captions:transcribe", {}, b"timeline-audio")
            self.assertEqual(result["segments"][0]["text"], "测试")
        with patch.object(studio.caption_service, "transcribe", new=AsyncMock(side_effect=RuntimeError("识别失败"))):
            response = await self.client.post("/capcut/studio/op/captions:transcribe", data=self.form({}, b"timeline-audio"))
            self.assertEqual(response.status, 400)
        self.assertFalse(list((self.directory / "user").rglob("*.tmp")))

    async def test_tracking_transports_seed_and_binary_result(self):
        async def start(owner, payload, path):
            self.assertEqual(owner, str(self.directory / "user/default/capcut"))
            self.assertEqual(payload["mask"], b"seed-mask")
            self.assertEqual(path.read_bytes(), b"rgba-frame")
            return {"sessionId": "test-session", "elapsedSeconds": 0.1}
        form = self.form({"width": 16, "height": 16}, b"rgba-frame")
        form.add_field("mask", b"seed-mask", filename="mask.bin")
        with patch.object(studio.tracking_service, "start", side_effect=start):
            response = await self.client.post("/capcut/studio/op/custom-cutout:track:start", data=form)
            self.assertEqual(response.status, 200, await response.text())
            self.assertEqual((await response.json())["sessionId"], "test-session")
        with patch.object(studio.tracking_service, "step", new=AsyncMock(return_value=(b"result-mask", 16, 16, 0.25))):
            response = await self.client.post("/capcut/studio/op/custom-cutout:track:step", data=self.form({"sessionId": "test-session", "width": 16, "height": 16}, b"rgba-frame"))
            self.assertEqual(await response.read(), b"result-mask")
            self.assertEqual(response.headers["X-CapCut-Width"], "16")
            self.assertEqual(response.headers["X-CapCut-Elapsed"], "0.25")
        self.assertFalse(list((self.directory / "user").rglob("*.tmp")))

    async def test_export_normalizes_geometry_and_missing_audio_and_keeps_file_order(self):
        import av
        import shutil
        ai_video = studio.ai_video

        if not shutil.which('ffmpeg'):
            self.skipTest('requires FFmpeg')
        output = self.directory / 'output'
        output.mkdir()
        first = output / 'first.mp4'
        second = output / 'second.mp4'
        await asyncio.to_thread(ai_video.run_ffmpeg, ['-f', 'lavfi', '-i', 'color=red:s=160x96:r=24:d=1',
            '-f', 'lavfi', '-i', 'sine=frequency=660:duration=1', '-c:v', 'libx264', '-c:a', 'aac', str(first)], 30)
        await asyncio.to_thread(ai_video.run_ffmpeg, ['-f', 'lavfi', '-i', 'color=blue:s=96x160:r=30:d=1',
            '-c:v', 'libx264', str(second)], 30)
        # Guide extraction uses the actual previous tail and can run on silent clips.
        pixels, samples = await asyncio.to_thread(ai_video.guide_tail, first, 64, 64)
        self.assertEqual(len(pixels), 22 * 64 * 64 * 3)
        self.assertGreater(pixels[0], 180)
        self.assertEqual(len(samples), 44_000 * 2 * 4)
        _, no_samples = await asyncio.to_thread(ai_video.guide_tail, second, 64, 64)
        self.assertIsNone(no_samples)
        for count in (5, 39, 56):
            with self.subTest(guide_frames=count):
                pixels, samples = await asyncio.to_thread(ai_video.guide_tail, first, 64, 64, count)
                self.assertEqual(len(pixels), count * 64 * 64 * 3)
                self.assertGreater(pixels[0], 180)
                self.assertEqual(len(samples), round(count / 24 * 48000) * 2 * 4)
        files = [{'filename': path.name, 'type': 'output'} for path in [first, second]]
        with patch.object(api.folder_paths, 'get_directory_by_type', return_value=str(output), create=True), \
             patch.object(api.folder_paths, 'get_output_directory', return_value=str(output), create=True):
            merged = await self.op('capcut:concat-ai-shots', {'files': files})
            response = await self.client.post('/capcut/studio/op/capcut:concat-ai-shots', json={'files': [files[0], {**files[1], 'filename': '../second.mp4'}]})
            self.assertEqual(response.status, 400)
        result = output / merged['subfolder'] / merged['filename']
        with av.open(str(result)) as media:
            frames = list(media.decode(video=0))
            self.assertEqual(len(frames), 48)
            self.assertEqual((frames[0].width, frames[0].height), (160, 96))
            self.assertGreater(frames[0].to_ndarray(format='rgb24')[48, 80, 0], 180)
            self.assertGreater(frames[-1].to_ndarray(format='rgb24')[48, 80, 2], 180)
            self.assertEqual(len(media.streams.audio), 1)
        with av.open(str(result)) as media:
            audio = list(media.decode(audio=0))
            self.assertAlmostEqual(sum(frame.samples for frame in audio) / 48000, 2, delta=0.03)
            self.assertLess(float(abs(audio[-2].to_ndarray()).max()), 0.005)


if __name__ == "__main__":
    unittest.main()
