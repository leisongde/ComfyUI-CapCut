"""JSON-lines Cutie video-object-segmentation worker for custom cutout."""

from __future__ import annotations

import argparse
import base64
import json
import os
import sys
import time
from pathlib import Path
from typing import Any

import numpy as np
import torch

sys.path.insert(0, str(Path(__file__).parent))

from cutie.inference.inference_core import InferenceCore
from cutie.model.cutie import CUTIE


class AttrDict(dict):
    def __getattr__(self, key: str) -> Any:
        try:
            return self[key]
        except KeyError as error:
            raise AttributeError(key) from error


def attrs(value: Any) -> Any:
    if isinstance(value, dict):
        return AttrDict({key: attrs(item) for key, item in value.items()})
    if isinstance(value, list):
        return [attrs(item) for item in value]
    return value


def build_config() -> AttrDict:
    return attrs(
        {
            "model": {
                "pixel_mean": [0.485, 0.456, 0.406],
                "pixel_std": [0.229, 0.224, 0.225],
                "pixel_dim": 256,
                "key_dim": 64,
                "value_dim": 256,
                "sensory_dim": 256,
                "embed_dim": 256,
                "pixel_encoder": {"type": "resnet50", "ms_dims": [1024, 512, 256]},
                "mask_encoder": {"type": "resnet18", "final_dim": 256},
                "pixel_pe_scale": 32,
                "pixel_pe_temperature": 128,
                "object_transformer": {
                    "embed_dim": 256,
                    "ff_dim": 2048,
                    "num_heads": 8,
                    "num_blocks": 3,
                    "num_queries": 16,
                    "read_from_pixel": {
                        "input_norm": False,
                        "input_add_pe": False,
                        "add_pe_to_qkv": [True, True, False],
                    },
                    "read_from_past": {"add_pe_to_qkv": [True, True, False]},
                    "read_from_memory": {"add_pe_to_qkv": [True, True, False]},
                    "read_from_query": {
                        "add_pe_to_qkv": [True, True, False],
                        "output_norm": False,
                    },
                    "query_self_attention": {"add_pe_to_qkv": [True, True, False]},
                    "pixel_self_attention": {"add_pe_to_qkv": [True, True, False]},
                },
                "object_summarizer": {
                    "embed_dim": 256,
                    "num_summaries": 16,
                    "add_pe": True,
                },
                "aux_loss": {
                    "sensory": {"enabled": True, "weight": 0.01},
                    "query": {"enabled": True, "weight": 0.01},
                },
                "mask_decoder": {"up_dims": [256, 128, 128]},
            },
            "flip_aug": False,
            "max_internal_size": 480,
            "max_mem_frames": 5,
            "use_long_term": False,
            "mem_every": 5,
            "long_term": {
                "count_usage": True,
                "max_mem_frames": 10,
                "min_mem_frames": 5,
                "num_prototypes": 128,
                "max_num_tokens": 10000,
                "buffer_tokens": 2000,
            },
            "top_k": 30,
            "stagger_updates": 5,
            "chunk_size": -1,
            "save_aux": False,
        }
    )


def emit(value: dict) -> None:
    print(json.dumps(value, ensure_ascii=False), flush=True)


def read_frame(encoded: str, width: int, height: int) -> torch.Tensor:
    raw = np.frombuffer(base64.b64decode(encoded, validate=True), dtype=np.uint8)
    if raw.size != width * height * 4:
        raise ValueError("RGBA frame size does not match width and height")
    rgb = raw.reshape((height, width, 4))[:, :, :3].copy()
    return torch.from_numpy(rgb).permute(2, 0, 1).float().div_(255.0)


def read_seed_mask(encoded: str, width: int, height: int) -> torch.Tensor:
    raw = np.frombuffer(base64.b64decode(encoded, validate=True), dtype=np.uint8)
    if raw.size != width * height:
        raise ValueError("Seed mask size does not match width and height")
    indexed = (raw.reshape((height, width)) >= 128).astype(np.int64)
    return torch.from_numpy(indexed)


class Tracker:
    def __init__(self, model_path: Path, device: str):
        torch.set_grad_enabled(False)
        if device == "auto" and torch.cuda.is_available() and torch.cuda.mem_get_info()[0] >= 2 * 1024**3:
            self.device = torch.device("cuda")
        else:
            torch.set_num_threads(max(1, min(12, os.cpu_count() or 8)))
            torch.set_num_interop_threads(1)
            self.device = torch.device("cpu")
        self.cfg = build_config()
        self.model = CUTIE(self.cfg).to(self.device).eval()
        weights = torch.load(model_path, map_location=self.device, weights_only=True)
        self.model.load_weights(weights)
        self.processor: InferenceCore | None = None
        self.width = 0
        self.height = 0

    def begin(self, request: dict) -> dict:
        self.width = int(request["width"])
        self.height = int(request["height"])
        image = read_frame(request["rgbaBase64"], self.width, self.height).to(self.device)
        mask = read_seed_mask(request["maskBase64"], self.width, self.height).to(self.device)
        self.processor = InferenceCore(self.model, cfg=self.cfg)
        started = time.perf_counter()
        self.processor.step(image, mask, objects=[1], force_permanent=True)
        return {"elapsedSeconds": time.perf_counter() - started}

    def step(self, request: dict) -> dict:
        if self.processor is None:
            raise RuntimeError("Tracking session has not been initialized")
        width = int(request["width"])
        height = int(request["height"])
        if width != self.width or height != self.height:
            raise ValueError("Tracking frame dimensions changed")
        image = read_frame(request["rgbaBase64"], width, height).to(self.device)
        started = time.perf_counter()
        probabilities = self.processor.step(image)
        if probabilities.shape[0] < 2:
            raise RuntimeError("Cutie did not return an object probability")
        mask = (
            probabilities[1]
            .detach()
            .clamp(0.0, 1.0)
            .mul_(255.0)
            .round_()
            .to(torch.uint8)
            .cpu()
            .numpy()
        )
        return {
            "maskBase64": base64.b64encode(mask.tobytes()).decode("ascii"),
            "elapsedSeconds": time.perf_counter() - started,
        }

    def end(self) -> dict:
        self.processor = None
        return {}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--device", choices=("auto", "cpu"), default="auto")
    args = parser.parse_args()
    tracker = Tracker(args.model, args.device)
    emit({"type": "ready", "device": str(tracker.device)})

    for line in sys.stdin:
        if not line.strip():
            continue
        request = json.loads(line)
        request_id = str(request.get("id", ""))
        try:
            action = request.get("action")
            if action == "start":
                result = tracker.begin(request)
            elif action == "step":
                result = tracker.step(request)
            elif action == "end":
                result = tracker.end()
            else:
                raise ValueError("Unsupported tracking action")
            emit({"id": request_id, **result})
        except Exception as error:
            emit({"id": request_id, "error": str(error)})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
