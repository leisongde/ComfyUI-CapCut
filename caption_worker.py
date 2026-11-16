import json
from pathlib import Path
import sys

import av
import numpy as np
import torch
from transformers import AutoModelForCausalLM, AutoProcessor

sys.path.insert(0, str(Path(__file__).parent / "vendor" / "moss"))
from transcript_parser import parse_transcript


PROMPT = "请将音频转写为文本，每一段需以起始时间戳和说话人编号（[S01]、[S02]、[S03]…）开头，正文为对应的语音内容，并在段末标注结束时间戳，以清晰标明该段语音范围。"


def read_audio(path):
    chunks = []
    resampler = av.AudioResampler(format="fltp", layout="mono", rate=16000)
    with av.open(str(path)) as container:
        for frame in container.decode(audio=0):
            chunks.extend(frame.to_ndarray().reshape(-1) for frame in resampler.resample(frame))
        chunks.extend(frame.to_ndarray().reshape(-1) for frame in resampler.resample(None))
    if not chunks:
        raise ValueError("轨道音频为空")
    return np.concatenate(chunks)


def main():
    model_path, audio_path, result_path = sys.argv[1:]
    torch.set_num_threads(min(torch.get_num_threads(), 8))
    model = AutoModelForCausalLM.from_pretrained(model_path, trust_remote_code=True, local_files_only=True, dtype=torch.float32, attn_implementation="sdpa").eval()
    processor = AutoProcessor.from_pretrained(model_path, trust_remote_code=True, local_files_only=True)
    print(json.dumps({"phase": "transcribing", "detail": "正在识别轨道字幕（CPU）"}, ensure_ascii=False), flush=True)
    audio = read_audio(audio_path)
    messages = [{"role": "user", "content": [{"type": "audio", "audio": audio_path}, {"type": "text", "text": PROMPT}]}]
    text = processor.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
    inputs = processor(text=text, audio=[audio], max_length=131072, return_tensors="pt")
    prompt_length = inputs["input_ids"].shape[-1]
    output = model.generate(**inputs, max_new_tokens=4096, do_sample=False)
    generated = output[0][prompt_length:]
    if len(generated) >= 4096 and int(generated[-1]) != processor.tokenizer.eos_token_id:
        raise ValueError("字幕输出超过单次识别长度，请将长视频分段识别")
    transcript = processor.tokenizer.decode(generated, skip_special_tokens=True).strip()
    segments = [{"startTime": segment.start, "duration": segment.end - segment.start, "text": segment.text, "speaker": segment.speaker} for segment in parse_transcript(transcript) if segment.end > segment.start]
    segments.sort(key=lambda segment: segment["startTime"])
    Path(result_path).write_text(json.dumps({"segments": segments}, ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
    main()
