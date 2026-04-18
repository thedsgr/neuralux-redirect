"""Lightweight, deterministic NeuroScore v2 pipeline.

The implementation prefers stdlib and optional fallbacks:
- Pillow for image statistics
- ffprobe/ffmpeg for video and audio sampling
- cv2 for face detection when available

All optional integrations degrade gracefully to metadata-driven heuristics.
"""

from __future__ import annotations

import audioop
import hashlib
import json
import math
import mimetypes
import os
import re
import shlex
import shutil
import statistics
import struct
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

try:
    from .contracts import (
        API_VERSION,
        DEFAULT_CONTEXT,
        REGIONS,
        REGION_DESCRIPTIONS,
        REGION_LABELS,
        REGION_TAGS,
        blank_confidence_map,
        blank_evidence_map,
        blank_region_scores,
        context_block,
        context_label,
        feature_template,
        get_context_weights,
        normalize_context_key,
        output_template,
    )
except ImportError:  # pragma: no cover - direct script execution fallback
    from contracts import (  # type: ignore
        API_VERSION,
        DEFAULT_CONTEXT,
        REGIONS,
        REGION_DESCRIPTIONS,
        REGION_LABELS,
        REGION_TAGS,
        blank_confidence_map,
        blank_evidence_map,
        blank_region_scores,
        context_block,
        context_label,
        feature_template,
        get_context_weights,
        normalize_context_key,
        output_template,
    )

try:  # optional dependency
    from PIL import Image, ImageFilter, ImageStat  # type: ignore
except Exception:  # pragma: no cover - optional dependency
    Image = None  # type: ignore
    ImageFilter = None  # type: ignore
    ImageStat = None  # type: ignore

try:  # optional dependency
    import cv2  # type: ignore
except Exception:  # pragma: no cover - optional dependency
    cv2 = None  # type: ignore


CTA_KEYWORDS = {
    "buy",
    "book",
    "contact",
    "discover",
    "download",
    "explore",
    "get",
    "join",
    "learn",
    "order",
    "request",
    "shop",
    "sign",
    "start",
    "try",
    "watch",
}

SEMANTIC_KEYWORDS = {
    "about",
    "benefit",
    "brand",
    "context",
    "customer",
    "feature",
    "focus",
    "growth",
    "learn",
    "offer",
    "result",
    "solution",
    "value",
}

IMPERATIVE_HINTS = {
    "act",
    "build",
    "choose",
    "create",
    "discover",
    "improve",
    "join",
    "learn",
    "move",
    "start",
    "unlock",
    "win",
}


@dataclass(frozen=True)
class MediaProbe:
    media_path: str
    media_type: str
    mime_type: str
    extension: str
    file_size_bytes: int
    file_size_mb: float
    sha256_prefix: str
    exists: bool


def _clamp(value: float, low: float = 0.0, high: float = 100.0) -> float:
    return max(low, min(high, value))


def _round_score(value: float) -> int:
    return int(round(_clamp(value)))


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        if value is None:
            return default
        parsed = float(value)
        if math.isnan(parsed) or math.isinf(parsed):
            return default
        return parsed
    except Exception:
        return default


def _safe_int(value: Any, default: int = 0) -> int:
    try:
        if value is None:
            return default
        return int(float(value))
    except Exception:
        return default


def _stable_entropy(data: bytes) -> float:
    if not data:
        return 0.0
    freq = [0] * 256
    for byte in data:
        freq[byte] += 1
    total = len(data)
    entropy = 0.0
    for count in freq:
        if count:
            p = count / total
            entropy -= p * math.log2(p)
    return entropy


def _normalize_entropy(entropy: float) -> float:
    return _clamp(entropy / 8.0, 0.0, 1.0)


def _guess_media_type(path: str, mime_type: str) -> str:
    ext = Path(path).suffix.lower()
    if mime_type.startswith("image/") or ext in {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tif", ".tiff"}:
        return "image"
    if mime_type.startswith("video/") or ext in {".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v"}:
        return "video"
    if mime_type.startswith("audio/") or ext in {".wav", ".mp3", ".m4a", ".aac", ".flac", ".ogg", ".opus"}:
        return "audio"
    return "unknown"


def _probe_media(path: str) -> MediaProbe:
    resolved = Path(path)
    exists = resolved.exists()
    file_size_bytes = resolved.stat().st_size if exists and resolved.is_file() else 0
    file_size_mb = file_size_bytes / (1024 * 1024) if file_size_bytes else 0.0
    mime_type, _ = mimetypes.guess_type(str(resolved))
    mime_type = mime_type or ""
    extension = resolved.suffix.lower()
    media_type = _guess_media_type(str(resolved), mime_type)
    sha256_prefix = ""
    if exists and resolved.is_file():
        hasher = hashlib.sha256()
        with resolved.open("rb") as fh:
            for chunk in iter(lambda: fh.read(1024 * 1024), b""):
                hasher.update(chunk)
        sha256_prefix = hasher.hexdigest()[:16]
    return MediaProbe(
        media_path=str(resolved),
        media_type=media_type,
        mime_type=mime_type,
        extension=extension,
        file_size_bytes=file_size_bytes,
        file_size_mb=file_size_mb,
        sha256_prefix=sha256_prefix,
        exists=exists,
    )


def _run_command(command: list[str], timeout: float = 10.0) -> subprocess.CompletedProcess[str] | None:
    try:
        return subprocess.run(
            command,
            check=False,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    except (FileNotFoundError, subprocess.SubprocessError, OSError):
        return None


def _run_ffprobe(path: str, select_streams: str | None = None) -> dict:
    ffprobe = shutil.which("ffprobe")
    if not ffprobe:
        return {}
    command = [ffprobe, "-v", "error", "-print_format", "json", "-show_format", "-show_streams"]
    if select_streams:
        command.extend(["-select_streams", select_streams])
    command.append(path)
    result = _run_command(command, timeout=12.0)
    if not result or result.returncode != 0:
        return {}
    try:
        return json.loads(result.stdout or "{}")
    except json.JSONDecodeError:
        return {}


def _image_size_from_header(path: str) -> tuple[int, int]:
    ext = Path(path).suffix.lower()
    try:
        with open(path, "rb") as fh:
            if ext == ".png":
                header = fh.read(24)
                if len(header) >= 24 and header[:8] == b"\x89PNG\r\n\x1a\n":
                    return struct.unpack(">II", header[16:24])
            elif ext in {".jpg", ".jpeg"}:
                fh.read(2)
                while True:
                    marker, code = fh.read(1), fh.read(1)
                    if not marker or not code:
                        break
                    while marker != b"\xff":
                        marker = code
                        code = fh.read(1)
                    while code == b"\xff":
                        code = fh.read(1)
                    if code in {b"\xc0", b"\xc1", b"\xc2", b"\xc3"}:
                        fh.read(3)
                        h, w = struct.unpack(">HH", fh.read(4))
                        return w, h
                    length = struct.unpack(">H", fh.read(2))[0]
                    fh.seek(length - 2, os.SEEK_CUR)
            elif ext == ".gif":
                header = fh.read(10)
                if len(header) >= 10 and header[:6] in {b"GIF87a", b"GIF89a"}:
                    return struct.unpack("<HH", header[6:10])
            elif ext == ".bmp":
                fh.read(18)
                w, h = struct.unpack("<ii", fh.read(8))
                return abs(w), abs(h)
            elif ext == ".webp":
                header = fh.read(30)
                if len(header) >= 30 and header[:4] == b"RIFF" and header[8:12] == b"WEBP":
                    if header[12:16] == b"VP8X":
                        w = 1 + int.from_bytes(header[24:27], "little")
                        h = 1 + int.from_bytes(header[27:30], "little")
                        return w, h
    except Exception:
        return 0, 0
    return 0, 0


def _image_to_rgb_stats(path: str) -> dict:
    if Image is None:
        width, height = _image_size_from_header(path)
        return {
            "width": width,
            "height": height,
            "brightness_mean": 0.0,
            "brightness_std": 0.0,
            "contrast": 0.0,
            "colorfulness": 0.0,
            "edge_density": 0.0,
            "skin_tone_ratio": 0.0,
            "central_mass": 0.0,
            "texture_score": 0.0,
        }

    with Image.open(path) as img:
        img = img.convert("RGB")
        width, height = img.size
        stat = ImageStat.Stat(img)
        r_mean, g_mean, b_mean = stat.mean
        brightness = (r_mean + g_mean + b_mean) / 3.0
        brightness_std = statistics.pstdev([r_mean, g_mean, b_mean]) if len(stat.mean) == 3 else 0.0
        contrast = statistics.pstdev(stat.mean) if stat.mean else 0.0
        pixels = list(img.getdata())
        if pixels:
            rg = [abs(r - g) for r, g, _ in pixels]
            yb = [abs((r + g) / 2 - b) for r, g, b in pixels]
            rg_var = statistics.pvariance(rg) if len(rg) > 1 else 0.0
            yb_var = statistics.pvariance(yb) if len(yb) > 1 else 0.0
            colorfulness = (math.sqrt(rg_var + yb_var) + (statistics.mean(rg) if rg else 0.0) + (statistics.mean(yb) if yb else 0.0)) / 255.0
        else:
            colorfulness = 0.0

        gray = img.convert("L")
        gray_stat = ImageStat.Stat(gray)
        gray_mean = gray_stat.mean[0] if gray_stat.mean else 0.0
        gray_std = gray_stat.stddev[0] if gray_stat.stddev else 0.0
        if ImageFilter is not None:
            edge_map = gray.filter(ImageFilter.FIND_EDGES)
            edge_stat = ImageStat.Stat(edge_map)
            edge_density = (edge_stat.mean[0] / 255.0) if edge_stat.mean else 0.0
        else:
            edge_density = 0.0

        crop_w = max(1, width // 2)
        crop_h = max(1, height // 2)
        left = max(0, (width - crop_w) // 2)
        top = max(0, (height - crop_h) // 2)
        center = img.crop((left, top, left + crop_w, top + crop_h))
        center_pixels = list(center.getdata())
        skin_count = 0
        for r, g, b in center_pixels:
            if r > 95 and g > 40 and b > 20 and max(r, g, b) - min(r, g, b) > 15 and abs(r - g) > 15 and r > g and r > b:
                skin_count += 1
        skin_tone_ratio = skin_count / max(1, len(center_pixels))
        central_mass = gray_std / 128.0
        texture_score = _clamp((edge_density * 0.7) + (gray_std / 255.0) * 0.3, 0.0, 1.0)

        return {
            "width": width,
            "height": height,
            "brightness_mean": brightness / 255.0,
            "brightness_std": brightness_std / 255.0,
            "contrast": gray_std / 128.0,
            "colorfulness": _clamp(colorfulness, 0.0, 1.0),
            "edge_density": _clamp(edge_density, 0.0, 1.0),
            "skin_tone_ratio": _clamp(skin_tone_ratio, 0.0, 1.0),
            "central_mass": _clamp(central_mass, 0.0, 1.0),
            "texture_score": texture_score,
            "gray_mean": gray_mean / 255.0,
        }


def _video_probe_features(path: str) -> dict:
    ffprobe = _run_ffprobe(path)
    fmt = ffprobe.get("format", {}) if isinstance(ffprobe, dict) else {}
    streams = ffprobe.get("streams", []) if isinstance(ffprobe, dict) else []
    video_stream = next((stream for stream in streams if stream.get("codec_type") == "video"), {})
    audio_stream = next((stream for stream in streams if stream.get("codec_type") == "audio"), {})

    def _parse_rate(raw: str | None) -> float:
        if not raw or raw == "0/0":
            return 0.0
        if "/" in raw:
            num, den = raw.split("/", 1)
            den_val = _safe_float(den, 1.0)
            return _safe_float(num, 0.0) / den_val if den_val else 0.0
        return _safe_float(raw, 0.0)

    duration = _safe_float(fmt.get("duration"), 0.0)
    fps = _parse_rate(video_stream.get("avg_frame_rate") or video_stream.get("r_frame_rate"))
    if not fps:
        fps = _safe_float(video_stream.get("nb_frames"), 0.0) / duration if duration else 0.0
    frame_count = _safe_int(video_stream.get("nb_frames"), 0)
    if not frame_count and duration and fps:
        frame_count = int(round(duration * fps))

    return {
        "width": _safe_int(video_stream.get("width"), 0),
        "height": _safe_int(video_stream.get("height"), 0),
        "duration_s": duration,
        "fps": fps,
        "frame_count_estimate": frame_count,
        "has_audio_stream": bool(audio_stream),
        "has_video_stream": bool(video_stream),
        "video_bitrate": _safe_float(video_stream.get("bit_rate") or fmt.get("bit_rate"), 0.0),
        "audio_bitrate": _safe_float(audio_stream.get("bit_rate"), 0.0),
        "channels": _safe_int(audio_stream.get("channels"), 0),
        "sample_rate": _safe_int(audio_stream.get("sample_rate"), 0),
    }


def _extract_video_frames(path: str, count: int = 3) -> list[str]:
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        return []
    with tempfile.TemporaryDirectory(prefix="neuroscore_frames_") as tmpdir:
        out_paths: list[str] = []
        # Sample a few frames from the start, middle and end using time offsets.
        probe = _video_probe_features(path)
        duration = probe.get("duration_s", 0.0) or 0.0
        offsets = [0.0]
        if duration > 0.0:
            offsets.append(duration / 2.0)
            offsets.append(max(0.0, duration - 0.25))
        while len(offsets) < count:
            offsets.append(offsets[-1] + 0.25 if offsets else 0.0)
        for index, ts in enumerate(offsets[:count]):
            output_path = os.path.join(tmpdir, f"frame_{index}.jpg")
            command = [
                ffmpeg,
                "-hide_banner",
                "-loglevel",
                "error",
                "-ss",
                f"{ts:.3f}",
                "-i",
                path,
                "-frames:v",
                "1",
                "-q:v",
                "2",
                output_path,
            ]
            result = _run_command(command, timeout=15.0)
            if result and result.returncode == 0 and os.path.exists(output_path):
                out_paths.append(output_path)
        # Materialize outputs before tempdir cleanup.
        copied: list[str] = []
        for source in out_paths:
            fd, tmp_out = tempfile.mkstemp(prefix="neuroscore_frame_", suffix=".jpg")
            os.close(fd)
            shutil.copy2(source, tmp_out)
            copied.append(tmp_out)
        return copied


def _extract_audio_wav(path: str) -> str | None:
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        return None
    fd, wav_path = tempfile.mkstemp(prefix="neuroscore_audio_", suffix=".wav")
    os.close(fd)
    command = [
        ffmpeg,
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        path,
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-t",
        "10",
        wav_path,
    ]
    result = _run_command(command, timeout=20.0)
    if result and result.returncode == 0 and os.path.exists(wav_path):
        return wav_path
    try:
        os.remove(wav_path)
    except OSError:
        pass
    return None


def _audio_stats_from_wav(path: str) -> dict:
    import wave

    with wave.open(path, "rb") as wav:
        frames = wav.getnframes()
        sample_width = wav.getsampwidth()
        sample_rate = wav.getframerate()
        channels = wav.getnchannels()
        raw = wav.readframes(frames)

    if not raw:
        return {
            "duration_s": 0.0,
            "sample_rate": sample_rate,
            "channels": channels,
            "energy_rms": 0.0,
            "dynamic_range": 0.0,
            "zero_crossing_rate": 0.0,
            "silence_ratio": 1.0,
            "tempo_proxy": 0.0,
            "voice_likelihood": 0.0,
        }

    rms = audioop.rms(raw, sample_width)
    max_amp = float(2 ** (8 * sample_width - 1))
    peak = audioop.max(raw, sample_width)
    avg = audioop.avg(raw, sample_width)
    zero_crossings = 0
    # Derive a compact zero-crossing proxy without numpy.
    step = sample_width * channels
    prev = None
    for offset in range(0, len(raw), step):
        frame = raw[offset : offset + step]
        if len(frame) < sample_width:
            break
        sample = int.from_bytes(frame[:sample_width], byteorder="little", signed=True)
        sign = sample >= 0
        if prev is not None and sign != prev:
            zero_crossings += 1
        prev = sign
    total_samples = max(1, len(raw) // step)
    zero_crossing_rate = zero_crossings / total_samples
    silence_ratio = max(0.0, 1.0 - (_safe_float(rms, 0.0) / max_amp))
    dynamic_range = (float(peak) - abs(float(avg))) / max_amp
    tempo_proxy = _clamp(zero_crossing_rate * 4.0, 0.0, 1.0)
    voice_likelihood = _clamp((1.0 - silence_ratio) * 0.7 + (1.0 - abs(zero_crossing_rate - 0.12) * 3.0) * 0.3, 0.0, 1.0)

    return {
        "duration_s": frames / sample_rate if sample_rate else 0.0,
        "sample_rate": sample_rate,
        "channels": channels,
        "energy_rms": _clamp(rms / max_amp, 0.0, 1.0),
        "dynamic_range": _clamp(dynamic_range, 0.0, 1.0),
        "zero_crossing_rate": _clamp(zero_crossing_rate, 0.0, 1.0),
        "silence_ratio": _clamp(silence_ratio, 0.0, 1.0),
        "tempo_proxy": tempo_proxy,
        "voice_likelihood": voice_likelihood,
    }


def _face_likelihood_from_cv2(path: str) -> float:
    if cv2 is None:
        return 0.0
    cascade_path = getattr(cv2.data, "haarcascades", "") + "haarcascade_frontalface_default.xml"
    if not os.path.exists(cascade_path):
        return 0.0
    image = cv2.imread(path)
    if image is None:
        return 0.0
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    face_cascade = cv2.CascadeClassifier(cascade_path)
    faces = face_cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=4, minSize=(24, 24))
    if len(faces) == 0:
        return 0.0
    h, w = gray.shape[:2]
    area = sum(float(fw * fh) for (_, _, fw, fh) in faces)
    return _clamp(area / float(w * h), 0.0, 1.0)


def _video_motion_from_cv2(path: str) -> dict:
    if cv2 is None:
        return {"motion": 0.0, "scene_change": 0.0, "frame_luma_std": 0.0, "sampled_frames": 0}
    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        return {"motion": 0.0, "scene_change": 0.0, "frame_luma_std": 0.0, "sampled_frames": 0}
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    fps = float(cap.get(cv2.CAP_PROP_FPS) or 0.0)
    duration = total_frames / fps if total_frames and fps else 0.0
    sample_count = min(8, max(2, total_frames if 0 < total_frames < 8 else 6))
    if total_frames > 0:
        indices = [int(round(i * (total_frames - 1) / max(1, sample_count - 1))) for i in range(sample_count)]
    else:
        indices = list(range(sample_count))

    prev_gray = None
    motions: list[float] = []
    scene_changes: list[float] = []
    lumas: list[float] = []
    face_likelihoods: list[float] = []

    for index in indices:
        cap.set(cv2.CAP_PROP_POS_FRAMES, index)
        ok, frame = cap.read()
        if not ok or frame is None:
            continue
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        lumas.append(float(gray.mean()) / 255.0)
        face_likelihoods.append(_face_likelihood_from_cv2(path))
        if prev_gray is not None:
            diff = cv2.absdiff(gray, prev_gray)
            motions.append(float(diff.mean()) / 255.0)
            scene_changes.append(float((diff > 24).mean()))
        prev_gray = gray

    cap.release()
    motion = statistics.fmean(motions) if motions else 0.0
    scene_change = statistics.fmean(scene_changes) if scene_changes else 0.0
    frame_luma_std = statistics.pstdev(lumas) if len(lumas) > 1 else 0.0
    face_likelihood = statistics.fmean(face_likelihoods) if face_likelihoods else 0.0
    return {
        "motion": _clamp(motion, 0.0, 1.0),
        "scene_change": _clamp(scene_change, 0.0, 1.0),
        "frame_luma_std": _clamp(frame_luma_std, 0.0, 1.0),
        "sampled_frames": len(lumas),
        "face_likelihood": _clamp(face_likelihood, 0.0, 1.0),
        "duration_s": duration,
    }


def extract_visual_features(media_path: str) -> dict:
    probe = _probe_media(media_path)
    features = feature_template()
    features.update(
        {
            "media_path": probe.media_path,
            "media_type": probe.media_type,
            "mime_type": probe.mime_type,
            "extension": probe.extension,
            "file_size_bytes": probe.file_size_bytes,
            "file_size_mb": probe.file_size_mb,
            "sha256_prefix": probe.sha256_prefix,
        }
    )

    if not probe.exists:
        features["visual"] = {}
        return features

    visual = {
        "width": 0,
        "height": 0,
        "aspect_ratio": 0.0,
        "megapixels": 0.0,
        "brightness_mean": 0.0,
        "brightness_std": 0.0,
        "contrast": 0.0,
        "colorfulness": 0.0,
        "edge_density": 0.0,
        "skin_tone_ratio": 0.0,
        "central_mass": 0.0,
        "texture_score": 0.0,
        "motion": 0.0,
        "scene_change": 0.0,
        "face_likelihood": 0.0,
        "text_likelihood": 0.0,
        "layout_likelihood": 0.0,
        "attention_salience": 0.0,
        "visual_entropy": 0.0,
        "has_video_stream": False,
        "has_audio_stream": False,
        "duration_s": 0.0,
        "fps": 0.0,
        "frame_count_estimate": 0,
        "sampled_frames": 0,
        "video_bitrate": 0.0,
        "audio_bitrate": 0.0,
        "channels": 0,
        "sample_rate": 0,
    }

    metadata = _video_probe_features(media_path) if probe.media_type == "video" else {}

    if probe.media_type == "image":
        img_stats = _image_to_rgb_stats(media_path)
        visual.update(img_stats)
        visual["aspect_ratio"] = (img_stats["width"] / img_stats["height"]) if img_stats["width"] and img_stats["height"] else 0.0
        visual["megapixels"] = (img_stats["width"] * img_stats["height"]) / 1_000_000 if img_stats["width"] and img_stats["height"] else 0.0
        visual["text_likelihood"] = _clamp(
            img_stats["edge_density"] * 0.45 + img_stats["contrast"] * 0.35 + (1.0 - img_stats["colorfulness"]) * 0.2,
            0.0,
            1.0,
        )
        visual["layout_likelihood"] = _clamp(
            (1.0 - abs((visual["aspect_ratio"] or 1.0) - 1.0) / 1.5) * 0.4
            + img_stats["central_mass"] * 0.4
            + img_stats["texture_score"] * 0.2,
            0.0,
            1.0,
        )
        visual["attention_salience"] = _clamp(
            img_stats["contrast"] * 0.33 + img_stats["colorfulness"] * 0.25 + img_stats["edge_density"] * 0.24 + img_stats["brightness_std"] * 0.18,
            0.0,
            1.0,
        )
        visual["visual_entropy"] = _normalize_entropy(_stable_entropy(Path(media_path).read_bytes()[: 1_000_000]))
        visual["face_likelihood"] = _clamp(
            img_stats["skin_tone_ratio"] * 0.55 + (1.0 - abs((visual["aspect_ratio"] or 1.0) - 0.8)) * 0.15 + img_stats["central_mass"] * 0.2,
            0.0,
            1.0,
        )
    elif probe.media_type == "video":
        visual.update(metadata)
        if visual.get("width") and visual.get("height"):
            visual["aspect_ratio"] = visual["width"] / visual["height"] if visual["height"] else 0.0
            visual["megapixels"] = (visual["width"] * visual["height"]) / 1_000_000
        sampled_paths = _extract_video_frames(media_path)
        try:
            sampled_stats = [_image_to_rgb_stats(path) for path in sampled_paths]
            motion_probe = _video_motion_from_cv2(media_path)
            if motion_probe.get("sampled_frames"):
                visual["motion"] = _safe_float(motion_probe.get("motion"), 0.0)
                visual["scene_change"] = _safe_float(motion_probe.get("scene_change"), 0.0)
                visual["face_likelihood"] = max(
                    _safe_float(visual.get("face_likelihood"), 0.0),
                    _safe_float(motion_probe.get("face_likelihood"), 0.0),
                )
                visual["sampled_frames"] = _safe_int(motion_probe.get("sampled_frames"), visual.get("sampled_frames", 0))
            if sampled_stats:
                visual["brightness_mean"] = statistics.fmean(item["brightness_mean"] for item in sampled_stats)
                visual["brightness_std"] = statistics.fmean(item["brightness_std"] for item in sampled_stats)
                visual["contrast"] = statistics.fmean(item["contrast"] for item in sampled_stats)
                visual["colorfulness"] = statistics.fmean(item["colorfulness"] for item in sampled_stats)
                visual["edge_density"] = statistics.fmean(item["edge_density"] for item in sampled_stats)
                visual["skin_tone_ratio"] = statistics.fmean(item["skin_tone_ratio"] for item in sampled_stats)
                visual["central_mass"] = statistics.fmean(item["central_mass"] for item in sampled_stats)
                visual["texture_score"] = statistics.fmean(item["texture_score"] for item in sampled_stats)
                visual["text_likelihood"] = _clamp(
                    visual["edge_density"] * 0.4 + visual["contrast"] * 0.35 + (1.0 - visual["colorfulness"]) * 0.25,
                    0.0,
                    1.0,
                )
                visual["layout_likelihood"] = _clamp(
                    (1.0 - abs((visual["aspect_ratio"] or 1.0) - 1.0) / 1.6) * 0.35
                    + visual["central_mass"] * 0.25
                    + visual["texture_score"] * 0.4,
                    0.0,
                    1.0,
                )
                visual["attention_salience"] = _clamp(
                    visual["contrast"] * 0.22
                    + visual["colorfulness"] * 0.18
                    + visual["edge_density"] * 0.2
                    + visual["scene_change"] * 0.2
                    + visual["motion"] * 0.2,
                    0.0,
                    1.0,
                )
                visual["visual_entropy"] = statistics.fmean(
                    _normalize_entropy(_stable_entropy(Path(path).read_bytes()[: 100_000])) for path in sampled_paths
                )
        finally:
            for path in sampled_paths:
                try:
                    os.remove(path)
                except OSError:
                    pass
        if visual["motion"] <= 0.0:
            motion_hint = _clamp((visual["fps"] / 30.0) * 0.25 + (visual["frame_count_estimate"] / 120.0) * 0.25 + visual["scene_change"] * 0.5, 0.0, 1.0)
            visual["motion"] = motion_hint
    else:
        visual["visual_entropy"] = _normalize_entropy(_stable_entropy(Path(media_path).read_bytes()[: 200_000]))
        visual["attention_salience"] = visual["visual_entropy"] * 0.45

    visual["has_video_stream"] = bool(metadata.get("has_video_stream"))
    visual["has_audio_stream"] = bool(metadata.get("has_audio_stream"))
    visual["duration_s"] = _safe_float(metadata.get("duration_s"), 0.0)
    visual["fps"] = _safe_float(metadata.get("fps"), 0.0)
    visual["frame_count_estimate"] = _safe_int(metadata.get("frame_count_estimate"), 0)
    visual["sampled_frames"] = _safe_int(metadata.get("sampled_frames"), 0)
    visual["video_bitrate"] = _safe_float(metadata.get("video_bitrate"), 0.0)
    visual["audio_bitrate"] = _safe_float(metadata.get("audio_bitrate"), 0.0)
    visual["channels"] = _safe_int(metadata.get("channels"), 0)
    visual["sample_rate"] = _safe_int(metadata.get("sample_rate"), 0)

    features["visual"] = visual
    return features


def extract_audio_features(media_path: str) -> dict:
    probe = _probe_media(media_path)
    audio = {
        "present": False,
        "duration_s": 0.0,
        "sample_rate": 0,
        "channels": 0,
        "energy_rms": 0.0,
        "dynamic_range": 0.0,
        "zero_crossing_rate": 0.0,
        "silence_ratio": 1.0,
        "tempo_proxy": 0.0,
        "voice_likelihood": 0.0,
        "speech_rhythm": 0.0,
        "beat_likelihood": 0.0,
    }

    if not probe.exists:
        return audio

    if probe.media_type == "audio":
        wav_path = None
        try:
            wav_path = _extract_audio_wav(media_path)
            if wav_path:
                audio.update(_audio_stats_from_wav(wav_path))
                audio["present"] = True
        finally:
            if wav_path and os.path.exists(wav_path):
                try:
                    os.remove(wav_path)
                except OSError:
                    pass
    elif probe.media_type == "video":
        probe_data = _video_probe_features(media_path)
        audio["present"] = bool(probe_data.get("has_audio_stream"))
        audio["duration_s"] = _safe_float(probe_data.get("duration_s"), 0.0)
        audio["sample_rate"] = _safe_int(probe_data.get("sample_rate"), 0)
        audio["channels"] = _safe_int(probe_data.get("channels"), 0)
        if audio["present"]:
            wav_path = None
            try:
                wav_path = _extract_audio_wav(media_path)
                if wav_path:
                    audio.update(_audio_stats_from_wav(wav_path))
                    audio["present"] = True
            finally:
                if wav_path and os.path.exists(wav_path):
                    try:
                        os.remove(wav_path)
                    except OSError:
                        pass
        if not audio["present"]:
            audio["voice_likelihood"] = _clamp(
                (_safe_float(probe_data.get("audio_bitrate"), 0.0) / 128000.0) * 0.5
                + (_safe_int(probe_data.get("channels"), 0) >= 1) * 0.2
                + (_safe_float(probe_data.get("duration_s"), 0.0) > 0.0) * 0.3,
                0.0,
                1.0,
            )
    else:
        audio["voice_likelihood"] = 0.0

    audio["speech_rhythm"] = _clamp(audio["tempo_proxy"] * 0.7 + audio["voice_likelihood"] * 0.3, 0.0, 1.0)
    audio["beat_likelihood"] = _clamp(audio["tempo_proxy"] * 0.55 + (1.0 - audio["silence_ratio"]) * 0.45, 0.0, 1.0)
    return audio


def extract_text_features(text: str | None) -> dict:
    if text is None:
        text = ""
    normalized = text.strip()
    words = re.findall(r"[A-Za-z0-9']+", normalized.lower())
    word_count = len(words)
    unique_words = len(set(words))
    sentences = [chunk for chunk in re.split(r"[.!?]+", normalized) if chunk.strip()]
    sentence_count = len(sentences)
    chars = len(normalized)
    letters = sum(1 for ch in normalized if ch.isalpha())
    upper = sum(1 for ch in normalized if ch.isupper())
    digits = sum(1 for ch in normalized if ch.isdigit())
    imperative_hits = sum(1 for word in words if word in IMPERATIVE_HINTS)
    cta_hits = sum(1 for word in words if word in CTA_KEYWORDS)
    semantic_hits = sum(1 for word in words if word in SEMANTIC_KEYWORDS)
    long_words = sum(1 for word in words if len(word) >= 8)
    avg_word_length = (sum(len(word) for word in words) / word_count) if word_count else 0.0
    unique_ratio = unique_words / word_count if word_count else 0.0
    keyword_density = semantic_hits / word_count if word_count else 0.0
    cta_strength = _clamp((cta_hits * 0.22) + (imperative_hits * 0.12) + (1.0 if re.search(r"\b(sign up|buy now|learn more|get started|shop now|download)\b", normalized.lower()) else 0.0), 0.0, 1.0)
    imperative_strength = _clamp((imperative_hits / max(1, word_count)) * 4.0, 0.0, 1.0)
    readability = _clamp(
        1.0
        - min(1.0, abs(avg_word_length - 4.8) / 6.0)
        - min(0.35, max(0.0, unique_ratio - 0.85) * 0.45),
        0.0,
        1.0,
    )
    semantic_clarity = _clamp(
        (sentence_count > 0) * 0.2
        + (keyword_density * 0.35)
        + (1.0 - min(1.0, unique_ratio * 0.55)) * 0.2
        + readability * 0.25,
        0.0,
        1.0,
    )
    urgency = _clamp((cta_strength * 0.55) + (imperative_strength * 0.25) + (digits > 0) * 0.1 + (len(re.findall(r"!", normalized)) * 0.05), 0.0, 1.0)

    return {
        "provided": bool(normalized),
        "text": normalized,
        "word_count": word_count,
        "sentence_count": sentence_count,
        "char_count": chars,
        "unique_ratio": unique_ratio,
        "avg_word_length": avg_word_length,
        "upper_ratio": upper / max(1, chars),
        "digit_ratio": digits / max(1, chars),
        "long_word_ratio": long_words / max(1, word_count),
        "cta_hits": cta_hits,
        "imperative_hits": imperative_hits,
        "semantic_hits": semantic_hits,
        "keyword_density": keyword_density,
        "cta_strength": cta_strength,
        "imperative_strength": imperative_strength,
        "readability": readability,
        "semantic_clarity": semantic_clarity,
        "urgency": urgency,
        "contains_transcript": bool(normalized),
    }


def _merge_feature_maps(*parts: dict) -> dict:
    merged = feature_template()
    for part in parts:
        for key, value in part.items():
            if key in {"visual", "audio", "text"} and isinstance(value, dict):
                merged[key].update(value)
            else:
                merged[key] = value
    return merged


def compute_dimension_scores(features: dict, context: str | None = None) -> dict:
    visual = features.get("visual", {}) or {}
    audio = features.get("audio", {}) or {}
    text = features.get("text", {}) or {}
    context_weights = get_context_weights(context if context is not None else DEFAULT_CONTEXT)

    visual_detail = _clamp(
        _safe_float(visual.get("contrast")) * 0.3
        + _safe_float(visual.get("edge_density")) * 0.25
        + _safe_float(visual.get("texture_score")) * 0.2
        + _safe_float(visual.get("visual_entropy")) * 0.25,
        0.0,
        1.0,
    )
    face_signal = _clamp(_safe_float(visual.get("face_likelihood")) * 0.7 + _safe_float(visual.get("skin_tone_ratio")) * 0.2 + _safe_float(visual.get("central_mass")) * 0.1, 0.0, 1.0)
    layout_signal = _clamp(_safe_float(visual.get("layout_likelihood")) * 0.6 + (1.0 - abs(_safe_float(visual.get("aspect_ratio"), 1.0) - 1.0) / 1.8) * 0.4, 0.0, 1.0)
    motion_signal = _clamp(
        _safe_float(visual.get("motion")) * 0.4
        + _safe_float(visual.get("scene_change")) * 0.25
        + _safe_float(audio.get("tempo_proxy")) * 0.2
        + _safe_float(audio.get("beat_likelihood")) * 0.15,
        0.0,
        1.0,
    )
    attention_signal = _clamp(
        _safe_float(visual.get("attention_salience")) * 0.5
        + _safe_float(visual.get("contrast")) * 0.2
        + _safe_float(visual.get("motion")) * 0.15
        + _safe_float(visual.get("colorfulness")) * 0.15,
        0.0,
        1.0,
    )
    text_signal = _clamp(
        _safe_float(text.get("cta_strength")) * 0.35
        + _safe_float(text.get("keyword_density")) * 0.3
        + _safe_float(visual.get("text_likelihood")) * 0.35,
        0.0,
        1.0,
    )
    decision_signal = _clamp(
        _safe_float(text.get("cta_strength")) * 0.35
        + _safe_float(text.get("urgency")) * 0.2
        + _safe_float(text.get("semantic_clarity")) * 0.2
        + _safe_float(audio.get("voice_likelihood")) * 0.1
        + _safe_float(visual.get("attention_salience")) * 0.15,
        0.0,
        1.0,
    )
    semantic_signal = _clamp(
        _safe_float(text.get("semantic_clarity")) * 0.45
        + _safe_float(text.get("keyword_density")) * 0.2
        + _safe_float(text.get("readability")) * 0.15
        + _safe_float(audio.get("voice_likelihood")) * 0.1
        + _safe_float(visual.get("layout_likelihood")) * 0.1,
        0.0,
        1.0,
    )
    primary_visuality = _clamp(
        visual_detail * 0.45
        + attention_signal * 0.2
        + layout_signal * 0.15
        + (1.0 - _safe_float(audio.get("silence_ratio"))) * 0.1
        + _safe_float(visual.get("brightness_std")) * 0.1,
        0.0,
        1.0,
    )

    scores = {
        "v1": _round_score(12 + primary_visuality * 72 + _safe_float(visual.get("brightness_mean")) * 8 + _safe_float(visual.get("texture_score")) * 8),
        "ffa": _round_score(8 + face_signal * 80 + _safe_float(visual.get("central_mass")) * 7 + _safe_float(visual.get("brightness_std")) * 5),
        "ppa": _round_score(10 + layout_signal * 78 + (1.0 - _safe_float(visual.get("motion"))) * 8 + _safe_float(visual.get("aspect_ratio")) * 2),
        "v5": _round_score(8 + motion_signal * 82 + _safe_float(visual.get("fps")) / 30.0 * 5 + _safe_float(audio.get("tempo_proxy")) * 5),
        "ips": _round_score(14 + attention_signal * 76 + _safe_float(visual.get("contrast")) * 6 + (1.0 - _safe_float(visual.get("brightness_mean"))) * 4),
        "broca": _round_score(10 + text_signal * 82 + _safe_float(text.get("readability")) * 4 + _safe_float(text.get("imperative_strength")) * 4),
        "pfc": _round_score(12 + decision_signal * 78 + _safe_float(text.get("semantic_clarity")) * 5 + _safe_float(visual.get("layout_likelihood")) * 5),
        "semantic": _round_score(12 + semantic_signal * 80 + _safe_float(text.get("semantic_hits")) * 2.0 + _safe_float(text.get("unique_ratio")) * 4),
    }

    confidence = {
        "v1": _clamp(0.35 + _safe_float(visual.get("edge_density")) * 0.3 + _safe_float(visual.get("visual_entropy")) * 0.2 + _safe_float(visual.get("sampled_frames")) / 10.0 * 0.15, 0.0, 1.0),
        "ffa": _clamp(0.3 + face_signal * 0.45 + _safe_float(visual.get("sampled_frames")) / 10.0 * 0.25, 0.0, 1.0),
        "ppa": _clamp(0.38 + layout_signal * 0.32, 0.0, 1.0),
        "v5": _clamp(0.32 + motion_signal * 0.42 + _safe_float(visual.get("sampled_frames")) / 10.0 * 0.18 + _safe_float(audio.get("present")) * 0.08, 0.0, 1.0),
        "ips": _clamp(0.4 + attention_signal * 0.35 + _safe_float(visual.get("contrast")) * 0.15, 0.0, 1.0),
        "broca": _clamp(0.36 + text_signal * 0.42 + _safe_float(text.get("provided")) * 0.12, 0.0, 1.0),
        "pfc": _clamp(0.34 + decision_signal * 0.4 + _safe_float(text.get("provided")) * 0.1 + _safe_float(visual.get("layout_likelihood")) * 0.1, 0.0, 1.0),
        "semantic": _clamp(0.38 + semantic_signal * 0.4 + _safe_float(text.get("provided")) * 0.12 + _safe_float(audio.get("present")) * 0.05, 0.0, 1.0),
    }

    confidence["ppa"] = _clamp(0.38 + layout_signal * 0.32 + (1.0 - abs(_safe_float(visual.get("aspect_ratio"), 1.0) - 1.0) / 2.0) * 0.1, 0.0, 1.0)

    base_total_weight = 0.0
    base_weighted_sum = 0.0
    ctx_total_weight = 0.0
    ctx_weighted_sum = 0.0
    for region, score in scores.items():
        conf_weight = confidence.get(region, 0.0) + 0.2
        base_weighted_sum += score * conf_weight
        base_total_weight += conf_weight
        ctx_weight = context_weights.get(region, 1.0) * conf_weight
        ctx_weighted_sum += score * ctx_weight
        ctx_total_weight += ctx_weight
    base_ux_score = _round_score(base_weighted_sum / base_total_weight if base_total_weight else 0.0)
    ux_score = _round_score(ctx_weighted_sum / ctx_total_weight if ctx_total_weight else 0.0)

    return {
        "scores": scores,
        "confidence_by_region": confidence,
        "ux_score": ux_score,
        "base_ux_score": base_ux_score,
    }


def _signal_pack(feature_value: Any, weight: float, direction: str = "positive") -> dict:
    return {
        "value": round(_safe_float(feature_value), 4),
        "weight": round(weight, 4),
        "direction": direction,
    }


def build_evidence(features: dict, scores: dict) -> dict:
    visual = features.get("visual", {}) or {}
    audio = features.get("audio", {}) or {}
    text = features.get("text", {}) or {}
    region_scores = scores.get("scores", scores)

    evidence = blank_evidence_map()
    mapped_signals = {
        "v1": [
            ("contrast", visual.get("contrast"), 0.28),
            ("edge_density", visual.get("edge_density"), 0.26),
            ("texture_score", visual.get("texture_score"), 0.22),
            ("visual_entropy", visual.get("visual_entropy"), 0.24),
        ],
        "ffa": [
            ("face_likelihood", visual.get("face_likelihood"), 0.5),
            ("skin_tone_ratio", visual.get("skin_tone_ratio"), 0.18),
            ("central_mass", visual.get("central_mass"), 0.16),
            ("portrait_bias", 1.0 - min(1.0, abs(_safe_float(visual.get("aspect_ratio"), 1.0) - 0.8)), 0.16),
        ],
        "ppa": [
            ("layout_likelihood", visual.get("layout_likelihood"), 0.46),
            ("aspect_balance", 1.0 - min(1.0, abs(_safe_float(visual.get("aspect_ratio"), 1.0) - 1.0) / 1.8), 0.22),
            ("scene_change", visual.get("scene_change"), 0.18),
            ("stability", 1.0 - _safe_float(visual.get("motion")), 0.14),
        ],
        "v5": [
            ("motion", visual.get("motion"), 0.42),
            ("scene_change", visual.get("scene_change"), 0.26),
            ("tempo_proxy", audio.get("tempo_proxy"), 0.18),
            ("beat_likelihood", audio.get("beat_likelihood"), 0.14),
        ],
        "ips": [
            ("attention_salience", visual.get("attention_salience"), 0.42),
            ("contrast", visual.get("contrast"), 0.23),
            ("motion", visual.get("motion"), 0.19),
            ("brightness_std", visual.get("brightness_std"), 0.16),
        ],
        "broca": [
            ("cta_strength", text.get("cta_strength"), 0.38),
            ("keyword_density", text.get("keyword_density"), 0.24),
            ("text_likelihood", visual.get("text_likelihood"), 0.24),
            ("readability", text.get("readability"), 0.14),
        ],
        "pfc": [
            ("decision_signal", text.get("cta_strength"), 0.25),
            ("urgency", text.get("urgency"), 0.25),
            ("semantic_clarity", text.get("semantic_clarity"), 0.25),
            ("layout_likelihood", visual.get("layout_likelihood"), 0.25),
        ],
        "semantic": [
            ("semantic_clarity", text.get("semantic_clarity"), 0.42),
            ("keyword_density", text.get("keyword_density"), 0.22),
            ("readability", text.get("readability"), 0.18),
            ("voice_likelihood", audio.get("voice_likelihood"), 0.18),
        ],
    }

    for region in REGIONS:
        signals = []
        for name, value, weight in mapped_signals[region]:
            signals.append({"name": name, **_signal_pack(value, weight)})
        signals.sort(key=lambda item: item["weight"], reverse=True)
        top_signals = signals[:3]
        score = _safe_int(region_scores.get(region), 0)
        evidence[region] = {
            "summary": _build_region_summary(region, score, features),
            "primary_signals": top_signals,
            "supporting_signals": signals[3:],
        }
    return evidence


def _build_region_summary(region: str, score: int, features: dict) -> str:
    visual = features.get("visual", {}) or {}
    audio = features.get("audio", {}) or {}
    text = features.get("text", {}) or {}
    if region == "ffa":
        if _safe_float(visual.get("face_likelihood")) > 0.35:
            return f"High face/portrait likelihood with score {score}."
        return f"Low face evidence with score {score}; likely driven by generic visual structure."
    if region == "v5":
        if _safe_float(visual.get("motion")) > 0.3 or _safe_float(audio.get("tempo_proxy")) > 0.25:
            return f"Dynamic motion cues support score {score}."
        return f"Limited motion cues produce score {score}."
    if region == "broca":
        if _safe_float(text.get("cta_strength")) > 0.2:
            return f"Text and CTA cues support score {score}."
        return f"Text evidence is weak; score {score} comes mostly from fallback heuristics."
    if region == "semantic":
        if _safe_float(text.get("semantic_clarity")) > 0.3:
            return f"Transcript semantics anchor score {score}."
        return f"Semantics are lightly supported, so score {score} stays conservative."
    label = REGION_LABELS.get(region, region)
    return f"{label} score {score} derived from deterministic feature balance."


def _compose_report(result: dict) -> str:
    scores = result.get("scores", {})
    confidence = result.get("confidence_by_region", {})
    strongest = sorted(scores.items(), key=lambda item: item[1], reverse=True)[:3]
    weakest = sorted(scores.items(), key=lambda item: item[1])[:2]
    strongest_txt = ", ".join(f"{region.upper()} {score}" for region, score in strongest)
    weakest_txt = ", ".join(f"{region.upper()} {score}" for region, score in weakest)
    mean_conf = statistics.fmean(confidence.values()) if confidence else 0.0
    ctx = result.get("context", {}) or {}
    ctx_key = ctx.get("key", DEFAULT_CONTEXT)
    ctx_label = ctx.get("label", context_label(ctx_key))
    ux_score = result.get("ux_score", 0)
    base_ux_score = result.get("base_ux_score", ux_score)
    context_line = (
        f"Context: {ctx_label}. UX score: {ux_score} (base {base_ux_score})."
        if ctx_key != DEFAULT_CONTEXT
        else f"Context: {ctx_label}. UX score: {ux_score}."
    )
    return (
        f"NeuroScore v2 (lightweight) analyzed the media with average confidence {mean_conf:.2f}. "
        f"Strongest regions: {strongest_txt}. "
        f"Weakest regions: {weakest_txt}. "
        f"{context_line}"
    )


def analyze_media(
    media_path: str,
    transcript: str | None = None,
    context: str | None = None,
) -> dict:
    start = time.perf_counter()
    context_key = normalize_context_key(context)
    visual_features = extract_visual_features(media_path)
    audio_features = extract_audio_features(media_path)
    text_features = extract_text_features(transcript)
    features = _merge_feature_maps(visual_features, {"audio": audio_features, "text": text_features})
    score_bundle = compute_dimension_scores(features, context=context_key)
    evidence = build_evidence(features, score_bundle)

    result = output_template()
    result["media_path"] = str(media_path)
    result["scores"] = score_bundle["scores"]
    result["confidence_by_region"] = score_bundle["confidence_by_region"]
    result["evidence_by_region"] = evidence
    result["ux_score"] = score_bundle["ux_score"]
    result["base_ux_score"] = score_bundle["base_ux_score"]
    result["context"] = context_block(context_key)
    result["elapsed"] = round(time.perf_counter() - start, 4)
    result["relatorio"] = _compose_report(result)
    result["features"] = features

    # Convenience aliases for consumers that expect top-level region keys.
    result.update(result["scores"])
    return result


def _cli() -> int:
    import argparse

    parser = argparse.ArgumentParser(description="Run the lightweight NeuroScore v2 pipeline.")
    parser.add_argument("media_path", help="Path to an image, video, or audio file.")
    parser.add_argument("--transcript", default=None, help="Optional transcript or OCR text.")
    parser.add_argument(
        "--context",
        default=DEFAULT_CONTEXT,
        help="Cognitive context: banking, ecommerce, gaming, content, saas, social, health, generic.",
    )
    parser.add_argument("--pretty", action="store_true", help="Pretty-print JSON output.")
    args = parser.parse_args()

    output = analyze_media(args.media_path, transcript=args.transcript, context=args.context)
    print(json.dumps(output, ensure_ascii=False, indent=2 if args.pretty else None))
    return 0


if __name__ == "__main__":
    raise SystemExit(_cli())
