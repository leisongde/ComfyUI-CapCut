import copy
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

import av
from aiohttp import FormData, web
from aiohttp.test_utils import TestClient, TestServer
from PIL import Image


spec = importlib.util.spec_from_file_location("capcut_api_test", Path(__file__).parents[1] / "api.py")
api = importlib.util.module_from_spec(spec)
with patch.dict(sys.modules, {"folder_paths": types.ModuleType("folder_paths"), "server": types.SimpleNamespace(PromptServer=None)}):
    spec.loader.exec_module(api)


def project():
    return {
        "version": 1, "id": "a" * 32, "name": "测试工程", "width": 320, "height": 180, "fps": 24,
        "assets": [{"id": "video", "file": "b" * 32 + ".mp4", "kind": "video", "name": "sample.mp4"}],
        "clips": [{"id": "clip", "assetId": "video", "track": "video1", "start": 0, "in": 0, "duration": 2, "speed": 1, "scale": 1, "opacity": 1, "volume": 1, "x": 0, "y": 0}],
        "tracks": {},
    }


class ProjectTests(unittest.TestCase):
    def test_rejects_paths_and_non_finite_filter_values(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for value in ["../escape.mp4", "C:\\outside.mp4", "x.mp4", "b" * 32 + ".exe"]:
                with self.subTest(value=value), self.assertRaises(ValueError):
                    api.media_path(root, value)
            for value in ["../project", "bad/id", "b" * 32 + ".json"]:
                with self.subTest(value=value), self.assertRaises(ValueError):
                    api.project_path(root, value)
        for value in [float("nan"), float("inf"), "1;movie=evil", True]:
            data = project()
            data["clips"][0]["x"] = value
            with self.subTest(value=value), self.assertRaises(ValueError):
                api.validate_project(data)

    def test_track_types_and_missing_asset_references(self):
        data = project()
        api.validate_project(data)
        data["clips"][0]["track"] = "audio1"
        api.validate_project(data)
        data["assets"][0]["kind"] = "image"
        with self.assertRaises(ValueError):
            api.validate_project(data)
        data = project()
        data["clips"][0]["assetId"] = "missing"
        with self.assertRaises(ValueError):
            api.validate_project(data)
        data = project()
        data["tracks"] = {"video1": {"hidden": "false"}}
        with self.assertRaises(ValueError):
            api.validate_project(data)

    def test_atomic_project_save_preserves_unicode_and_leaves_no_temporary_file(self):
        with tempfile.TemporaryDirectory() as directory:
            path = api.project_path(Path(directory), "a" * 32)
            api.save_json(path, project())
            self.assertEqual(json.loads(path.read_text(encoding="utf-8"))["name"], "测试工程")
            self.assertEqual(list(path.parent.iterdir()), [path])


class MediaStorageTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)
        self.input = self.directory / "input"
        self.user = self.directory / "user" / "default" / "capcut"
        self.input.mkdir()
        self.image = self.directory / "sample.png"
        Image.new("RGB", (32, 18), "red").save(self.image)
        manager = types.SimpleNamespace(get_request_user_filepath=lambda request, filename: str(self.directory / "user" / request.headers.get("Test-User", "default") / filename))
        routes = web.RouteTableDef()
        self.patches = [
            patch.object(api.folder_paths, "get_input_directory", return_value=str(self.input), create=True),
            patch.object(api.folder_paths, "get_directory_by_type", return_value=str(self.directory), create=True),
            patch.object(api, "PromptServer", types.SimpleNamespace(instance=types.SimpleNamespace(routes=routes, user_manager=manager))),
        ]
        for patcher in self.patches:
            patcher.start()
            self.addCleanup(patcher.stop)
        api.register_routes()
        app = web.Application()
        app.add_routes(routes)
        self.client = TestClient(TestServer(app))
        await self.client.start_server()
        self.addAsyncCleanup(self.client.close)

    async def test_upload_preview_and_generated_import_are_isolated_by_project_and_user(self):
        first, second = "a" * 32, "c" * 32
        form = FormData()
        form.add_field("file", self.image.read_bytes(), filename="测试图片.png", content_type="image/png")
        response = await self.client.post(f"/capcut/media?project_id={first}", data=form)
        self.assertEqual(response.status, 200, await response.text())
        asset = await response.json()
        path = self.input / "CapCut" / "default" / first / asset["file"]
        self.assertEqual(path.read_bytes(), self.image.read_bytes())
        self.assertFalse((self.user / "media").exists())
        url = f"/capcut/media/{asset['file']}"
        response = await self.client.get(f"{url}?project_id={first}", headers={"Range": "bytes=0-9"})
        self.assertEqual(response.status, 206)
        self.assertEqual(await response.read(), self.image.read_bytes()[:10])
        for request_url, headers, status in [
            (f"{url}?project_id={second}", {}, 404),
            (f"{url}?project_id={first}", {"Test-User": "another-user"}, 404),
            (url, {}, 400),
            (f"{url}?project_id=../escape", {}, 400),
        ]:
            response = await self.client.get(request_url, headers=headers)
            self.assertEqual(response.status, status, await response.text())
        response = await self.client.post(f"/capcut/media/from-comfy?project_id={second}", json={"filename": self.image.name, "type": "output"})
        self.assertEqual(response.status, 200, await response.text())
        generated = await response.json()
        self.assertEqual(generated["source"], "generated")
        self.assertTrue((self.input / "CapCut" / "default" / second / generated["file"]).is_file())

    async def test_old_project_migrates_and_json_import_copies_independent_media(self):
        data = project()
        data["assets"][0].update(kind="image", file="b" * 32 + ".png")
        legacy = self.user / "media" / data["assets"][0]["file"]
        legacy.parent.mkdir(parents=True)
        shutil.copyfile(self.image, legacy)
        api.save_json(api.project_path(self.user, data["id"]), data)
        response = await self.client.get(f"/capcut/projects/{data['id']}")
        self.assertEqual(response.status, 200, await response.text())
        migrated = await response.json()
        self.assertEqual(migrated["mediaStorage"], "input")
        original = api.media_path(api.media_directory(self.user, data["id"]), legacy.name)
        self.assertEqual(original.read_bytes(), legacy.read_bytes())
        self.assertTrue(legacy.is_file())
        self.assertEqual(json.loads(api.project_path(self.user, data["id"]).read_text(encoding="utf-8"))["mediaStorage"], "input")
        copied = copy.deepcopy(migrated)
        copied["id"] = "c" * 32
        response = await self.client.put(f"/capcut/projects/{copied['id']}?source_project={data['id']}", json=copied)
        self.assertEqual(response.status, 200, await response.text())
        target = api.media_path(api.media_directory(self.user, copied["id"]), legacy.name)
        self.assertEqual(target.read_bytes(), original.read_bytes())
        original.write_bytes(b"changed first project")
        self.assertEqual(target.read_bytes(), self.image.read_bytes())
        response = await self.client.get(f"/capcut/projects/{copied['id']}", headers={"Test-User": "another-user"})
        self.assertEqual(response.status, 404)

    @unittest.skipUnless(shutil.which("ffmpeg"), "FFmpeg is needed for media integration tests")
    async def test_export_reads_current_project_input_directory(self):
        data = project()
        data["mediaStorage"] = "input"
        response = await self.client.post(f"/capcut/media/from-comfy?project_id={data['id']}", json={"filename": self.image.name, "type": "output"})
        self.assertEqual(response.status, 200, await response.text())
        asset = await response.json()
        data["assets"] = [asset]
        data["clips"][0].update(assetId=asset["id"], duration=0.5)
        response = await self.client.post("/capcut/export", json=data)
        self.assertEqual(response.status, 200, await response.text())
        exported = await response.json()
        with av.open(str(self.user / "exports" / exported["file"])) as container:
            self.assertEqual((container.streams.video[0].width, container.streams.video[0].height), (320, 180))
            self.assertAlmostEqual(container.duration / av.time_base, 0.5, delta=0.1)
            frame = next(container.decode(video=0)).to_ndarray(format="rgb24")
            self.assertGreater(frame[90, 160, 0], 200)
        data["id"] = "c" * 32
        response = await self.client.post("/capcut/export", json=data)
        self.assertEqual(response.status, 400)


@unittest.skipUnless(shutil.which("ffmpeg"), "FFmpeg is needed for media integration tests")
class ExportTests(unittest.TestCase):
    def test_actual_export_with_gap_overlay_speed_and_audio(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "media").mkdir()
            source = root / "media" / ("b" * 32 + ".mp4")
            subprocess.run([
                shutil.which("ffmpeg"), "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=red:s=320x180:r=24:d=3",
                "-f", "lavfi", "-i", "sine=frequency=440:duration=3", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", str(source),
            ], check=True, capture_output=True)
            data = project()
            data["clips"][0].update(start=0.5, duration=1, speed=2, volume=0.4)
            overlay = copy.deepcopy(data["clips"][0])
            overlay.update(id="overlay", track="video2", start=0.75, duration=0.5, scale=0.5, opacity=0.5, x=20)
            data["clips"].append(overlay)
            destination = root / "result.mp4"
            result = subprocess.run(api.export_command(data, root / "media", destination, shutil.which("ffmpeg")), capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr.decode(errors="replace"))
            with av.open(str(destination)) as container:
                self.assertEqual((container.streams.video[0].width, container.streams.video[0].height), (320, 180))
                self.assertEqual(len(container.streams.audio), 1)
                self.assertAlmostEqual(container.duration / av.time_base, 1.5, delta=0.1)
                frames = list(container.decode(video=0))
                self.assertLess(frames[0].to_ndarray(format="rgb24").mean(), 3)
                self.assertGreater(frames[24].to_ndarray(format="rgb24")[90, 160, 0], 200)
            data["clips"][0]["in"] = 5
            with self.assertRaises(ValueError):
                api.export_command(data, root / "media", destination, shutil.which("ffmpeg"))


if __name__ == "__main__":
    unittest.main()
