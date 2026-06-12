from __future__ import annotations

import base64
import hashlib
import json
import subprocess
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import quote

from .config import THUMBNAILS_DIR, VIDEO_EXTENSIONS, VIDEOS_DIR, remote_video_path

DEFAULT_PROJECTION = "180_sbs_lr"
FLAT_SBS_PROJECTION = "flat_sbs_lr"
FISHEYE_180_PROJECTION = "180_fisheye_sbs_lr"
SBS_360_PROJECTION = "360_sbs_lr"


@dataclass(frozen=True)
class VideoInfo:
    id: str
    filename: str
    path: Path
    size: int
    url: str
    source: str = "local"
    source_label: str = "Local"
    codec: str | None = None
    width: int | None = None
    height: int | None = None
    duration: float | None = None
    bitrate: int | None = None
    fps: float | None = None
    projection: str = DEFAULT_PROJECTION

    def public_dict(self) -> dict:
        return {
            "id": self.id,
            "filename": self.filename,
            "size": self.size,
            "url": self.url,
            "thumbnailUrl": f"/thumbnails/{self.id}.jpg",
            "source": self.source,
            "sourceLabel": self.source_label,
            "codec": self.codec,
            "width": self.width,
            "height": self.height,
            "duration": self.duration,
            "bitrate": self.bitrate,
            "fps": self.fps,
            "projection": self.projection,
        }


def list_videos(source: str | None = None, *, include_metadata: bool = True) -> list[VideoInfo]:
    videos: list[VideoInfo] = []

    if source in (None, "local") and (root := _source_root("local")):
        videos.extend(_list_path_videos(root, "local", "Local", probe_metadata=include_metadata))

    if source in (None, "remote") and (root := _source_root("remote")):
        videos.extend(_list_path_videos(root, "remote", "Remote", probe_metadata=False))

    return videos


def iter_videos_recursive(source: str) -> list[VideoInfo]:
    root = _source_root(source)
    if root is None:
        return []

    source_label = "Remote" if source == "remote" else "Local"
    videos: list[VideoInfo] = []
    try:
        paths = sorted(root.rglob("*"), key=lambda path: path.as_posix().lower())
    except OSError:
        return videos

    for path in paths:
        if not path.is_file() or path.suffix.lower() not in VIDEO_EXTENSIONS:
            continue
        try:
            size = path.stat().st_size
            relative_path = path.relative_to(root).as_posix()
        except OSError:
            continue

        video_id = encode_video_id(source, relative_path)
        videos.append(
            VideoInfo(
                id=video_id,
                filename=path.name,
                path=path,
                size=size,
                url=f"/media/{video_id}/{quote(path.name)}",
                source=source,
                source_label=source_label,
                projection=DEFAULT_PROJECTION,
            )
        )

    return videos


def _list_path_videos(root: Path, source: str, source_label: str, *, probe_metadata: bool) -> list[VideoInfo]:
    videos: list[VideoInfo] = []

    try:
        paths = sorted(root.iterdir())
    except OSError:
        return videos

    for index, path in enumerate(paths):
        if not path.is_file() or path.suffix.lower() not in VIDEO_EXTENSIONS:
            continue

        try:
            size = path.stat().st_size
        except OSError:
            continue

        relative_path = path.relative_to(root).as_posix()
        video_id = encode_video_id(source, relative_path)
        metadata = _probe(path) if probe_metadata else {}
        videos.append(
            VideoInfo(
                id=video_id,
                filename=path.name,
                path=path,
                size=size,
                url=f"/media/{video_id}/{quote(path.name)}",
                source=source,
                source_label=source_label,
                codec=metadata.get("codec"),
                width=metadata.get("width"),
                height=metadata.get("height"),
                duration=metadata.get("duration"),
                bitrate=metadata.get("bitrate"),
                fps=metadata.get("fps"),
                projection=metadata.get("projection", DEFAULT_PROJECTION),
            )
        )

    return videos


def get_video(video_id: str, *, include_metadata: bool = False) -> VideoInfo | None:
    decoded = decode_video_id(video_id)
    if decoded is None:
        return next((video for video in list_videos(include_metadata=False) if video.id == video_id), None)

    source, relative_path = decoded
    root = _source_root(source)
    if root is None:
        return None

    path = _safe_child_path(root, relative_path)
    if path is None or not path.is_file() or path.suffix.lower() not in VIDEO_EXTENSIONS:
        return None

    try:
        size = path.stat().st_size
    except OSError:
        return None

    source_label = "Remote" if source == "remote" else "Local"
    metadata = _probe(path) if include_metadata else {}
    return VideoInfo(
        id=video_id,
        filename=path.name,
        path=path,
        size=size,
        url=f"/media/{video_id}/{quote(path.name)}",
        source=source,
        source_label=source_label,
        codec=metadata.get("codec"),
        width=metadata.get("width"),
        height=metadata.get("height"),
        duration=metadata.get("duration"),
        bitrate=metadata.get("bitrate"),
        fps=metadata.get("fps"),
        projection=metadata.get("projection", DEFAULT_PROJECTION),
    )


def browse_directory(source: str, relative_path: str = "") -> dict:
    root = _source_root(source)
    if root is None:
        return {"source": source, "path": "", "parentPath": None, "items": []}

    directory = _safe_child_path(root, relative_path)
    if directory is None or not directory.is_dir():
        directory = root

    try:
        paths = sorted(directory.iterdir(), key=lambda path: (not path.is_dir(), path.name.lower()))
    except OSError:
        paths = []

    current_path = "" if directory == root else directory.relative_to(root).as_posix()
    parent_path = None
    if directory != root:
        parent = directory.parent
        parent_path = "" if parent == root else parent.relative_to(root).as_posix()

    items: list[dict] = []
    for path in paths:
        if path.name.startswith("."):
            continue
        if path.is_dir():
            relative = path.relative_to(root).as_posix()
            items.append(
                {
                    "type": "directory",
                    "name": path.name,
                    "path": relative,
                    "source": source,
                }
            )
        elif path.is_file() and path.suffix.lower() in VIDEO_EXTENSIONS:
            relative = path.relative_to(root).as_posix()
            video_id = encode_video_id(source, relative)
            items.append(
                {
                    "type": "video",
                    "id": video_id,
                    "name": path.name,
                    "filename": path.name,
                    "path": relative,
                    "source": source,
                    "url": f"/media/{video_id}/{quote(path.name)}",
                    "thumbnailUrl": f"/thumbnails/{video_id}.jpg",
                    "projection": DEFAULT_PROJECTION,
                }
            )

    return {"source": source, "path": current_path, "parentPath": parent_path, "items": items}


def get_thumbnail(video_id: str) -> Path | None:
    video = get_video(video_id)
    if video is None:
        return None

    THUMBNAILS_DIR.mkdir(parents=True, exist_ok=True)
    thumbnail_path = THUMBNAILS_DIR / f"{_thumbnail_key(video)}.jpg"
    if thumbnail_path.exists():
        return thumbnail_path

    if _generate_thumbnail(video.path, thumbnail_path):
        return thumbnail_path

    thumbnail_path.unlink(missing_ok=True)
    return None


def _thumbnail_key(video: VideoInfo) -> str:
    raw = f"v2:{video.source}:{video.path}:{video.size}:{int(video.path.stat().st_mtime)}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:24]


def encode_video_id(source: str, relative_path: str) -> str:
    encoded = base64.urlsafe_b64encode(relative_path.encode("utf-8")).decode("ascii").rstrip("=")
    return f"{source}:{encoded}"


def decode_video_id(video_id: str) -> tuple[str, str] | None:
    if ":" not in video_id:
        return None
    source, encoded = video_id.split(":", 1)
    if source not in ("local", "remote") or not encoded:
        return None
    try:
        padding = "=" * (-len(encoded) % 4)
        relative_path = base64.urlsafe_b64decode(f"{encoded}{padding}").decode("utf-8")
    except (ValueError, UnicodeDecodeError):
        return None
    return source, relative_path


def _source_root(source: str) -> Path | None:
    if source == "local":
        VIDEOS_DIR.mkdir(exist_ok=True)
        return VIDEOS_DIR.resolve()
    if source == "remote":
        remote_path = remote_video_path()
        if remote_path and _path_exists(remote_path):
            try:
                return remote_path.resolve()
            except OSError:
                return None
    return None


def _path_exists(path: Path) -> bool:
    try:
        return path.exists()
    except OSError:
        return False


def _safe_child_path(root: Path, relative_path: str) -> Path | None:
    try:
        child = (root / relative_path).resolve()
        child.relative_to(root)
    except (OSError, ValueError):
        return None
    return child


def _generate_thumbnail(video_path: Path, thumbnail_path: Path) -> bool:
    for seek_seconds in _thumbnail_seek_seconds(video_path):
        try:
            subprocess.run(
                [
                    "ffmpeg",
                    "-y",
                    "-ss",
                    str(seek_seconds),
                    "-i",
                    str(video_path),
                    "-frames:v",
                    "1",
                    "-vf",
                    "scale=320:-2",
                    "-q:v",
                    "5",
                    str(thumbnail_path),
                ],
                check=True,
                capture_output=True,
                timeout=20,
            )
            return thumbnail_path.exists()
        except (FileNotFoundError, subprocess.SubprocessError):
            continue

    return False


def _thumbnail_seek_seconds(video_path: Path) -> list[float]:
    duration = _probe(video_path).get("duration")
    if not duration or duration <= 0:
        return [30, 5, 0.5]

    max_seek = max(duration - 1, 0.5)
    candidates = [
        duration * 0.35,
        duration * 0.55,
        90,
        30,
        5,
        0.5,
    ]
    seek_seconds: list[float] = []
    for candidate in candidates:
        value = round(min(max(candidate, 0.5), max_seek), 1)
        if value not in seek_seconds:
            seek_seconds.append(value)
    return seek_seconds


def _probe(path: Path) -> dict:
    try:
        result = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_streams",
                "-show_format",
                "-of",
                "json",
                str(path),
            ],
            check=True,
            capture_output=True,
            text=True,
            timeout=5,
        )
    except (FileNotFoundError, subprocess.SubprocessError):
        return {}

    try:
        data = json.loads(result.stdout)
    except json.JSONDecodeError:
        return {}

    video_stream = next(
        (stream for stream in data.get("streams", []) if stream.get("codec_type") == "video"),
        {},
    )
    fmt = data.get("format", {})
    width = _int_or_none(video_stream.get("width"))
    height = _int_or_none(video_stream.get("height"))

    return {
        "codec": video_stream.get("codec_name"),
        "width": width,
        "height": height,
        "duration": _float_or_none(video_stream.get("duration") or fmt.get("duration")),
        "bitrate": _int_or_none(video_stream.get("bit_rate") or fmt.get("bit_rate")),
        "fps": _fps(video_stream.get("avg_frame_rate")),
        "projection": _detect_projection(video_stream, fmt, width, height),
    }


def _detect_projection(video_stream: dict, fmt: dict, width: int | None, height: int | None) -> str:
    metadata_projection = _projection_from_metadata(video_stream, fmt, width, height)
    if metadata_projection:
        return metadata_projection
    return _projection_from_dimensions(width, height)


def _projection_from_metadata(video_stream: dict, fmt: dict, width: int | None, height: int | None) -> str | None:
    text = " ".join(_metadata_values(video_stream, fmt))
    if not text:
        return None

    has_left_right = any(token in text for token in ("left-right", "left_right", "leftright", "sbs", "side-by-side", "side_by_side"))
    has_spherical = any(token in text for token in ("equirectangular", "spherical", "vr180", "360", "fisheye"))

    if "fisheye" in text and has_left_right:
        return FISHEYE_180_PROJECTION
    if "360" in text and has_left_right:
        return SBS_360_PROJECTION
    if has_left_right and has_spherical:
        return _projection_from_dimensions(width, height)

    return None


def _metadata_values(video_stream: dict, fmt: dict) -> list[str]:
    values: list[str] = []
    for source in (video_stream.get("tags"), fmt.get("tags")):
        if isinstance(source, dict):
            values.extend(f"{key}={value}".lower() for key, value in source.items())

    for side_data in video_stream.get("side_data_list") or []:
        if isinstance(side_data, dict):
            values.extend(f"{key}={value}".lower() for key, value in side_data.items())

    return values


def _projection_from_dimensions(width: int | None, height: int | None) -> str:
    if not width or not height:
        return DEFAULT_PROJECTION

    eye_aspect = (width / 2) / height
    if abs(eye_aspect - 2.0) <= 0.2:
        return SBS_360_PROJECTION
    if abs(eye_aspect - (16 / 9)) <= 0.25:
        return FLAT_SBS_PROJECTION
    if abs(eye_aspect - 1.0) <= 0.18:
        return DEFAULT_PROJECTION

    return DEFAULT_PROJECTION


def _int_or_none(value: object) -> int | None:
    try:
        return int(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def _float_or_none(value: object) -> float | None:
    try:
        return float(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def _fps(value: str | None) -> float | None:
    if not value or value == "0/0":
        return None
    if "/" not in value:
        return _float_or_none(value)
    numerator, denominator = value.split("/", 1)
    try:
        return round(int(numerator) / int(denominator), 3)
    except (TypeError, ValueError, ZeroDivisionError):
        return None
