from __future__ import annotations

import json
import os
from pathlib import Path
from urllib.parse import unquote, urlparse


BASE_DIR = Path(__file__).resolve().parent.parent
VIDEOS_DIR = BASE_DIR / "videos"
STATIC_DIR = BASE_DIR / "static"
CONFIG_PATH = BASE_DIR / "config.json"
THUMBNAILS_DIR = BASE_DIR / ".cache" / "thumbnails"
CHUNK_SIZE = 1024 * 1024

VIDEO_EXTENSIONS = {".mp4", ".m4v", ".webm", ".mov"}


def load_app_config() -> dict:
    if not CONFIG_PATH.exists():
        return {}

    try:
        with CONFIG_PATH.open("r", encoding="utf-8") as file:
            data = json.load(file)
    except (OSError, json.JSONDecodeError):
        return {}

    return data if isinstance(data, dict) else {}


def save_app_config(config: dict) -> None:
    CONFIG_PATH.write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")


def desktop_stream_config() -> dict:
    configured = load_app_config().get("desktop")
    return _normalize_desktop_settings(_desktop_defaults() | (configured if isinstance(configured, dict) else {}))


def save_desktop_stream_config(settings: dict) -> dict:
    config = load_app_config()
    current = desktop_stream_config()
    allowed = set(_desktop_defaults())
    sanitized = {key: settings[key] for key in allowed if key in settings}
    next_settings = _normalize_desktop_settings(current | sanitized)
    config["desktop"] = next_settings
    save_app_config(config)
    return next_settings


def remote_video_path() -> Path | None:
    remote = load_app_config().get("remote")
    if not isinstance(remote, dict) or not remote.get("enabled", False):
        return None

    configured_path = remote.get("path")
    if configured_path:
        return Path(str(configured_path)).expanduser()

    smb_url = remote.get("smb_url")
    if not smb_url:
        return None

    return _gvfs_path_from_smb_url(str(smb_url))


def _gvfs_path_from_smb_url(smb_url: str) -> Path | None:
    parsed = urlparse(smb_url)
    if parsed.scheme.lower() != "smb" or not parsed.hostname:
        return None

    parts = [unquote(part) for part in parsed.path.split("/") if part]
    if not parts:
        return None

    share = parts[0]
    remainder = Path(*parts[1:]) if len(parts) > 1 else Path()
    user_runtime_dir = Path(os.environ.get("XDG_RUNTIME_DIR", f"/run/user/{os.getuid()}"))
    mount_dir = user_runtime_dir / "gvfs" / f"smb-share:server={parsed.hostname},share={share}"
    return mount_dir / remainder


def _desktop_defaults() -> dict:
    return {
        "encoder": "auto",
        "content_hint": "auto",
        "degradation_preference": "maintain-resolution",
        "width": 1920,
        "height": 1080,
        "fps": 60,
        "bitrate_mbps": 16,
    }


def _normalize_desktop_settings(settings: dict) -> dict:
    normalized = dict(settings)

    normalized["encoder"] = str(normalized.get("encoder") or "auto")
    if normalized["encoder"] not in {"auto", "h264", "vp8"}:
        normalized["encoder"] = "auto"

    normalized["content_hint"] = str(normalized.get("content_hint") or "auto")
    if normalized["content_hint"] not in {"auto", "motion", "detail", "text"}:
        normalized["content_hint"] = "auto"

    normalized["degradation_preference"] = str(normalized.get("degradation_preference") or "maintain-resolution")
    if normalized["degradation_preference"] not in {"maintain-resolution", "maintain-framerate", "balanced"}:
        normalized["degradation_preference"] = "maintain-resolution"

    normalized["width"] = _clamp_int(normalized.get("width"), 320, 7680, 1920)
    normalized["height"] = _clamp_int(normalized.get("height"), 180, 4320, 1080)
    normalized["fps"] = _clamp_int(normalized.get("fps"), 15, 144, 60)
    normalized["bitrate_mbps"] = _clamp_int(normalized.get("bitrate_mbps"), 1, 600, 16)
    return normalized


def _clamp_int(value: object, low: int, high: int, default: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return default
    return max(low, min(high, parsed))
