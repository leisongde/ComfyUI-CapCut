from importlib import import_module
from types import SimpleNamespace
from sys import modules

from comfy_api.latest import io
from nodes import NODE_CLASS_MAPPINGS


def director_module(name):
    node = NODE_CLASS_MAPPINGS.get("MiniMaxH3DirectorSelfLift")
    if node is None:
        raise RuntimeError("请安装 MiniMax H3 Director 并重启 ComfyUI")
    return import_module(f"..director.{name}", modules[node.__module__].__package__)


class CapCutSelfLiftSampler(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="CapCutSelfLiftSampler",
            display_name="CapCut SelfLift 渐进采样",
            category="CapCut",
            inputs=[
                io.Latent.Input("latent"), io.Conditioning.Input("positive"), io.Model.Input("model"),
                io.Vae.Input("video_vae"), io.Sigmas.Input("sigmas"),
                io.Int.Input("seed", min=0, max=0xffffffffffffffff),
                io.Float.Input("shift_video", default=12.0), io.Float.Input("shift_audio", default=3.0),
                io.Custom("MMX_DIR_SELFLIFT").Input("selflift"),
            ],
            outputs=[io.Latent.Output()],
        )

    @classmethod
    def execute(cls, latent, positive, model, video_vae, sigmas, seed, shift_video, shift_audio, selflift):
        cache = director_module("core_sampling").ShiftedModelCache()
        samples, _ = director_module("selflift.sample").sample_selflift_stage(
            model=model, positive=positive, negative=None, latent=latent, seed=seed,
            cfg=1.0, steps=len(sigmas) - 1, sampler_name="euler", scheduler="simple",
            pack=selflift, shift_video=shift_video, shift_audio=shift_audio,
            sigmas=sigmas, shift_cache=cache, vae=video_vae,
        )
        return io.NodeOutput(samples)


class CapCutRefineSampler(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="CapCutRefineSampler",
            display_name="CapCut 放大与二采",
            category="CapCut",
            inputs=[
                io.Latent.Input("latent"), io.Conditioning.Input("positive"), io.Model.Input("model"),
                io.Vae.Input("video_vae"),
                io.Int.Input("seed", min=0, max=0xffffffffffffffff),
                io.Float.Input("shift_video", default=12.0), io.Float.Input("shift_audio", default=3.0),
                io.Custom("MMX_DIR_REFINE").Input("refine"),
                io.Image.Input("first_frame", optional=True), io.Image.Input("last_frame", optional=True),
                io.Int.Input("uncrop_width", optional=True, min=32, force_input=True),
                io.Int.Input("uncrop_height", optional=True, min=32, force_input=True),
            ],
            outputs=[io.Latent.Output(), io.Int.Output("width"), io.Int.Output("height")],
        )

    @classmethod
    def execute(cls, latent, positive, model, video_vae, seed, shift_video, shift_audio, refine,
                first_frame=None, last_frame=None, uncrop_width=None, uncrop_height=None):
        size = director_module("h3_motion_context").av_pixel_size(latent)
        if size is None:
            raise ValueError("放大与二采需要 MiniMax H3 音视频潜空间")
        width, height = size
        target_width, target_height = director_module("refine_pack").canvas_from_source_megapixels(
            uncrop_width or width, uncrop_height or height, refine["megapixels"],
        )
        if uncrop_width and uncrop_height:
            # Scale the masked crop by the full canvas scale before compositing it back.
            area = target_width * target_height * width * height / (uncrop_width * uncrop_height)
            refine = {**refine, "megapixels": area / (1024 * 1024)}
        refs = [SimpleNamespace(index=index, tensor=image) for index, image in enumerate((first_frame, last_frame)) if image is not None]
        task_key = "fl2v" if last_frame is not None else "i2v" if first_frame is not None else ""
        samples, status = director_module("refine_sampling").apply_segment_refine(
            SimpleNamespace(width=width, height=height, refine=refine), SimpleNamespace(task_key=task_key, refs=refs),
            samples=latent, model=model, vae=video_vae, positive=positive, negative=None, seed=seed,
            cfg=1.0, first_steps=0, sampler_name="euler", scheduler="simple",
            shift_video=shift_video, shift_audio=shift_audio,
            shift_cache=director_module("core_sampling").ShiftedModelCache(),
        )
        if status.startswith("refine FAILED"):
            raise RuntimeError(f"放大与二采失败：{status}")
        return io.NodeOutput(samples, target_width, target_height)
