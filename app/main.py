from __future__ import annotations

import mimetypes
from collections.abc import Iterator
from pathlib import Path

from fastapi import FastAPI, Header, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, RedirectResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles

from .config import CHUNK_SIZE, STATIC_DIR, desktop_stream_config, save_desktop_stream_config
from .videos import browse_directory, get_thumbnail, get_video, list_videos
from .ws import hub

app = FastAPI(title="VR Video Pump")


@app.get("/")
async def index() -> RedirectResponse:
    return RedirectResponse("/control")


@app.get("/control")
async def control_page() -> FileResponse:
    return FileResponse(STATIC_DIR / "control.html")


@app.get("/headset")
async def headset_page() -> FileResponse:
    return FileResponse(STATIC_DIR / "headset.html")


@app.get("/api/videos")
async def api_videos(source: str | None = None) -> dict:
    if source not in (None, "local", "remote"):
        raise HTTPException(status_code=400, detail="Invalid source")
    return {"videos": [video.public_dict() for video in list_videos(source)]}


@app.get("/api/browse")
async def api_browse(source: str = "local", path: str = "") -> dict:
    if source not in ("local", "remote"):
        raise HTTPException(status_code=400, detail="Invalid source")
    return browse_directory(source, path)


@app.get("/api/video/{video_id:path}")
async def api_video(video_id: str) -> dict:
    video = get_video(video_id, include_metadata=True)
    if video is None:
        raise HTTPException(status_code=404, detail="Video not found")
    return {"video": video.public_dict()}


@app.get("/api/desktop/settings")
async def api_desktop_settings() -> dict:
    return {"settings": desktop_stream_config()}


@app.post("/api/desktop/settings")
async def api_save_desktop_settings(request: Request) -> dict:
    data = await request.json()
    if not isinstance(data, dict):
        raise HTTPException(status_code=400, detail="Invalid settings")
    return {"settings": save_desktop_stream_config(data)}


@app.get("/media/{video_id}/{_filename:path}")
async def media(video_id: str, range_header: str | None = Header(default=None, alias="Range")) -> Response:
    video = get_video(video_id)
    if video is None:
        raise HTTPException(status_code=404, detail="Video not found")

    path = video.path
    file_size = video.size
    media_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"

    if not range_header:
        return FileResponse(path, media_type=media_type, headers={"Accept-Ranges": "bytes"})

    start, end = _parse_range(range_header, file_size)
    length = end - start + 1

    return StreamingResponse(
        content=_iter_range(path, start, end),
        status_code=206,
        media_type=media_type,
        headers={
            "Accept-Ranges": "bytes",
            "Content-Range": f"bytes {start}-{end}/{file_size}",
            "Content-Length": str(length),
        },
    )


@app.get("/thumbnails/{video_id}.jpg")
async def thumbnail(video_id: str) -> FileResponse:
    path = get_thumbnail(video_id)
    if path is None:
        raise HTTPException(status_code=404, detail="Thumbnail not available")
    return FileResponse(path, media_type="image/jpeg")


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    await hub.connect(websocket)
    try:
        while True:
            message = await websocket.receive_json()
            await hub.handle(websocket, message)
    except WebSocketDisconnect:
        await hub.disconnect(websocket)


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


def _parse_range(range_header: str, file_size: int) -> tuple[int, int]:
    if not range_header.startswith("bytes="):
        raise HTTPException(status_code=416, detail="Invalid range")

    try:
        raw_start, raw_end = range_header.replace("bytes=", "", 1).split("-", 1)
        if raw_start == "":
            suffix_length = int(raw_end)
            start = max(file_size - suffix_length, 0)
            end = file_size - 1
        else:
            start = int(raw_start)
            end = int(raw_end) if raw_end else file_size - 1
    except ValueError as exc:
        raise HTTPException(status_code=416, detail="Invalid range") from exc

    if start < 0 or end >= file_size or start > end:
        raise HTTPException(status_code=416, detail="Range not satisfiable")
    return start, end


def _iter_range(path: Path, start: int, end: int) -> Iterator[bytes]:
    with path.open("rb") as file:
        file.seek(start)
        remaining = end - start + 1
        while remaining > 0:
            chunk = file.read(min(CHUNK_SIZE, remaining))
            if not chunk:
                break
            remaining -= len(chunk)
            yield chunk
