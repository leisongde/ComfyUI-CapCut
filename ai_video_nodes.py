import numpy as np
import torch
import torch.nn.functional as F
from comfy_api.latest import io

from .ai_video import GUIDE_FPS, GUIDE_FRAMES, guide_tail, video_path


class CapCutShotGuideTail(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id='CapCutShotGuideTail', display_name='CapCut · 读取前段引导', category='CapCut',
            inputs=[io.String.Input('filename'), io.String.Input('subfolder'), io.String.Input('file_type'),
                    io.Int.Input('width', min=16, max=4096), io.Int.Input('height', min=16, max=4096),
                    io.Int.Input('guide_frames', default=GUIDE_FRAMES, min=5, max=56, optional=True)],
            outputs=[io.Image.Output(), io.Audio.Output()],
        )

    @classmethod
    def execute(cls, filename, subfolder, file_type, width, height, guide_frames=GUIDE_FRAMES):
        path = video_path({'filename': filename, 'subfolder': subfolder, 'type': file_type}, ('input', 'output', 'temp'))
        video, audio = guide_tail(path, width, height, guide_frames)
        image = torch.from_numpy(np.frombuffer(video, dtype=np.uint8).copy()).float().reshape(guide_frames, height, width, 3) / 255
        sound = None
        if audio:
            samples = torch.from_numpy(np.frombuffer(audio, dtype='<f4').copy()).reshape(-1, 2).T.contiguous()
            sound = {'waveform': samples.unsqueeze(0), 'sample_rate': 48000}
        return io.NodeOutput(image, sound)


class CapCutTrimShotGuide(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id='CapCutTrimShotGuide', display_name='CapCut · 裁除引导画面和声音', category='CapCut',
            inputs=[io.Image.Input('images'), io.Audio.Input('audio'), io.Int.Input('output_frames', min=1, max=720),
                    io.Int.Input('guide_frames', default=GUIDE_FRAMES, min=5, max=56, optional=True)],
            outputs=[io.Image.Output(), io.Audio.Output()],
        )

    @classmethod
    def execute(cls, images, audio, output_frames, guide_frames=GUIDE_FRAMES):
        end = guide_frames + output_frames
        if images.shape[0] < end:
            raise ValueError('解码帧数不足，无法裁除前段引导')
        rate = audio['sample_rate']
        start_sample = round(guide_frames * rate / GUIDE_FPS)
        sample_count = round(output_frames * rate / GUIDE_FPS)
        wave = audio['waveform'][..., start_sample:start_sample + sample_count]
        if wave.shape[-1] < sample_count:
            wave = F.pad(wave, (0, sample_count - wave.shape[-1]))
        return io.NodeOutput(images[guide_frames:end], {**audio, 'waveform': wave})
