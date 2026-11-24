import math
import re
import shutil
import subprocess
import uuid
from pathlib import Path

import av
import folder_paths


VIDEO_SUFFIXES = {'.mp4', '.mov', '.webm', '.mkv', '.avi', '.m4v'}
GUIDE_FRAMES = 22
GUIDE_FPS = 24


def video_path(file, allowed=('output', 'temp')):
    if not isinstance(file, dict) or file.get('type') not in allowed:
        raise ValueError('生成视频的目录类型无效')
    filename, subfolder = file.get('filename'), file.get('subfolder', '')
    if not isinstance(filename, str) or not isinstance(subfolder, str):
        raise ValueError('生成视频的文件名无效')
    if not filename or Path(filename).name != filename or ':' in filename or '/' in filename or '\\' in filename:
        raise ValueError('生成视频的文件名无效')
    relative = Path(subfolder)
    if relative.anchor or '..' in relative.parts or ':' in subfolder:
        raise ValueError('生成视频的子目录无效')
    if file['type'] == 'input' and (len(relative.parts) != 3 or relative.parts[0] != 'CapCut'
            or not re.fullmatch(r'[a-f0-9]{32}', relative.parts[2]) or not re.fullmatch(r'[a-f0-9]{32}\.[a-z0-9]+', filename)):
        raise ValueError('引导视频不在 CapCut 工程素材目录')
    root = Path(folder_paths.get_directory_by_type(file['type'])).resolve()
    path = (root / relative / filename).resolve()
    if not path.is_relative_to(root) or path.suffix.lower() not in VIDEO_SUFFIXES or not path.is_file():
        raise ValueError('生成视频不存在或路径无效')
    return path


def ffmpeg_binary():
    executable = shutil.which('ffmpeg')
    if executable:
        return executable
    try:
        from imageio_ffmpeg import get_ffmpeg_exe
        return get_ffmpeg_exe()
    except (ImportError, RuntimeError) as error:
        raise ValueError('未找到 FFmpeg，请将其添加到 PATH 后重启 ComfyUI') from error


def run_ffmpeg(args, timeout):
    try:
        process = subprocess.run([ffmpeg_binary(), '-nostdin', '-hide_banner', '-loglevel', 'error', *args],
                                 capture_output=True, timeout=timeout)
    except subprocess.TimeoutExpired as error:
        raise ValueError('FFmpeg 视频处理超时') from error
    if process.returncode:
        raise ValueError(f"FFmpeg 无法处理视频：{process.stderr.decode('utf-8', errors='replace')[-1200:]}")
    return process.stdout


def video_info(path):
    try:
        with av.open(str(path)) as container:
            if not container.streams.video:
                raise ValueError('素材没有视频轨道')
            stream = container.streams.video[0]
            duration = float(stream.duration * stream.time_base) if stream.duration is not None else (container.duration or 0) / av.time_base
            if not math.isfinite(duration) or duration <= 0:
                raise ValueError('无法确定视频时长')
            # Use the video's start relative to FFmpeg's default input seek origin.
            offset = float((stream.start_time or 0) * stream.time_base) - (container.start_time or 0) / av.time_base
            return duration, stream.width, stream.height, float(stream.average_rate or GUIDE_FPS), bool(container.streams.audio), max(0, offset)
    except av.error.FFmpegError as error:
        raise ValueError('无法读取生成视频') from error


def guide_tail(path, width, height, guide_frames=GUIDE_FRAMES):
    duration, _, _, _, has_audio, offset = video_info(path)
    length = guide_frames / GUIDE_FPS
    start = offset + max(0, duration - length)
    inputs = ['-ss', f'{start:.9f}', '-i', str(path)]
    video = run_ffmpeg([*inputs, '-map', '0:v:0', '-an', '-filter_threads', '1', '-vf',
                       f'fps={GUIDE_FPS}:round=up,scale={width}:{height}:force_original_aspect_ratio=increase,'
                       f'crop={width}:{height},tpad=stop_mode=clone:stop={guide_frames}',
                       '-frames:v', str(guide_frames), '-threads', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], 90)
    if len(video) != guide_frames * width * height * 3:
        raise ValueError('无法提取前段末尾画面')
    audio = None
    if has_audio:
        audio = run_ffmpeg([*inputs, '-map', '0:a:0', '-vn', '-af', 'aresample=48000:async=1:first_pts=0,apad',
                           '-t', f'{length:.9f}', '-ac', '2', '-ar', '48000', '-f', 'f32le', 'pipe:1'], 90)
    return video, audio


def concatenate_shots(files):
    if not isinstance(files, list) or not 2 <= len(files) <= 128:
        raise ValueError('全部导出一次可合并 2 到 128 个镜头')
    paths = [video_path(file) for file in files]
    stats = [video_info(path) for path in paths]
    _, width, height, fps, _, _ = stats[0]
    width, height = max(2, width // 2 * 2), max(2, height // 2 * 2)
    fps = min(120, max(1, fps))
    args = ['-filter_complex_threads', '1']
    for path in paths:
        args.extend(['-threads', '1', '-i', str(path)])
    filters = []
    for i, (duration, _, _, _, has_audio, offset) in enumerate(stats):
        frames = max(1, round(duration * fps))
        seconds = frames / fps
        filters.append(f'[{i}:v:0]setpts=PTS-STARTPTS,fps={fps:.8f},'
                       f'scale={width}:{height}:force_original_aspect_ratio=decrease:force_divisible_by=2,'
                       f'pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p,'
                       f'tpad=stop_mode=clone:stop=1,trim=end_frame={frames}[v{i}]')
        audio = (f'[{i}:a:0]asetpts=PTS-{offset:.9f}/TB,aresample=48000:async=1:first_pts=0,'
                 'aformat=sample_rates=48000:channel_layouts=stereo,apad'
                 if has_audio else 'anullsrc=r=48000:cl=stereo')
        filters.append(f'{audio},atrim=end_sample={round(seconds * 48000)},asetpts=PTS-STARTPTS[a{i}]')
    filters.append(''.join(f'[v{i}][a{i}]' for i in range(len(paths))) + f'concat=n={len(paths)}:v=1:a=1[v][a]')
    # Use a temp result until the encoder has closed it, so import only sees complete exports.
    subfolder = 'CapCut/AI'
    output_dir = Path(folder_paths.get_output_directory()) / subfolder
    if not output_dir.resolve().is_relative_to(Path(folder_paths.get_output_directory()).resolve()):
        raise ValueError('全部导出的输出目录无效')
    output_dir.mkdir(parents=True, exist_ok=True)
    filename = f'CapCut_AI_{uuid.uuid4().hex}.mp4'
    destination = output_dir / filename
    temporary = destination.with_suffix('.partial.mp4')
    filter_script = destination.with_suffix('.ffmpeg-filters')
    try:
        filter_script.write_text(';'.join(filters), encoding='ascii')
        run_ffmpeg([*args, '-filter_complex_script', str(filter_script), '-map', '[v]', '-map', '[a]',
                    '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-threads', '4',
                    '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', str(temporary)], 1800)
        temporary.rename(destination)
    finally:
        temporary.unlink(missing_ok=True)
        filter_script.unlink(missing_ok=True)
    return {'filename': filename, 'subfolder': subfolder, 'type': 'output'}
